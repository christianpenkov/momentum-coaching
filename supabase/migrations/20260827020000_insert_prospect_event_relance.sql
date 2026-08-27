-- Lot 2c — la relance d'un lead classé « À recontacter ».
--
-- Contrairement à tous les autres événements du pipeline, une relance est
-- RÉPÉTABLE : c'est même son intérêt, puisque le cycle s'arrête à trois. Elle ne
-- peut donc pas passer par upsert_prospect_event_by_lead(), qui garantit « au
-- plus un par lead ».
--
-- `cycle` porte le numéro de la relance. La colonne existait déjà, avec un index
-- (profile_id, prospect_key, platform, cycle) — elle n'avait simplement jamais
-- été utilisée. Aucune colonne à créer.
--
-- ── LA DÉDUPLICATION ──────────────────────────────────────────────────────────
--
-- Deux clics sur « Marquer relancés », ou un webhook rejoué, ne doivent pas
-- compter deux relances : le lead sortirait du cycle en Perdu bien avant l'heure.
-- La fenêtre de 1 heure est le bon compromis — assez large pour absorber un
-- double clic ou une reprise de webhook, assez courte pour qu'une vraie seconde
-- relance le même jour reste possible.

create or replace function public.insert_prospect_event_relance(
  p_profile_id   uuid,
  p_prospect_key text,
  p_platform     text,
  p_occurred_at  timestamptz default now(),
  p_ig_lead_id   uuid default null,
  p_metadata     jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dernier timestamptz;
  v_cycle   integer;
begin
  select max(occurred_at), coalesce(max(cycle), 0)
    into v_dernier, v_cycle
    from prospect_events
   where profile_id   = p_profile_id
     and prospect_key = p_prospect_key
     and platform     = p_platform
     and event_type   = 'relance';

  -- Déjà relancé dans l'heure : on ne recompte pas, on rend le cycle en cours.
  if v_dernier is not null and p_occurred_at - v_dernier < interval '1 hour' then
    return v_cycle;
  end if;

  insert into prospect_events (
    profile_id, prospect_key, platform, event_type,
    occurred_at, cycle, ig_lead_id, metadata
  )
  values (
    p_profile_id, p_prospect_key, p_platform, 'relance',
    p_occurred_at, v_cycle + 1, p_ig_lead_id, p_metadata
  );

  return v_cycle + 1;
end;
$$;

grant execute on function public.insert_prospect_event_relance to service_role;

comment on function public.insert_prospect_event_relance is
  'Enregistre une relance et rend son numéro de cycle. Répétable, contrairement à upsert_prospect_event_by_lead. Ignore un second appel dans l''heure pour qu''un double clic ne fasse pas sortir le lead du cycle avant l''heure.';
