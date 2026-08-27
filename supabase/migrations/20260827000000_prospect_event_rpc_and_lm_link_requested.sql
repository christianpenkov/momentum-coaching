-- Lot 1 de la refonte du pipeline leads (2026-08-27).
--
-- ── LE PROBLÈME ───────────────────────────────────────────────────────────────
--
-- Tous les index uniques de prospect_events sont PARTIELS (ils portent un WHERE) :
--
--   prospect_events_call_event_uidx        WHERE call_id IS NOT NULL
--   prospect_events_link_event_type_uidx   WHERE prospect_link_id IS NOT NULL
--   prospect_events_link_clicked_uidx      WHERE prospect_link_id IS NOT NULL
--                                            AND event_type = 'link_clicked'
--   prospect_events_ig_lead_lm_sent_key    WHERE event_type = 'lm_sent' AND ...
--   prospect_events_ig_lead_hook_replied_key
--   prospect_events_lm_clicked_unique      WHERE event_type = 'lm_clicked'
--
-- Le client Supabase JS ne peut cibler un ON CONFLICT que sur un index TOTAL.
-- Tout .upsert() sur cette table échoue donc avec « there is no unique or
-- exclusion constraint matching the ON CONFLICT specification ».
--
-- La migration 20260814193153 avait déjà réglé le cas des calls avec une RPC.
-- Deux call sites restaient cassés, et personne ne le voyait :
--
--   lib/instagram-webhook-processor.ts:500
--     upsert onConflict 'prospect_link_id,event_type' → échec systématique.
--     Le résultat n'est pas lu (Supabase JS ne lève pas, il retourne { error }),
--     et le console.log de la ligne suivante annonce un succès.
--     C'est pourquoi AUCUN événement calendly_link_sent n'existe en base : il
--     n'est pas « jamais écrit », il est écrit et rejeté en silence.
--
--   l'événement lm_link_requested, à créer ci-dessous, aurait subi le même sort.
--
-- ── CE QUE FAIT CETTE MIGRATION ───────────────────────────────────────────────
--
--   1. deux RPC génériques qui exécutent l'upsert en SQL, où Postgres résout
--      nativement l'ON CONFLICT contre un index partiel
--   2. l'index d'unicité de lm_link_requested, qui n'existait pas — sans lui,
--      un lead qui clique deux fois créerait deux événements
--
-- Les définitions d'index existantes ne sont PAS touchées : leur partialité est
-- volontaire (deux lignes à prospect_link_id NULL ne doivent pas se bloquer).

-- ── 1. Unicité de lm_link_requested ───────────────────────────────────────────
-- Modèle : prospect_events_lm_clicked_unique. Un lead ne réclame qu'une fois le
-- lien de son lead magnet ; un second clic met à jour la date, il n'ajoute pas
-- une ligne.
create unique index if not exists prospect_events_lm_link_requested_uidx
  on public.prospect_events (ig_lead_id, event_type)
  where (event_type = 'lm_link_requested' and ig_lead_id is not null);

-- ── 2. Upsert d'un événement rattaché à un LIEN ───────────────────────────────
-- Remplace tout .upsert({ onConflict: 'prospect_link_id,event_type' }).
create or replace function public.upsert_prospect_event_by_link(
  p_profile_id       uuid,
  p_prospect_key     text,
  p_platform         text,
  p_event_type       text,
  p_occurred_at      timestamptz,
  p_prospect_link_id uuid,
  p_ig_lead_id       uuid default null,
  p_metadata         jsonb default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into prospect_events (
    profile_id, prospect_key, platform, event_type,
    occurred_at, prospect_link_id, ig_lead_id, metadata
  )
  values (
    p_profile_id, p_prospect_key, p_platform, p_event_type,
    p_occurred_at, p_prospect_link_id, p_ig_lead_id, p_metadata
  )
  on conflict (prospect_link_id, event_type) where (prospect_link_id is not null)
  do update set
    occurred_at  = excluded.occurred_at,
    ig_lead_id   = excluded.ig_lead_id,
    profile_id   = excluded.profile_id,
    prospect_key = excluded.prospect_key,
    platform     = excluded.platform,
    metadata     = coalesce(excluded.metadata, prospect_events.metadata);
$$;

-- ── 3. Upsert d'un événement rattaché à un LEAD ───────────────────────────────
-- Pour lm_link_requested, lm_sent, hook_replied, lm_clicked — tous couverts par
-- un index (ig_lead_id, event_type) partiel.
create or replace function public.upsert_prospect_event_by_lead(
  p_profile_id   uuid,
  p_prospect_key text,
  p_platform     text,
  p_event_type   text,
  p_occurred_at  timestamptz,
  p_ig_lead_id   uuid,
  p_metadata     jsonb default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into prospect_events (
    profile_id, prospect_key, platform, event_type,
    occurred_at, ig_lead_id, metadata
  )
  values (
    p_profile_id, p_prospect_key, p_platform, p_event_type,
    p_occurred_at, p_ig_lead_id, p_metadata
  )
  on conflict (ig_lead_id, event_type)
    where (event_type = 'lm_link_requested' and ig_lead_id is not null)
  do update set
    occurred_at  = excluded.occurred_at,
    profile_id   = excluded.profile_id,
    prospect_key = excluded.prospect_key,
    platform     = excluded.platform,
    metadata     = coalesce(excluded.metadata, prospect_events.metadata);
$$;

grant execute on function public.upsert_prospect_event_by_link to service_role;
grant execute on function public.upsert_prospect_event_by_lead to service_role;

comment on index public.prospect_events_lm_link_requested_uidx is
  'Un lead ne réclame le lien de son lead magnet qu''une fois. Index PARTIEL comme tous ceux de cette table : ne jamais cibler via .upsert() du client JS, passer par upsert_prospect_event_by_lead().';

comment on function public.upsert_prospect_event_by_link is
  'Écrit un prospect_event rattaché à un lien. À utiliser À LA PLACE de .upsert({ onConflict: ''prospect_link_id,event_type'' }), qui échoue silencieusement contre un index partiel.';

comment on function public.upsert_prospect_event_by_lead is
  'Écrit un prospect_event rattaché à un lead Instagram. Même raison que upsert_prospect_event_by_link.';
