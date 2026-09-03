-- La croissance de la base MESURÉE, plus seulement modélisée.
--
-- `base_sante_taille` estimait la croissance quotidienne à partir de QUATRE tables
-- (posts IG, vidéos YT, stories, link_clicks) : lignes/jour × octets/ligne. Tout le
-- reste — transcripts Fathom (jusqu'à plusieurs Mo par call, et 20-50 calls par
-- élève à terme), messagerie, ventes, payloads webhook — était invisible de
-- l'estimation. À 40 élèves, la vue aurait affiché des « jours restants »
-- largement trop optimistes, et l'alerte e-mail (90 puis 30 jours du plafond,
-- /api/sante/alerte-stockage) serait partie trop tard — sur le seul risque de la
-- plateforme qui ne prévient pas.
--
-- Le correctif : une photo quotidienne de pg_database_size() dans une table d'une
-- ligne par jour (~40 octets/jour, jamais un problème de place), et la vue préfère
-- la pente MESURÉE (14 derniers jours) dès qu'elle dispose d'au moins 3 jours
-- d'écart. L'estimation modélisée reste le repli des premiers jours.
--
-- Aucune purge nécessaire : 3 650 lignes en dix ans.

create table if not exists public.taille_base_historique (
  jour date primary key,
  octets bigint not null
);
alter table public.taille_base_historique enable row level security;

-- Première ligne tout de suite : une surveillance qui attend son premier passage
-- est un trou déjà rencontré (cf. crons_passages, AGENTS.md).
insert into public.taille_base_historique (jour, octets)
values (current_date, pg_database_size(current_database()))
on conflict (jour) do update set octets = excluded.octets;

-- Photo quotidienne — 3h58, dans le train des jobs de ménage (3h30-4h05).
select cron.schedule(
  'photographier-taille-base-daily',
  '58 3 * * *',
  $$insert into public.taille_base_historique (jour, octets)
    values (current_date, pg_database_size(current_database()))
    on conflict (jour) do update set octets = excluded.octets$$
);

-- CREATE OR REPLACE conserve les privilèges existants (dont la révocation
-- anon/authenticated du 2026-09-02).
create or replace view public.base_sante_taille as
with lignes_par_jour as (
  select
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)
              from analytics_ig_posts_history where snapshot_date > current_date - 7), 0) as ig_posts,
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)
              from analytics_yt_videos_history where snapshot_date > current_date - 7), 0) as yt_videos,
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)
              from analytics_ig_stories_history where snapshot_date > current_date - 7), 0) as ig_stories,
    coalesce((select count(*)::numeric / nullif(count(distinct (timezone('Europe/Paris', occurred_at))::date), 0)
              from link_clicks where occurred_at > now() - interval '7 days'), 0) as link_clicks
),
poids as (
  select
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)
              from pg_class c join pg_stat_user_tables s on s.relid = c.oid
              where c.relname = 'analytics_ig_posts_history'), 0) as o_ig_posts,
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)
              from pg_class c join pg_stat_user_tables s on s.relid = c.oid
              where c.relname = 'analytics_yt_videos_history'), 0) as o_yt_videos,
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)
              from pg_class c join pg_stat_user_tables s on s.relid = c.oid
              where c.relname = 'analytics_ig_stories_history'), 0) as o_ig_stories,
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)
              from pg_class c join pg_stat_user_tables s on s.relid = c.oid
              where c.relname = 'link_clicks'), 0) as o_link_clicks
),
-- Pente MESURÉE sur la fenêtre de 14 jours : (dernier - premier) / jours d'écart.
-- NULL tant qu'il n'y a pas 3 jours d'écart — la vue retombe alors sur le modèle.
mesure as (
  select
    case
      when max(jour) - min(jour) >= 3
      then ((select octets from taille_base_historique where jour = (select max(jour) from taille_base_historique where jour > current_date - 14))
          - (select octets from taille_base_historique where jour = (select min(jour) from taille_base_historique where jour > current_date - 14)))::numeric
           / nullif(max(jour) - min(jour), 0)
      else null
    end as octets_par_jour_mesure
  from taille_base_historique
  where jour > current_date - 14
),
calcul as (
  select
    pg_database_size(current_database())::numeric as octets,
    -- La mesure fait autorité dès qu'elle existe ; le modèle n'est que le repli
    -- des premiers jours. Une pente mesurée négative (grosse purge dans la
    -- fenêtre) vaut « pas de croissance », pas « erreur ».
    coalesce(m.octets_par_jour_mesure,
             l.ig_posts * p.o_ig_posts + l.yt_videos * p.o_yt_videos
           + l.ig_stories * p.o_ig_stories + l.link_clicks * p.o_link_clicks) as octets_par_jour
  from lignes_par_jour l, poids p, mesure m
)
select
  pg_size_pretty(octets::bigint) as taille_actuelle,
  pg_size_pretty(greatest(octets_par_jour, 0)::bigint) as croissance_par_jour,
  case when octets_par_jour > 0
       then floor((500::numeric * 1024 * 1024 - octets) / octets_par_jour)::integer
       else null end as jours_restants_plan_gratuit,
  case when octets_par_jour > 0
       then floor((8192::numeric * 1024 * 1024 - octets) / octets_par_jour)::integer
       else null end as jours_restants_plan_pro,
  case
    when octets >= 500::numeric * 1024 * 1024 then 'plafond gratuit atteint'
    when octets_par_jour > 0 and (500::numeric * 1024 * 1024 - octets) / octets_par_jour < 60
      then 'moins de 60 jours sur le plan gratuit'
    else 'ok'
  end as etat
from calcul;
