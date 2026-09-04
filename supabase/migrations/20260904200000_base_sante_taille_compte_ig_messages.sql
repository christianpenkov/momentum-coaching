-- base_sante_taille doit compter ig_messages dans son estimation de repli.
--
-- Cette vue est la SEULE alerte qui prévient avant que le plafond de stockage ne
-- fasse échouer les écritures d'un coup. Elle a deux chemins :
--
--   1. la MESURE — croissance réelle de la base sur 14 jours, lue dans
--      `taille_base_historique`. Ce chemin compte déjà ig_messages, puisqu'il
--      mesure `pg_database_size()` : rien à y faire.
--
--   2. le REPLI — une estimation table par table, utilisée seulement quand
--      l'historique porte moins de 3 jours. Celui-là est aveugle à toute table
--      qu'il ne nomme pas.
--
-- Le repli semble sans importance… jusqu'au jour où il compte : c'est exactement
-- l'état d'une base dont l'historique vient d'être vidé ou d'un transfert. Et ce
-- jour-là, la projection serait fausse ET rassurante, sur la table qui grossit
-- le plus vite du projet.
--
-- Même défaut que celui corrigé le 2026-08-31 pour `link_clicks`, et AGENTS.md
-- en donne déjà la règle : « une table qui grossit sans être comptée fait partir
-- l'alerte trop tard ». On ne la refait pas sur une table plus grosse.
--
-- ⚠️ Aucun autre changement : mêmes seuils (500 Mo / 8 Go), mêmes colonnes,
--    même logique. La sortie doit rester identique tant que la mesure existe.

create or replace view public.base_sante_taille as
with lignes_par_jour as (
  select
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)::numeric
                from analytics_ig_posts_history
               where snapshot_date > (current_date - 7)), 0::numeric)      as ig_posts,
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)::numeric
                from analytics_yt_videos_history
               where snapshot_date > (current_date - 7)), 0::numeric)      as yt_videos,
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)::numeric
                from analytics_ig_stories_history
               where snapshot_date > (current_date - 7)), 0::numeric)      as ig_stories,
    coalesce((select count(*)::numeric / nullif(count(distinct timezone('Europe/Paris'::text, occurred_at)::date), 0)::numeric
                from link_clicks
               where occurred_at > (now() - '7 days'::interval)), 0::numeric) as link_clicks,
    -- La table qui grossit le plus vite du chantier « conversations Instagram ».
    coalesce((select count(*)::numeric / nullif(count(distinct timezone('Europe/Paris'::text, cree_le)::date), 0)::numeric
                from ig_messages
               where cree_le > (now() - '7 days'::interval)), 0::numeric)  as ig_messages
), poids as (
  select
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)::numeric
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'analytics_ig_posts_history'::name), 0::numeric)   as o_ig_posts,
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)::numeric
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'analytics_yt_videos_history'::name), 0::numeric)  as o_yt_videos,
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)::numeric
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'analytics_ig_stories_history'::name), 0::numeric) as o_ig_stories,
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)::numeric
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'link_clicks'::name), 0::numeric)                  as o_link_clicks,
    -- ⚠️ Tant que la table est vide, n_live_tup vaut 0 et le coalesce rend 0 :
    --    l'estimation ignore ig_messages jusqu'à ce qu'elle porte des lignes.
    --    C'est le bon comportement — on n'invente pas un poids.
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)::numeric
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'ig_messages'::name), 0::numeric)                  as o_ig_messages
), mesure as (
  select case
    when (max(jour) - min(jour)) >= 3 then
      (((select octets from taille_base_historique
          where jour = (select max(jour) from taille_base_historique where jour > (current_date - 14))))
       - ((select octets from taille_base_historique
          where jour = (select min(jour) from taille_base_historique where jour > (current_date - 14)))))::numeric
      / nullif(max(jour) - min(jour), 0)::numeric
    else null::numeric
  end as octets_par_jour_mesure
  from taille_base_historique
  where jour > (current_date - 14)
), calcul as (
  select pg_database_size(current_database())::numeric as octets,
         coalesce(m.octets_par_jour_mesure,
                  l.ig_posts    * p.o_ig_posts
                + l.yt_videos   * p.o_yt_videos
                + l.ig_stories  * p.o_ig_stories
                + l.link_clicks * p.o_link_clicks
                + l.ig_messages * p.o_ig_messages) as octets_par_jour
    from lignes_par_jour l, poids p, mesure m
)
select pg_size_pretty(octets::bigint) as taille_actuelle,
       pg_size_pretty(greatest(octets_par_jour, 0::numeric)::bigint) as croissance_par_jour,
       case when octets_par_jour > 0::numeric
            then floor((500::numeric * 1024 * 1024 - octets) / octets_par_jour)::integer end
         as jours_restants_plan_gratuit,
       case when octets_par_jour > 0::numeric
            then floor((8192::numeric * 1024 * 1024 - octets) / octets_par_jour)::integer end
         as jours_restants_plan_pro,
       case
         when octets >= (500::numeric * 1024 * 1024) then 'plafond gratuit atteint'::text
         when octets_par_jour > 0::numeric
          and ((500::numeric * 1024 * 1024 - octets) / octets_par_jour) < 60::numeric
              then 'moins de 60 jours sur le plan gratuit'::text
         else 'ok'::text
       end as etat
  from calcul;
