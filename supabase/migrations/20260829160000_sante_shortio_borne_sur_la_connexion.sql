-- La vue de santé criait au loup sur des journées que le cron ne pouvait pas collecter.
--
-- Constaté le 2026-08-29 : deux profils sur quatre en alerte « jours sans aucune
-- collecte » — 2 jours pour dc6f6aec, 21 pour e6825b3e. Vérification faite, les 23
-- trous sont ANTÉRIEURS à la connexion du compte Short.io de ces élèves, et il n'y en a
-- aucun depuis. La collecte n'a donc jamais manqué un seul jour.
--
-- D'où venaient ces journées : le calendrier partait de la ligne la plus ancienne du
-- profil. Or des lignes anciennes existent avant la connexion — le domaine est partagé,
-- et la réparation historique a écrit les journées où ce domaine avait des clics. Entre
-- ces journées-là et la connexion de l'élève, le cron n'a évidemment rien écrit.
--
-- Une supervision qui affiche en permanence une alerte qu'on ne peut pas traiter est
-- pire que pas de supervision : soit on la regarde et on perd du temps, soit on
-- s'habitue à l'ignorer et elle ne sert plus à rien le jour d'un vrai incident. C'est
-- exactement ce que l'objectif « zéro maintenance » interdit.
--
-- Le calendrier démarre donc à la connexion de l'intégration. Une journée manquante
-- avant cette date n'est pas un incident, c'est une période où l'élève n'existait pas
-- encore pour ce cron.
create or replace view public.shortio_sante_donnees as
with integ as (
  select i.profile_id, i.connected_at::date as connecte_le
  from integrations i
  where i.provider = 'shortio'
), bornes as (
  select s.profile_id,
         min(s.date) as premiere_ligne,
         max(s.date) as d1,
         -- Le calendrier surveillé commence à la connexion. `coalesce` : une intégration
         -- sans `connected_at` retombe sur la première ligne, l'ancien comportement.
         greatest(min(s.date), coalesce(g.connecte_le, min(s.date))) as d0
  from shortio_link_daily_snapshots s
  left join integ g on g.profile_id = s.profile_id
  group by s.profile_id, g.connecte_le
), calendrier as (
  select b.profile_id,
         generate_series(b.d0::timestamptz, b.d1::timestamptz, '1 day'::interval)::date as jour
  from bornes b
  where b.d0 <= b.d1
), couverture as (
  select c.profile_id,
         max(c.jour) filter (where s.id is not null) as derniere_ecriture,
         count(*) filter (where s.id is null) as jours_sans_aucune_ligne
  from calendrier c
  left join lateral (
    select 1 as id from shortio_link_daily_snapshots x
    where x.profile_id = c.profile_id and x.date = c.jour
    limit 1
  ) s on true
  group by c.profile_id
), categories as (
  select s.profile_id,
         count(*) filter (
           where s.link_category is null and s.human_clicks > 0
             and s.link_type is not null and s.link_type <> 'payment'
         ) as lignes_clics_sans_categorie,
         coalesce(sum(s.human_clicks) filter (
           where s.link_category is null
             and s.link_type is not null and s.link_type <> 'payment'
         ), 0::bigint) as clics_hors_categorie
  from shortio_link_daily_snapshots s
  group by s.profile_id
)
select cv.profile_id,
       cv.derniere_ecriture,
       current_date - cv.derniere_ecriture as retard_jours,
       cv.jours_sans_aucune_ligne,
       cat.lignes_clics_sans_categorie,
       cat.clics_hors_categorie,
       case
         when not exists (
           select 1 from integrations i
           where i.profile_id = cv.profile_id and i.provider = 'shortio'
         ) then 'integration deconnectee'
         -- Au-delà de 7 jours, la fenêtre d'auto-réparation du cron ne rattrape plus :
         -- le trou devient définitif, d'où l'alerte franche.
         when (current_date - cv.derniere_ecriture) > 7 then 'ALERTE : hors fenetre d auto reparation'
         when (current_date - cv.derniere_ecriture) > 1 then 'collecte en retard'
         when cv.jours_sans_aucune_ligne > 0 then 'jours sans aucune collecte'
         when cat.lignes_clics_sans_categorie > 0 then 'clics non categorises, invisibles a l ecran'
         else 'ok'
       end as etat
from couverture cv
left join categories cat on cat.profile_id = cv.profile_id;

comment on view public.shortio_sante_donnees is
  'Sante de la collecte Short.io, un profil par ligne. `etat` = ''ok'' partout signifie '
  'qu''il n''y a rien a faire. La fenetre surveillee demarre a la connexion de '
  'l''integration : une journee sans ligne AVANT cette date n''est pas un incident, le '
  'cron ne pouvait rien collecter (verifie le 2026-08-29, 23 fausses alertes de ce type).';
