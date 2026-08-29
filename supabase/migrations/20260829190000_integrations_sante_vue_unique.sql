-- ── Une seule liste d'intégrations obligatoires ────────────────────────────
-- Elle était écrite en dur dans `recalc_integrations_ready_at`. La recopier dans
-- la vue de santé en aurait fait la deuxième copie, et le verrou d'accès de
-- l'espace élève la troisième — exactement le motif qui a produit les onze écarts
-- du 2026-08-19. Elle vit désormais ici, une fois.
create or replace function integrations_obligatoires()
returns table (provider text, libelle text)
language sql
immutable
set search_path to 'public'
as $$
  values ('instagram', 'Instagram'),
         ('calendly',  'Calendly'),
         ('youtube',   'YouTube'),
         ('stripe',    'Stripe'),
         ('shortio',   'Short.io'),
         ('google',    'Google Calendar'),
         ('fathom',    'Fathom')
$$;

-- Le trigger d'accès lit maintenant la même liste.
create or replace function recalc_integrations_ready_at() returns trigger as $$
declare
  required_providers text[] := array(select provider from integrations_obligatoires());
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

-- ── Santé des intégrations, une ligne par élève et par intégration ─────────
-- Réunit ce qui existait déjà en ordre dispersé : la table `integrations` (est-elle
-- branchée, son jeton est-il refusé) et les trois vues de fraîcheur, qui restent
-- seules juges de leur propre seuil de retard. Aucun seuil n'est réinventé ici : on
-- relit leur colonne `etat`. Une quatrième vue de fraîcheur s'y raccordera sans
-- toucher à l'écran.
--
-- `etat` : 'non_connectee' | 'en_echec' | 'collecte_degradee' | 'ok'
create or replace view integrations_sante as
select
  c.profile_id,
  o.provider,
  o.libelle,
  (i.id is not null)                       as connectee,
  i.connected_at,
  coalesce(i.status, 'ok')                 as statut,
  i.last_snapshot_error                    as erreur,
  h.derniere_donnee,
  h.retard_jours,
  h.etat_collecte,
  case
    when i.id is null                                        then 'non_connectee'
    when coalesce(i.status, 'ok') = 'failed'                  then 'en_echec'
    when h.etat_collecte is not null and h.etat_collecte <> 'ok' then 'collecte_degradee'
    else 'ok'
  end as etat
from clients c
cross join integrations_obligatoires() o
left join integrations i
  on i.profile_id = c.profile_id and i.provider = o.provider
left join lateral (
  select
    case o.provider
      when 'instagram' then (select v.derniere_donnee      from ig_sante_donnees v      where v.profile_id = c.profile_id)
      when 'youtube'   then (select v.derniere_donnee_vues from yt_sante_donnees v      where v.profile_id = c.profile_id)
      when 'shortio'   then (select v.derniere_ecriture    from shortio_sante_donnees v where v.profile_id = c.profile_id)
    end as derniere_donnee,
    case o.provider
      when 'instagram' then (select v.retard_jours from ig_sante_donnees v      where v.profile_id = c.profile_id)
      when 'youtube'   then (select v.retard_jours from yt_sante_donnees v      where v.profile_id = c.profile_id)
      when 'shortio'   then (select v.retard_jours from shortio_sante_donnees v where v.profile_id = c.profile_id)
    end as retard_jours,
    case o.provider
      when 'instagram' then (select v.etat from ig_sante_donnees v      where v.profile_id = c.profile_id)
      when 'youtube'   then (select v.etat from yt_sante_donnees v      where v.profile_id = c.profile_id)
      when 'shortio'   then (select v.etat from shortio_sante_donnees v where v.profile_id = c.profile_id)
    end as etat_collecte
) h on true
where c.profile_id is not null;
