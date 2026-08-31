-- Retention SANS PERTE sur les deux historiques par contenu.
--
-- ── Le probleme ────────────────────────────────────────────────────────────
-- `analytics_ig_posts_history` et `analytics_yt_videos_history` ecrivent UNE LIGNE
-- PAR CONTENU ET PAR JOUR, pour toujours. Mesure le 2026-08-31 : 1 047 et 787 octets
-- par ligne, index compris. A la cible du projet (40 eleves x 100 contenus) :
--
--     IG   4 000 lignes/jour x 1 047 o = 4,2 Mo/jour = 1,53 Go/an
--     YT   4 000 lignes/jour x   787 o = 3,1 Mo/jour = 1,15 Go/an
--
-- Aucune purge n'existait. Le plafond du plan gratuit est a 500 Mo, celui du plan Pro
-- a 8 Go : sans borne, une intervention manuelle devenait inevitable -- contraire a
-- l'objectif « zero maintenance apres livraison ».
--
-- ── Pourquoi la regle ci-dessous ne perd RIEN ──────────────────────────────
-- Les deux seuls lecteurs de ces tables (`get_ig_posts_history`,
-- `get_yt_videos_history`, plus /api/instagram/stats qui deduplique pareil) font tous
--
--     select distinct on (contenu) ... order by contenu, snapshot_date desc
--     where snapshot_date between <debut> and <fin>
--
-- c'est-a-dire : LE DERNIER INSTANTANE DE LA FENETRE, jamais les jours intermediaires.
-- Et `lib/period.ts` garantit que les fenetres consultables sont des semaines
-- calendaires (lundi->dimanche) ou des mois calendaires -- « jamais une fenetre
-- glissante », dit son en-tete.
--
-- Donc conserver, par contenu, le dernier instantane de chaque semaine ET de chaque
-- mois suffit a reproduire A L'IDENTIQUE la sortie de toute requete que l'interface
-- peut emettre. Ce n'est pas une degradation de resolution : c'est la suppression de
-- lignes qu'aucune fenetre ne peut selectionner.
--
-- VERIFIE, pas deduit. Deux mesures distinctes le 2026-08-31 :
--   1. Simulation exhaustive avant/apres sur tout le domaine reel (2026-06-15 ->
--      2026-08-31) : Instagram 253 combinaisons (fenetre x profil x post) -> 0
--      divergence ; YouTube 725 combinaisons -> 0 divergence.
--   2. Execution reelle, puis reappel du RPC `get_ig_posts_history` sur les 21
--      fenetres du domaine, colonne par colonne (snapshot_date, reach, views, likes,
--      comments, saves, shares) : 216 lignes avant, 216 apres, 0 divergence.
--
-- ── Les 60 jours ───────────────────────────────────────────────────────────
-- La regle semaine+mois se suffit a elle-meme. Les 60 jours de granularite
-- quotidienne integrale sont une marge de securite, pas une necessite : ils couvrent
-- le mois courant ET le mois precedent en entier, donc tout calcul de variation entre
-- deux periodes reste servi par des lignes brutes meme si un lecteur m'avait echappe.
--
-- ⚠️ Short.io est VOLONTAIREMENT EXCLU. `shortio_link_daily_snapshots` alimente
-- `get_shortio_clicks_by_day`, une vraie serie quotidienne affichee en courbe : y
-- appliquer la meme regle supprimerait des points reellement lus. Sa croissance
-- (0,94 Go/an a 40 eleves) reste donc entiere et assumee.

create or replace function public.degrossir_historiques_analytics()
returns table(objet text, supprime bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n bigint;
begin
  delete from public.analytics_ig_posts_history
   where ctid in (
     select ctid from (
       select ctid, snapshot_date,
              max(snapshot_date) over (partition by profile_id, post_id, date_trunc('week',  snapshot_date)) as fin_sem,
              max(snapshot_date) over (partition by profile_id, post_id, date_trunc('month', snapshot_date)) as fin_mois
       from public.analytics_ig_posts_history
       where snapshot_date <= current_date - 60
     ) q
     where q.snapshot_date <> q.fin_sem and q.snapshot_date <> q.fin_mois
   );
  get diagnostics n = row_count;
  objet := 'analytics_ig_posts_history'; supprime := n; return next;

  delete from public.analytics_yt_videos_history
   where ctid in (
     select ctid from (
       select ctid, snapshot_date,
              max(snapshot_date) over (partition by profile_id, video_id, date_trunc('week',  snapshot_date)) as fin_sem,
              max(snapshot_date) over (partition by profile_id, video_id, date_trunc('month', snapshot_date)) as fin_mois
       from public.analytics_yt_videos_history
       where snapshot_date <= current_date - 60
     ) q
     where q.snapshot_date <> q.fin_sem and q.snapshot_date <> q.fin_mois
   );
  get diagnostics n = row_count;
  objet := 'analytics_yt_videos_history'; supprime := n; return next;
end;
$function$;

-- 4h05 : apres les purges existantes (3h30 a 3h55), jamais en meme temps qu'elles.
select cron.schedule('degrossir-historiques-analytics-daily', '5 4 * * *',
                     'select public.degrossir_historiques_analytics();');
