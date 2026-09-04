-- « Publications » compte aussi les STORIES, comme Mes Stats.
--
-- Relevé par Chris le 2026-09-04 : `PageClientStats` compte
-- `posts + reels + vidéos YouTube + stories` dans son KPI « Publications ».
-- Stats Clients n'en comptait que les deux premiers. Deux écrans, le même mot, deux
-- nombres.
--
-- ⚠️ C'est exactement la classe de défaut que le projet a déjà payée : « les onze écarts
-- entre écrans du 2026-08-19 venaient tous d'une règle de périmètre recopiée ». Mes Stats
-- est l'écran en place, Stats Clients le nouvel arrivant : c'est à lui de s'aligner, pas
-- d'imposer une troisième définition.
--
-- ⚠️ CE QU'IL FAUT SAVOIR SUR LES STORIES : elles expirent en 24 h et ne se rattrapent
-- pas. Seules celles qu'un passage du cron a vues existent. Une fenêtre antérieure en
-- compte donc zéro, LÉGITIMEMENT — contrairement aux posts et aux vidéos, que le backfill
-- récupère rétroactivement. Sur le graphe des semaines d'accompagnement, qui remonte à
-- l'arrivée de l'élève, les premières semaines sous-comptent donc les stories.
--
-- La date d'une story vient de `ig_stories.posted_at`, PAS de
-- `analytics_ig_stories_history` qui n'en porte aucune. Même source que Mes Stats.

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
      -- NIVEAU : la dernière valeur CONNUE de la fenêtre, jamais la somme.
      (array_agg(s.ig_followers   order by s.date desc) filter (where s.ig_followers   is not null))[1] as ig_followers,
      (array_agg(s.yt_subscribers order by s.date desc) filter (where s.yt_subscribers is not null))[1] as yt_subscribers,
      -- FLUX : la somme.
      sum(s.ig_views)              as ig_views,
      sum(s.ig_profile_views)      as ig_profile_views,
      sum(s.shortio_human_clicks)  as clics
    from analytics_daily_snapshots s
    where s.profile_id = any(p_profile_ids)
      and s.date between p_debut and p_fin
      and s.archived_at is null
    group by 1, 2
  ),
  -- Un contenu publié = une publication, quelle que soit la plateforme et la forme.
  -- Les deux tables d'historique portent une ligne par contenu ET PAR JOUR, d'où le
  -- `distinct` : sans lui, un post publié il y a trois mois serait compté une fois par
  -- jour de son historique.
  --
  -- Les identifiants sont PRÉFIXÉS avant le `count(distinct)`. Les trois espaces de noms
  -- ne se télescopent pas aujourd'hui, mais rien ne le garantit : le préfixe rend le
  -- dédoublonnage correct par construction plutôt que par chance.
  contenus as (
    select
      p.profile_id,
      date_trunc((select unite from borne),
                 ((p.published_at at time zone 'Europe/Paris')::date)::timestamp)::date as fenetre,
      'ig:' || p.post_id as contenu_id
    from analytics_ig_posts_history p
    where p.profile_id = any(p_profile_ids)
      and p.published_at is not null
      and p.deleted_at is null
      and p.archived_at is null
      and (p.published_at at time zone 'Europe/Paris')::date between p_debut and p_fin
    union all
    -- ⚠️ `analytics_yt_videos_history` n'a NI `deleted_at` NI `archived_at`, contrairement
    -- à son équivalent Instagram : une vidéo supprimée sur YouTube reste comptée tant que
    -- la table la porte, et l'isolation par archivage lors d'une bascule de compte ne s'y
    -- applique pas. Non corrigé ici — ce serait une migration de schéma sur une table
    -- alimentée par un cron.
    select
      v.profile_id,
      date_trunc((select unite from borne),
                 ((v.published_at at time zone 'Europe/Paris')::date)::timestamp)::date,
      'yt:' || v.video_id
    from analytics_yt_videos_history v
    where v.profile_id = any(p_profile_ids)
      and v.published_at is not null
      and (v.published_at at time zone 'Europe/Paris')::date between p_debut and p_fin
    union all
    select
      st.profile_id,
      date_trunc((select unite from borne),
                 ((st.posted_at at time zone 'Europe/Paris')::date)::timestamp)::date,
      'st:' || st.ig_story_id
    from ig_stories st
    where st.profile_id = any(p_profile_ids)
      and st.posted_at is not null
      and st.archived_at is null
      and (st.posted_at at time zone 'Europe/Paris')::date between p_debut and p_fin
  ),
  publies as (
    select profile_id, fenetre, count(distinct contenu_id) as publications
    from contenus
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
    -- Ne RIEN trouver n'est pas « on ne sait pas » : c'est ZÉRO publication.
    -- `publications` est comptée par ÉNUMÉRATION, contrairement aux colonnes ci-dessus
    -- qui sont relevées par un collecteur — chez elles un NULL dit « pas mesuré ».
    -- `s.profile_id is not null` prouve que la collecte tournait sur cette fenêtre :
    -- sans cette condition, on affirmerait « zéro publication » sur une période où l'on
    -- ne mesurait rien du tout, ce qui inventerait une donnée au lieu d'en cacher une.
    case when s.profile_id is not null then coalesce(po.publications, 0) else po.publications end
  from snaps s
  full join publies po
    on po.profile_id = s.profile_id and po.fenetre = s.fenetre
  order by 1, 2;
$$;

comment on function public.stats_clients_series(uuid[], date, date, text) is
  'Séries agrégées de Stats Clients. « publications » = posts et reels Instagram '
  '+ vidéos YouTube + stories, dédoublonnés par contenu. MÊME définition que le KPI '
  '« Publications » de Mes Stats : le même mot doit donner le même nombre sur les deux '
  'écrans. ⚠️ Une story expire en 24 h et ne se rattrape pas, donc une fenêtre antérieure '
  'au premier passage du cron en compte zéro, légitimement.';

-- L'agrégat balaie `ig_stories` sur une fenêtre de dates, à chaque chargement de page.
create index if not exists idx_ig_stories_profil_poste
  on public.ig_stories (profile_id, posted_at) where archived_at is null;
