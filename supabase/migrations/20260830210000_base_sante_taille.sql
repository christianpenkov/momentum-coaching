-- Le plafond de stockage est le seul risque de cette plateforme qui ne previent pas.
-- Rien ne casse a l'avance, rien n'apparait dans cron_runs : les ecritures echouent, un
-- jour, d'un coup. Mesure le 2026-08-30 : plan GRATUIT (500 Mo), base a 97 Mo.
--
-- Les trois tables « une ligne par contenu ET PAR JOUR » sont les seules qui grossissent
-- avec le TEMPS plutot qu'avec le nombre d'eleves. Cette vue mesure leur rythme reel sur
-- les 7 derniers jours et le projette. Rien a stocker, rien a purger, rien a mettre a
-- jour — meme profil que yt_sante_donnees et integrations_sante.
--
-- Ordres de grandeur calcules le 2026-08-30, sur les 403 Mo restants du plan gratuit :
--   10 eleves x 100 posts  ->  ~15 mois (IG seul), ~8 mois si YouTube est aussi connecte
--   40 eleves x 100 posts  ->  ~4 mois
--   40 eleves x 300 posts  ->  ~6 semaines
-- Le plan Pro (8 Go) donne ~2,5 ans dans le pire de ces cas.
--
-- Les DEUX plafonds sont affiches en permanence : passer du gratuit au Pro ne demande
-- aucune modification ici.
create or replace view base_sante_taille as
with lignes_par_jour as (
  select
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)
                from analytics_ig_posts_history where snapshot_date > current_date - 7), 0) as ig_posts,
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)
                from analytics_yt_videos_history where snapshot_date > current_date - 7), 0) as yt_videos,
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)
                from analytics_ig_stories_history where snapshot_date > current_date - 7), 0) as ig_stories
),
-- Octets par ligne MESURES, jamais supposes : le chiffre s'ajuste tout seul si le schema
-- change ou si un index est ajoute ou retire.
poids as (
  select
    coalesce((select pg_total_relation_size(c.oid)::numeric / nullif(s.n_live_tup, 0)
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'analytics_ig_posts_history'), 0) as o_ig_posts,
    coalesce((select pg_total_relation_size(c.oid)::numeric / nullif(s.n_live_tup, 0)
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'analytics_yt_videos_history'), 0) as o_yt_videos,
    coalesce((select pg_total_relation_size(c.oid)::numeric / nullif(s.n_live_tup, 0)
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'analytics_ig_stories_history'), 0) as o_ig_stories
),
calcul as (
  select
    pg_database_size(current_database())::numeric as octets,
    l.ig_posts * p.o_ig_posts + l.yt_videos * p.o_yt_videos + l.ig_stories * p.o_ig_stories as octets_par_jour
  from lignes_par_jour l, poids p
)
select
  pg_size_pretty(octets::bigint)                                   as taille_actuelle,
  pg_size_pretty(greatest(octets_par_jour, 0)::bigint)             as croissance_par_jour,
  case when octets_par_jour > 0
       then floor((500::numeric * 1024 * 1024 - octets) / octets_par_jour)::int end as jours_restants_plan_gratuit,
  case when octets_par_jour > 0
       then floor((8192::numeric * 1024 * 1024 - octets) / octets_par_jour)::int end as jours_restants_plan_pro,
  case
    when octets >= 500::numeric * 1024 * 1024 then 'plafond gratuit atteint'
    when octets_par_jour > 0
         and (500::numeric * 1024 * 1024 - octets) / octets_par_jour < 60 then 'moins de 60 jours sur le plan gratuit'
    else 'ok'
  end as etat
from calcul;
