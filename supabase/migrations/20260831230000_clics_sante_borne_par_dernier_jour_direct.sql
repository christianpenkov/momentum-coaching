-- La vue de santé datait la réécriture avec une valeur qui n'est pas datée
--
-- `clics_sante_redirection` ne comparait que les journées où le lien était « déjà
-- réécrit », en lisant `original_url` sur la ligne du jour. Or cette colonne ne
-- décrit PAS la destination de ce jour-là : c'est la destination au moment où la
-- ligne a été touchée pour la dernière fois.
--
-- Constaté en base le 2026-08-31, une heure après la première réécriture :
--
--   date        updated_at              destination
--   2026-08-30  2026-08-31 21:00:47     reecrite   ← ligne d'HIER, réécrite AUJOURD'HUI
--   2026-08-30  2026-08-30 21:55:28     directe
--   2026-08-29  2026-08-30 21:55:21     directe
--
-- `poll-leads` réécrit les lignes des journées passées qui tombent dans sa fenêtre
-- de rattrapage, et il y inscrit la destination COURANTE du lien. Une journée
-- antérieure à la réécriture était donc tamponnée « réécrite », entrait dans la
-- comparaison, ne trouvait aucune ligne de clic — et sortait en
-- « ALERTE : route sans clic » alors que l'absence était parfaitement normale.
--
-- ⚠️ C'est la règle 3 bis de docs/checklist-scalabilite.md, pour la troisième fois
-- dans ce projet (après ig_followers le 2026-08-30) : un ÉTAT ACTUEL écrit sur une
-- LIGNE DATÉE. Le motif ne se voit pas, parce que la colonne a l'air datée — elle
-- est sur une ligne qui porte une date.
--
-- Le correctif n'invente aucune donnée : il se borne à ce que la base sait vraiment.
-- Une ligne encore marquée « directe » prouve qu'elle a été écrite AVANT la
-- réécriture — le re-tamponnage ne va jamais dans l'autre sens. Le dernier jour
-- marqué direct est donc une borne basse sûre : on ne compare que les journées
-- strictement postérieures. La borne peut être trop prudente, jamais trop laxiste.

drop view if exists public.clics_sante_redirection;
create view public.clics_sante_redirection as
with jours as (
  select
    s.profile_id,
    s.path              as link_path,
    s.date              as jour,
    max(s.human_clicks) as clics_shortio,
    -- ⚠️ Ne dit PAS « ce jour-là le lien était réécrit ». Dit « la dernière fois
    -- que cette ligne a été touchée, le lien était réécrit ». Utilisable dans un
    -- seul sens : `false` prouve que la ligne précède la réécriture.
    bool_or(s.original_url like '%/r/%') as redirige_derniere_ecriture
  from public.shortio_link_daily_snapshots s
  where (
          s.original_url like '%/r/%'
          or (s.original_url like 'https://calendly.com/%'
              and substring(s.original_url from 'utm_medium=([a-z]+)')
                  in ('bio', 'description', 'story'))
        )
    and s.date between current_date - 30 and current_date - 1
  group by s.profile_id, s.path, s.date
), borne as (
  -- Dernier jour dont on est SÛR qu'il précède la réécriture.
  select profile_id, link_path,
         max(jour) filter (where not redirige_derniere_ecriture) as dernier_jour_direct
  from jours group by profile_id, link_path
), route as (
  select
    c.profile_id,
    c.link_path,
    -- Même règle de journée que le snapshot Short.io : un clic appartient au jour
    -- PARIS de son horodatage (cf. lib/shortio-clicks.ts).
    (timezone('Europe/Paris', c.occurred_at))::date as jour,
    count(*) filter (where not c.is_bot) as clics_route,
    count(*) filter (where c.is_bot)     as clics_robots
  from public.link_clicks c
  where c.occurred_at >= (current_date - 31)
  group by 1, 2, 3
), apparie as (
  select
    j.profile_id, j.link_path, j.jour, j.redirige_derniere_ecriture, j.clics_shortio,
    coalesce(r.clics_route, 0)  as clics_route,
    coalesce(r.clics_robots, 0) as clics_robots,
    -- Journée dont on peut tirer une conclusion : postérieure à toute journée
    -- encore marquée directe.
    (j.redirige_derniere_ecriture
       and (b.dernier_jour_direct is null or j.jour > b.dernier_jour_direct)) as comparable
  from jours j
  join borne b on b.profile_id = j.profile_id and b.link_path = j.link_path
  left join route r
    on r.profile_id = j.profile_id
   and r.link_path  = j.link_path
   and r.jour       = j.jour
)
select
  profile_id,
  link_path,
  bool_or(comparable)                                     as redirige,
  sum(clics_shortio) filter (where comparable)::bigint    as clics_shortio_30j,
  sum(clics_route)   filter (where comparable)::bigint    as clics_route_30j,
  sum(clics_robots)  filter (where comparable)::bigint    as clics_robots_30j,
  count(*) filter (where comparable and clics_shortio > 0 and clics_route = 0)::bigint
                                                          as jours_sans_route,
  max(jour) filter (where clics_route > 0)                as dernier_jour_avec_clic_route,
  case
    when not bool_or(comparable) then 'lien non redirige'
    when coalesce(sum(clics_shortio) filter (where comparable), 0) = 0 then 'ok'
    when coalesce(sum(clics_route)   filter (where comparable), 0) = 0
         then 'ALERTE : route sans clic'
    when coalesce(sum(clics_route)   filter (where comparable), 0) * 2
       < coalesce(sum(clics_shortio) filter (where comparable), 0)
         then 'ALERTE : ecart important'
    else 'ok'
  end as etat
from apparie
group by profile_id, link_path;

comment on view public.clics_sante_redirection is
  'Compare, par lien, les clics humains comptes par Short.io a ceux comptes par la route /r/. Ne juge QUE les journees posterieures au dernier jour ou la destination etait encore directe : original_url sur une ligne datee porte la destination du dernier passage du cron, pas celle du jour. lien non redirige n est PAS une anomalie.';
