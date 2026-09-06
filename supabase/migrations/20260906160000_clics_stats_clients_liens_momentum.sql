-- « Clics » du portefeuille coach : les liens Momentum seulement, comme Mes Stats
--
-- ── Le defaut ──────────────────────────────────────────────────────────────────────
--
-- Cette fonction sommait `analytics_daily_snapshots.shortio_human_clicks`, un total
-- quotidien qui ne porte AUCUNE categorie. Elle additionnait donc tous les clics du
-- compte Short.io de l'eleve, y compris ceux de ses liens personnels.
--
-- Mes Stats, lui, ne compte que les 11 categories Momentum (`BUSINESS_CATEGORIES` dans
-- lib/shortio-link-category.ts). Mesure du 2026-09-06 : 82 clics Momentum contre 93 au
-- total — 11 clics, 12 %, que la carte du coach comptait en trop.
--
-- Le meme mot « Clics » donnait donc deux nombres selon l'ecran, et c'est celui du coach
-- qui avait tort : un lien qu'un eleve raccourcit pour son usage personnel n'est pas une
-- metrique de coaching.
--
-- ── Pourquoi `link_category is not null` et PAS la liste des 11 ────────────────────
--
-- Recopier les 11 categories ici en ferait une deuxieme definition de « business », en
-- SQL, qui divergerait de celle de TypeScript au premier ajout — exactement le defaut
-- que lib/dealCash.ts a mis un mois a fermer.
--
-- Verifie le 2026-09-06 : `BUSINESS_CATEGORIES` contient EXACTEMENT les 11 valeurs du
-- type `LinkCategory`, ni plus ni moins. « Avoir une categorie » et « etre un lien
-- Momentum » sont donc aujourd'hui la meme chose, et le test de presence dit la meme
-- chose que la liste sans avoir a la maintenir. Le commentaire d'en-tete du fichier TS
-- pose d'ailleurs la regle dans ce sens : « ne jamais renvoyer null pour un lien
-- manifestement Momentum ».
--
-- ⚠️ CE QUI CASSERAIT CETTE EQUIVALENCE : le jour ou une categorie NON business est
-- ajoutee au type `LinkCategory`, ce filtre se met a compter trop, en silence. Ce
-- jour-la, et seulement ce jour-la, il faudra enumerer explicitement. Le garde-fou est
-- dans lib/shortio-link-category.ts, qui nomme cette migration.
--
-- ── Ce que ce changement fait PERDRE, et pourquoi c'est acceptable ────────────────
--
-- `analytics_daily_snapshots` porte `archived_at` ; `shortio_link_daily_snapshots` ne
-- l'a pas. Les clics ne sont donc plus filtres par l'archivage lors d'une bascule de
-- compte Instagram.
--
-- C'est sans consequence, et volontaire : un lien Short.io n'appartient pas a un compte
-- Instagram. Il survit a la bascule, ses clics restent les clics de l'eleve, et Mes
-- Stats ne les filtre pas davantage (la colonne n'existe pas non plus pour lui). Les
-- deux ecrans restent donc alignes, ce qui est le but de cette migration.

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
      sum(s.ig_profile_views)      as ig_profile_views
    from analytics_daily_snapshots s
    where s.profile_id = any(p_profile_ids)
      and s.date between p_debut and p_fin
      and s.archived_at is null
    group by 1, 2
  ),
  -- Les clics des seuls liens Momentum — voir l'en-tête pour le choix du prédicat.
  -- `sum()` rend NULL si aucune ligne : un trou reste un trou, il ne devient pas zéro,
  -- exactement comme les colonnes de flux ci-dessus.
  clics_momentum as (
    select
      c.profile_id,
      date_trunc((select unite from borne), c.date::timestamp)::date as fenetre,
      sum(c.human_clicks) as clics
    from shortio_link_daily_snapshots c
    where c.profile_id = any(p_profile_ids)
      and c.date between p_debut and p_fin
      and c.link_category is not null
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
  ),
  -- Trois sources désormais, donc l'axe est construit d'abord et les valeurs viennent
  -- s'y poser. Un `full join` en chaîne aurait obligé chaque condition suivante à
  -- joindre sur un `coalesce` des précédentes — juste, mais fragile à la relecture et
  -- silencieusement faux si une seule des coalesce est oubliée.
  cles as (
    select profile_id, fenetre from snaps
    union
    select profile_id, fenetre from publies
    union
    select profile_id, fenetre from clics_momentum
  )
  select
    k.profile_id,
    k.fenetre,
    s.ig_followers,
    s.yt_subscribers,
    s.ig_views,
    s.ig_profile_views,
    c.clics,
    -- Ne RIEN trouver n'est pas « on ne sait pas » : c'est ZÉRO publication.
    -- `publications` est comptée par ÉNUMÉRATION, contrairement aux colonnes ci-dessus
    -- qui sont relevées par un collecteur — chez elles un NULL dit « pas mesuré ».
    -- `s.profile_id is not null` prouve que la collecte tournait sur cette fenêtre :
    -- sans cette condition, on affirmerait « zéro publication » sur une période où l'on
    -- ne mesurait rien du tout, ce qui inventerait une donnée au lieu d'en cacher une.
    case when s.profile_id is not null then coalesce(po.publications, 0) else po.publications end
  from cles k
  left join snaps s
    on s.profile_id = k.profile_id and s.fenetre = k.fenetre
  left join publies po
    on po.profile_id = k.profile_id and po.fenetre = k.fenetre
  left join clics_momentum c
    on c.profile_id = k.profile_id and c.fenetre = k.fenetre
  order by 1, 2;
$$;

comment on function public.stats_clients_series(uuid[], date, date, text) is
  'Séries agrégées de Stats Clients. « publications » = posts et reels Instagram '
  '+ vidéos YouTube + stories, dédoublonnés par contenu. « clics » = les liens Momentum '
  'SEULEMENT (link_category non nulle), comme le KPI « Clics totaux » de Mes Stats : '
  'les liens personnels d''un élève ne sont pas une métrique de coaching. MÊME définition '
  'que Mes Stats pour les deux : le même mot doit donner le même nombre sur les deux '
  'écrans. ⚠️ Une story expire en 24 h et ne se rattrape pas, donc une fenêtre antérieure '
  'au premier passage du cron en compte zéro, légitimement.';

-- L'agrégat balaie la table des liens sur une fenêtre de dates, à chaque chargement.
create index if not exists idx_shortio_link_profil_date_categorie
  on public.shortio_link_daily_snapshots (profile_id, date)
  where link_category is not null;
