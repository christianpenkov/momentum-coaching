-- Gate d'onboarding : integrations_ready_at se pose automatiquement (trigger) dès que
-- les 7 intégrations obligatoires sont connectées, jamais réécrit ensuite. Remplace le
-- système de waiver (integrations_waived) devenu obsolète — toutes les intégrations
-- sont désormais obligatoires sans exception. Voir
-- docs/integrations-ready-at-vs-onboarding-completed-at.md pour la distinction avec
-- onboarding_completed_at (posé au choix du mot de passe élève, sans rapport).

alter table clients add column if not exists integrations_ready_at timestamptz;

-- Backfill non rétroactif : les élèves déjà en base sont débloqués au déploiement,
-- seuls les élèves invités après cette migration sont soumis au vrai gate.
update clients set integrations_ready_at = now() where integrations_ready_at is null;

alter table clients drop column if exists integrations_waived;

-- Sert au mécanisme B (bandeau de reconnexion post-activation) : marque une intégration
-- comme en échec sans jamais faire redescendre integrations_ready_at.
alter table integrations add column if not exists status text not null default 'ok' check (status in ('ok','failed'));

create or replace function recalc_integrations_ready_at() returns trigger as $$
declare
  required_providers text[] := array['instagram','calendly','youtube','stripe','shortio','google','fathom'];
  connected_count int;
begin
  select count(distinct provider) into connected_count
  from integrations
  where profile_id = new.profile_id and provider = any(required_providers);

  if connected_count >= array_length(required_providers, 1) then
    update clients set integrations_ready_at = now()
    where profile_id = new.profile_id and integrations_ready_at is null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_recalc_integrations_ready_at on integrations;
create trigger trg_recalc_integrations_ready_at
  after insert or update of provider on integrations
  for each row execute function recalc_integrations_ready_at();
