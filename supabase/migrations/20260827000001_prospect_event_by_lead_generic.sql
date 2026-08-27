-- Suite immédiate de 20260827000000 (même journée, même chantier).
--
-- ── POURQUOI CETTE SECONDE MIGRATION ──────────────────────────────────────────
--
-- La première version de upsert_prospect_event_by_lead() portait un
-- ON CONFLICT figé sur le seul prédicat de lm_link_requested. Elle ne pouvait
-- donc pas servir au second call site cassé découvert juste après :
--
--   lib/instagram-webhook-processor.ts — event_type 'cold_dm_sent'
--     .upsert({ onConflict: 'ig_lead_id,event_type' }) → échec systématique.
--     Zéro événement cold_dm_sent en base au 2026-08-27, alors que le code
--     tourne depuis des mois. Aucun index ne couvrait ce type.
--
-- Nuance qui explique pourquoi les autres marchent : lm_sent, hook_replied et
-- lm_clicked ont chacun un index partiel dont le PRÉDICAT porte sur event_type
-- (« WHERE event_type = 'lm_sent' »). Postgres sait inférer un index partiel
-- quand son prédicat découle des valeurs insérées — ces trois-là passent donc.
-- Ceux dont le prédicat porte sur « colonne IS NOT NULL » ne sont pas
-- inférables, et ceux sans index du tout échouent. D'où : call_booked (réglé en
-- août par une RPC), calendly_link_sent et cold_dm_sent.
--
-- ── LA SOLUTION ───────────────────────────────────────────────────────────────
--
-- UPDATE puis INSERT, sans aucun ON CONFLICT. La fonction ne dépend donc plus
-- d'un index particulier et sert n'importe quel event_type « au plus un par
-- lead ». Le rattrapage sur unique_violation couvre le cas de deux webhooks
-- simultanés sur le même lead.
--
-- ⚠️ Ne PAS utiliser cette fonction pour un événement qui doit pouvoir se
-- répéter sur un même lead — les relances du cycle de recontact, notamment.
-- Celles-ci auront leur propre écriture, qui incrémente `cycle`.

create unique index if not exists prospect_events_cold_dm_sent_uidx
  on public.prospect_events (ig_lead_id, event_type)
  where (event_type = 'cold_dm_sent' and ig_lead_id is not null);

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
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ig_lead_id is null then
    raise exception 'upsert_prospect_event_by_lead : p_ig_lead_id est obligatoire';
  end if;

  update prospect_events
     set occurred_at  = p_occurred_at,
         profile_id   = p_profile_id,
         prospect_key = p_prospect_key,
         platform     = p_platform,
         metadata     = coalesce(p_metadata, metadata)
   where ig_lead_id = p_ig_lead_id
     and event_type = p_event_type;

  if not found then
    begin
      insert into prospect_events (
        profile_id, prospect_key, platform, event_type,
        occurred_at, ig_lead_id, metadata
      )
      values (
        p_profile_id, p_prospect_key, p_platform, p_event_type,
        p_occurred_at, p_ig_lead_id, p_metadata
      );
    exception when unique_violation then
      -- Deux webhooks simultanés sur le même lead : le second rattrape.
      update prospect_events
         set occurred_at = p_occurred_at,
             metadata    = coalesce(p_metadata, metadata)
       where ig_lead_id = p_ig_lead_id
         and event_type = p_event_type;
    end;
  end if;
end;
$$;

grant execute on function public.upsert_prospect_event_by_lead to service_role;

comment on function public.upsert_prospect_event_by_lead is
  'Écrit un prospect_event « au plus un par lead ». UPDATE puis INSERT, sans ON CONFLICT : ne dépend d''aucun index, donc sert n''importe quel event_type. NE PAS utiliser pour un événement répétable (relances) — celui-là doit incrémenter cycle.';
