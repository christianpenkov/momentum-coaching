-- Vue de santé Short.io, sur le modèle de yt_sante_donnees / ig_sante_donnees.
--
-- Rien à maintenir : une vue ne stocke rien, ne se purge pas, ne peut pas dériver.
-- Elle répond à la seule question qui compte pour l'exploitation : « la collecte de
-- clics est-elle à jour pour chaque élève, et depuis quand ? »
--
--   select * from shortio_sante_donnees;   -- tout à 'ok' = rien à faire
--
-- Trois signaux distincts :
--   * retard_jours — le cron n'écrit plus. Au-delà de la fenêtre d'auto-réparation
--     (7 jours), les journées manquées deviennent irrécupérables : le flux de clics
--     Short.io ne remonte pas indéfiniment.
--   * jours_sans_aucune_ligne — un jour sans la moindre ligne à l'intérieur de la
--     période d'activité de l'élève : trou de collecte franc.
--   * lignes_clics_sans_categorie — des clics existent en base mais ne sont comptés
--     dans AUCUN écran, faute de link_category. Le défaut le plus sournois : la donnée
--     est là, le chiffre affiché est simplement plus bas que la réalité.
--
-- Ne sont PAS des anomalies, et sont donc écartés du dernier signal :
--   * les liens de paiement Stripe (utm_medium=payment), hors périmètre acquisition ;
--   * les liens sans aucun utm_medium, donc créés à la main hors de Momentum.
-- Une alerte qui crie en permanence n'est plus lue.
create or replace view public.shortio_sante_donnees as
with bornes as (
  select profile_id, min(date) d0, max(date) d1
  from shortio_link_daily_snapshots
  group by profile_id
),
calendrier as (
  select b.profile_id, generate_series(b.d0::timestamptz, b.d1::timestamptz, '1 day')::date jour
  from bornes b
),
couverture as (
  select c.profile_id,
    max(c.jour) filter (where s.id is not null) as derniere_ecriture,
    count(*) filter (where s.id is null) as jours_sans_aucune_ligne
  from calendrier c
  left join lateral (
    select 1 as id from shortio_link_daily_snapshots x
    where x.profile_id = c.profile_id and x.date = c.jour limit 1
  ) s on true
  group by c.profile_id
),
categories as (
  select profile_id,
    count(*) filter (where link_category is null and human_clicks > 0
                       and link_type is not null and link_type <> 'payment') as lignes_clics_sans_categorie,
    coalesce(sum(human_clicks) filter (where link_category is null
                       and link_type is not null and link_type <> 'payment'), 0) as clics_hors_categorie
  from shortio_link_daily_snapshots
  group by profile_id
)
select
  cv.profile_id,
  cv.derniere_ecriture,
  (current_date - cv.derniere_ecriture) as retard_jours,
  cv.jours_sans_aucune_ligne,
  cat.lignes_clics_sans_categorie,
  cat.clics_hors_categorie,
  case
    when not exists (
      select 1 from integrations i
      where i.profile_id = cv.profile_id and i.provider = 'shortio'
    ) then 'integration deconnectee'
    when (current_date - cv.derniere_ecriture) > 7
      then 'ALERTE : hors fenetre d auto reparation'
    when (current_date - cv.derniere_ecriture) > 1
      then 'collecte en retard'
    when cv.jours_sans_aucune_ligne > 0
      then 'jours sans aucune collecte'
    when cat.lignes_clics_sans_categorie > 0
      then 'clics non categorises, invisibles a l ecran'
    else 'ok'
  end as etat
from couverture cv
left join categories cat on cat.profile_id = cv.profile_id;
