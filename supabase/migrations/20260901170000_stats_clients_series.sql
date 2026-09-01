-- Stats Clients — l'agrégation des séries, côté base.
--
-- À 40 élèves en All-Time, la page devrait sinon rapatrier de l'ordre de 15 000 lignes
-- de analytics_daily_snapshots et les additionner en JavaScript. Cette fonction rend
-- quelques centaines de lignes déjà groupées. Même logique que get_ig_posts_history.
--
-- ═══ CE QU'ELLE NE PREND PAS, ET POURQUOI ═════════════════════════════════════════
--
-- `analytics_daily_snapshots` porte aussi calls_booked, calls_honored, deals_closed et
-- revenue. **Ils ne sont pas lus ici, délibérément.** Vérifié en base le 2026-09-01 sur
-- le profil a02e5927 :
--
--     date        calls_booked  deals_closed  revenue     ig_views
--     2026-08-20      17             8        12000.00       16
--     2026-08-28      17             8        12000.00       13
--     2026-08-29      18             8        12000.00       11
--
-- `revenue` vaut 12 000 € TOUS LES JOURS : c'est le cumul depuis le début, pas le
-- revenu du jour. poll-leads les écrit avec `calls.filter(...).length` sur tout
-- l'historique, réécrit à chaque passage. Les sommer sur 30 jours donnerait 360 000 €
-- au lieu de 12 000. Leur nom suggère un flux, leur contenu est un cumul.
--
-- Deuxième raison, indépendante : ils dérivent de `calls.revenue`, alors que depuis le
-- 2026-08-20 tous les écrans lisent `deals` — `calls.revenue` n'est plus qu'une trace
-- du rapport de call (voir AGENTS.md, « Le cash a UNE seule règle : lib/dealCash.ts »).
--
-- Calls, ventes et encaissements sont donc lus depuis leurs tables sources, avec les
-- règles de périmètre documentées (docs/perimetre-stats-referentiel.md,
-- docs/calls-coach-id-piege.md). Ils n'ont pas de problème de volume : quelques
-- milliers de lignes à 40 élèves, contre 15 000 pour les seuls snapshots quotidiens.
--
-- ═══ LES DEUX NATURES QUE CETTE FONCTION MANIPULE ═════════════════════════════════
--
--   NIVEAU  (une photo à un instant)   → DERNIÈRE valeur non nulle de la fenêtre
--           ig_followers, yt_subscribers
--           Les sommer donnerait 7× le nombre d'abonnés sur une semaine.
--
--   FLUX    (un compteur sur la période) → SOMME sur la fenêtre
--           ig_views, ig_profile_views, shortio_human_clicks, publications
--           En prendre la dernière ne verrait qu'un jour sur sept.
--
-- ⚠️ `ig_reach` est volontairement absent : la portée est DÉDUPLIQUÉE par Meta sur sa
-- fenêtre. La somme de sept portées quotidiennes compte plusieurs fois la même
-- personne — ce n'est ni un niveau ni un flux, et il n'existe aucune agrégation
-- correcte côté base. La portée reste affichée par élève, sur la page de l'élève.
--
-- ═══ SÉCURITÉ ═════════════════════════════════════════════════════════════════════
--
-- SECURITY INVOKER (le défaut, écrit explicitement pour que personne ne le change).
-- Les politiques de analytics_daily_snapshots (« coach sees clients ») et de
-- analytics_ig_posts_history donnent déjà exactement le bon périmètre : le coach voit
-- ses élèves et personne d'autre. En SECURITY DEFINER il faudrait réécrire ce filtre
-- à la main, et une erreur exposerait les élèves d'un autre coach.
--
-- ⚠️ `p_profile_ids` n'est donc PAS une preuve d'identité — un profile_id est public
-- (voir AGENTS.md). Passer l'identifiant d'un élève d'un autre coach ne renvoie rien,
-- parce que RLS filtre, pas parce que la fonction vérifie.
--
-- ═══ FENÊTRES CALENDAIRES ═════════════════════════════════════════════════════════
--
-- 'semaine' utilise date_trunc('week') — lundi, comme lib/period.ts. 'mois' est le
-- mois calendaire. Ce n'est pas cosmétique : c'est la garantie sur laquelle repose
-- degrossir_historiques_analytics(). Une fenêtre glissante l'invaliderait, et la perte
-- serait silencieuse (voir AGENTS.md).

create or replace function public.stats_clients_series(
  p_profile_ids uuid[],
  p_debut date,
  p_fin date,
  p_granularite text default 'jour'
)
returns table (
  profile_id uuid,
  fenetre date,
  ig_followers integer,
  yt_subscribers integer,
  ig_views bigint,
  ig_profile_views bigint,
  clics bigint,
  publications bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with borne as (
    select case
      when p_granularite = 'semaine' then 'week'
      when p_granularite = 'mois'    then 'month'
      else 'day'
    end as unite
  ),
  snaps as (
    select
      s.profile_id,
      date_trunc((select unite from borne), s.date::timestamp)::date as fenetre,
      -- NIVEAU : dernière valeur NON NULLE de la fenêtre. Le filtre importe autant que
      -- l'ordre — yt_subscribers et mrr peuvent être nuls les derniers jours avant le
      -- passage du cron, et prendre bêtement la plus récente rendrait alors null.
      (array_agg(s.ig_followers   order by s.date desc) filter (where s.ig_followers   is not null))[1] as ig_followers,
      (array_agg(s.yt_subscribers order by s.date desc) filter (where s.yt_subscribers is not null))[1] as yt_subscribers,
      -- FLUX : somme. coalesce à 0 par ligne, mais sum() rend null si TOUTES les lignes
      -- sont nulles — un trou reste un trou, il ne devient pas un zéro.
      sum(s.ig_views)              as ig_views,
      sum(s.ig_profile_views)      as ig_profile_views,
      sum(s.shortio_human_clicks)  as clics
    from analytics_daily_snapshots s
    where s.profile_id = any(p_profile_ids)
      and s.date between p_debut and p_fin
      -- Après une bascule de compte Instagram, les lignes archivées portent encore les
      -- chiffres de l'ancien compte. Même filtre que partout ailleurs.
      and s.archived_at is null
    group by 1, 2
  ),
  posts as (
    -- Une ligne par post et par jour de relevé : `distinct post_id` est obligatoire,
    -- sinon on compterait chaque publication autant de fois qu'elle a été photographiée.
    -- Et on regroupe sur published_at (la date de publication), pas snapshot_date.
    select
      p.profile_id,
      date_trunc((select unite from borne),
                 ((p.published_at at time zone 'Europe/Paris')::date)::timestamp)::date as fenetre,
      count(distinct p.post_id) as publications
    from analytics_ig_posts_history p
    where p.profile_id = any(p_profile_ids)
      and p.published_at is not null
      and p.deleted_at is null
      and p.archived_at is null
      and (p.published_at at time zone 'Europe/Paris')::date between p_debut and p_fin
    group by 1, 2
  )
  select
    coalesce(s.profile_id, po.profile_id) as profile_id,
    coalesce(s.fenetre, po.fenetre)       as fenetre,
    s.ig_followers,
    s.yt_subscribers,
    s.ig_views,
    s.ig_profile_views,
    s.clics,
    po.publications
  -- full join : une fenêtre où l'élève a publié sans qu'aucun snapshot n'existe reste
  -- visible, et inversement. Masquer l'une des deux ferait disparaître de la donnée
  -- réelle au motif que l'autre source était muette.
  from snaps s
  full join posts po
    on po.profile_id = s.profile_id and po.fenetre = s.fenetre
  order by 1, 2;
$$;

comment on function public.stats_clients_series(uuid[], date, date, text) is
  'Séries agrégées par élève et par fenêtre calendaire pour la page Stats Clients. NIVEAU (abonnés) = dernière valeur non nulle ; FLUX (vues, clics, publications) = somme. N''utilise PAS calls_booked / deals_closed / revenue des snapshots : ces colonnes sont des CUMULS depuis le début, pas des flux quotidiens — voir le commentaire de la migration.';
