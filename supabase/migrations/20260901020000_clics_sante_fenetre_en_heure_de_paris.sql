-- La fenêtre de la vue était bornée en UTC, ses journées comptées en heure de Paris
--
-- `current_date` vaut la date de la session, c'est-à-dire UTC. Les journées comparées,
-- elles, sont des journées PARIS des deux côtés (règle du projet, docs/fuseaux-horaires.md).
-- Entre 22 h et minuit UTC — soit entre minuit et 2 h du matin à Paris — les deux ne
-- désignent pas le même jour :
--
--   select current_date, (timezone('Europe/Paris', now()))::date;
--   → 2026-08-31   |   2026-09-01        (mesuré à 22:57 UTC)
--
-- Conséquence : pendant ces deux heures, la vue exclut une journée de plus que prévu.
--
-- ⚠️ **Ce n'est pas un défaut qui produisait de faux chiffres.** L'écart va toujours
-- dans le sens prudent : la vue ne peut pas inclure une journée incomplète, elle en
-- exclut simplement une de trop. Une panne survenue entre minuit et 2 h remonterait
-- avec deux heures de retard, rien de plus.
--
-- Corrigé quand même, pour la raison qui a coûté le plus de temps sur ce chantier :
-- mélanger une borne UTC et des données rangées en heure de Paris est exactement le
-- genre d'incohérence qu'on finit par prendre pour un bug ailleurs. Une seule notion
-- de « aujourd'hui » dans toute la vue.

drop view if exists public.clics_sante_redirection;
create view public.clics_sante_redirection as
with aujourdhui as (
  -- UNE seule définition de « aujourd'hui », en heure de Paris, comme les journées
  -- des deux compteurs.
  select (timezone('Europe/Paris', now()))::date as jour
), jours as (
  select
    s.profile_id,
    s.path              as link_path,
    s.date              as jour,
    max(s.human_clicks) as clics_shortio,
    -- ⚠️ Ne dit PAS « ce jour-là le lien était réécrit », mais « la dernière fois que
    -- cette ligne a été touchée, le lien était réécrit » : poll-leads réécrit les
    -- journées de sa fenêtre de rattrapage avec la destination COURANTE. Utilisable
    -- dans un seul sens — `false` prouve que la ligne précède la réécriture.
    bool_or(s.original_url like '%/r/%') as redirige_derniere_ecriture
  from public.shortio_link_daily_snapshots s, aujourdhui a
  where (
          s.original_url like '%/r/%'
          or (s.original_url like 'https://calendly.com/%'
              and substring(s.original_url from 'utm_medium=([a-z]+)')
                  in ('bio', 'description', 'story'))
        )
    -- La journée en cours est incomplète des deux côtés : la comparer ferait
    -- clignoter la vue tous les jours sans rien apprendre.
    and s.date between a.jour - 30 and a.jour - 1
    -- ⚠️ **Ne comparer que la ligne du PROPRIÉTAIRE du lien.**
    --
    -- Deux profils peuvent partager un domaine Short.io (docs/shortio-api.md, piège
    -- n°2) : l'API rend alors les mêmes liens à chacun, et CHACUN écrit sa propre
    -- ligne de snapshot. La route, elle, attribue le clic à un seul profil — celui
    -- que porte `p` dans la destination. Sans ce filtre, les profils non
    -- propriétaires voient donc éternellement « des clics chez Short.io, aucun chez
    -- nous », et sortent en « ALERTE : route sans clic » pour toujours. Six lignes
    -- dans ce cas au 2026-09-01.
    --
    -- Le discriminant n'est pas une heuristique : la destination réécrite NOMME son
    -- propriétaire. Une ligne dont le `p` désigne quelqu'un d'autre décrit un lien
    -- qui ne lui appartient pas.
    --
    -- Les liens pas encore réécrits n'ont pas de `p` : ils restent tous, et sortent
    -- en « lien non redirige », ce qui n'est pas une anomalie.
    and (
      s.original_url !~ 'p=[0-9a-f-]{36}'
      or substring(s.original_url from 'p=([0-9a-f-]{36})') = s.profile_id::text
    )
  group by s.profile_id, s.path, s.date
), borne as (
  select profile_id, link_path,
         max(jour) filter (where not redirige_derniere_ecriture) as dernier_jour_direct
  from jours group by profile_id, link_path
), route as (
  select
    c.profile_id,
    c.link_path,
    (timezone('Europe/Paris', c.occurred_at))::date as jour,
    count(*) filter (where not c.is_bot) as clics_route,
    count(*) filter (where c.is_bot)     as clics_robots
  from public.link_clicks c, aujourdhui a
  where c.occurred_at >= (a.jour - 31)
  group by 1, 2, 3
), apparie as (
  select
    j.profile_id, j.link_path, j.jour, j.clics_shortio,
    coalesce(r.clics_route, 0)  as clics_route,
    coalesce(r.clics_robots, 0) as clics_robots,
    (j.redirige_derniere_ecriture
       and (b.dernier_jour_direct is null or j.jour > b.dernier_jour_direct)) as comparable
  from jours j
  join borne b on b.profile_id = j.profile_id and b.link_path = j.link_path
  left join route r
    on r.profile_id = j.profile_id and r.link_path = j.link_path and r.jour = j.jour
), totaux as (
  select
    profile_id, link_path,
    bool_or(comparable) as redirige,
    coalesce(sum(clics_shortio) filter (where comparable), 0)::bigint as shortio,
    coalesce(sum(clics_route)   filter (where comparable), 0)::bigint as route,
    coalesce(sum(clics_robots)  filter (where comparable), 0)::bigint as robots,
    count(*) filter (where comparable and clics_shortio > 0 and clics_route = 0)::bigint as jours_sans_route,
    -- ⚠️ Le sur-comptage se juge PAR JOUR, jamais sur le cumul.
    --
    -- Le seuil avait d'abord été posé sur les totaux 30 jours, et validé sur neuf
    -- paires construites. Confronté aux vrais chiffres, il ne tirait pas : une
    -- journée à 2 contre 8 devient, cumulée avec une journée saine à 1 contre 1,
    -- 3 contre 9 — et 9 > 3 × 2 + 3 est faux, à une unité près. Une seule journée
    -- aberrante se dilue dans trente.
    --
    -- La leçon est sur la validation, pas sur le seuil : les neuf cas testaient
    -- l'EXPRESSION sur des paires isolées, pas la VUE sur des données agrégées.
    -- `jours_sans_route` comptait déjà par jour pour l'autre sens ; le sur-comptage
    -- rejoint la même forme.
    count(*) filter (where comparable and clics_route > clics_shortio * 2 + 3)::bigint  as jours_sur_comptes,
    max(jour) filter (where clics_route > 0) as dernier_jour_avec_clic_route
  from apparie group by profile_id, link_path
)
select
  profile_id, link_path, redirige,
  shortio as clics_shortio_30j,
  route   as clics_route_30j,
  robots  as clics_robots_30j,
  jours_sans_route,
  jours_sur_comptes,
  dernier_jour_avec_clic_route,
  case
    when not redirige              then 'lien non redirige'
    when shortio = 0 and route = 0 then 'ok'
    when route = 0 and shortio > 0 then 'ALERTE : route sans clic'
    when route * 2 < shortio       then 'ALERTE : ecart important'
    -- Sur-détection : au moins une journée où l'on compte des humains que Short.io
    -- classe robots. Seuil quotidien large (le double + 3) : les deux filtres ne
    -- s'accorderont jamais exactement, et une alerte qui tire sur du bruit ordinaire
    -- cesse d'être lue.
    when jours_sur_comptes > 0     then 'ALERTE : robots comptes humains'
    else 'ok'
  end as etat
from totaux;

comment on view public.clics_sante_redirection is
  'Compare, par lien, notre compte de clics humains a celui de Short.io — une classification tierce et independante du meme trafic. Alerte dans LES DEUX SENS : route sans clic, et robots comptes humains. Fenetre et journees toutes en heure de Paris. lien non redirige n est PAS une anomalie.';
