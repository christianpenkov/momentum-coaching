-- Fix : orbit/supabase/functions/sync-calendly/index.ts et
-- app/api/webhooks/calendly/route.ts upsertaient prospect_events avec
-- onConflict: 'call_id,event_type' contre prospect_events_call_event_uidx,
-- qui est un index UNIQUE PARTIEL (WHERE call_id IS NOT NULL). Le client
-- Supabase JS ne peut cibler un ON CONFLICT que sur un index/contrainte
-- total — d'où l'échec systématique observé en prod depuis le commit
-- f1f2bf9 ("there is no unique or exclusion constraint matching the ON
-- CONFLICT specification"), reproductible à chaque appel avec call_id non
-- nul (le seul cas réellement exercé par ces deux call sites).
--
-- Cette RPC exécute l'upsert directement en SQL, où Postgres résout
-- nativement l'ON CONFLICT contre un index partiel — sans changer la
-- définition de l'index (qui exclut volontairement call_id NULL de
-- l'unicité, comportement à préserver).
create or replace function public.upsert_prospect_event_call_booked(
  p_profile_id uuid,
  p_prospect_key text,
  p_platform text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_ig_lead_id uuid,
  p_prospect_link_id uuid,
  p_call_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into prospect_events (
    profile_id, prospect_key, platform, event_type,
    occurred_at, ig_lead_id, prospect_link_id, call_id
  )
  values (
    p_profile_id, p_prospect_key, p_platform, p_event_type,
    p_occurred_at, p_ig_lead_id, p_prospect_link_id, p_call_id
  )
  on conflict (call_id, event_type) where (call_id is not null)
  do update set
    occurred_at      = excluded.occurred_at,
    ig_lead_id        = excluded.ig_lead_id,
    prospect_link_id  = excluded.prospect_link_id,
    profile_id        = excluded.profile_id,
    prospect_key      = excluded.prospect_key,
    platform          = excluded.platform;
$$;

grant execute on function public.upsert_prospect_event_call_booked to service_role;
