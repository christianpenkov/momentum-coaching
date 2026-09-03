-- « Publications » comptait Instagram SEULEMENT.
--
-- Défaut relevé par Chris le 2026-09-03 : la page affiche les abonnés YouTube dans le
-- même tableau, mais la colonne « Publications » ignorait les vidéos. Le mot promettait
-- plus que le chiffre ne donnait, et sur un élève actif sur YouTube il était faux.
--
-- Un `post_id` Instagram et un `video_id` YouTube vivent dans deux espaces de noms
-- distincts : ils ne peuvent pas se télescoper, donc additionner les deux comptes
-- distincts est correct.
--
-- ⚠️ `analytics_yt_videos_history` n'a NI `deleted_at` NI `archived_at`, contrairement à
-- son équivalent Instagram. Les deux filtres du côté IG n'ont donc pas de pendant ici.
-- Conséquence à connaître : une vidéo supprimée sur YouTube reste comptée tant que la
-- table la porte, et le mécanisme d'isolation par archivage (bascule de compte) ne
-- s'applique pas au YouTube. Ce n'est pas corrigé ici — ce serait une migration de
-- schéma sur une table alimentée par un cron, à faire à part.

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
  -- Un contenu = une publication, quelle que soit la plateforme. Les deux tables sont
  -- « une ligne par contenu et par jour », d'où le `distinct` : sans lui, un post publié
  -- il y a trois mois serait compté une fois par jour de son historique.
  contenus as (
    select
      p.profile_id,
      date_trunc((select unite from borne),
                 ((p.published_at at time zone 'Europe/Paris')::date)::timestamp)::date as fenetre,
      p.post_id as contenu_id
    from analytics_ig_posts_history p
    where p.profile_id = any(p_profile_ids)
      and p.published_at is not null
      and p.deleted_at is null
      and p.archived_at is null
      and (p.published_at at time zone 'Europe/Paris')::date between p_debut and p_fin
    union all
    select
      v.profile_id,
      date_trunc((select unite from borne),
                 ((v.published_at at time zone 'Europe/Paris')::date)::timestamp)::date,
      v.video_id
    from analytics_yt_videos_history v
    where v.profile_id = any(p_profile_ids)
      and v.published_at is not null
      and (v.published_at at time zone 'Europe/Paris')::date between p_debut and p_fin
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
    --
    -- Relevé par Chris le 2026-09-03 : la légende affichait « aucune donnée » sur tous
    -- les comptes pour la métrique Publications, alors que personne n'avait simplement
    -- rien publié. C'est la CINQUIÈME nature de donnée de cette page, distincte des
    -- quatre déjà documentées dans AGENTS.md :
    --
    --   • relevée par un collecteur (abonnés, vues, clics) → un NULL dit « pas mesuré »,
    --     et la base contient de vrais 0 à côté, ce qui le prouve ;
    --   • comptée par ÉNUMÉRATION (publications, et les quatre métriques métier) →
    --     l'absence de ligne signifie l'absence de contenu, donc zéro.
    --
    -- Les quatre métriques métier, comptées de la même façon en mémoire, rendaient déjà
    -- 0. `publications` était la seule à traiter « rien trouvé » comme « inconnu ».
    --
    -- ⚠️ `s.profile_id is not null` est la preuve que la collecte tournait pour cet élève
    -- sur cette fenêtre. Sans cette condition, on affirmerait « zéro publication » sur
    -- une période où l'on ne mesurait rien du tout — le défaut exactement inverse.
    case when s.profile_id is not null then coalesce(po.publications, 0) else po.publications end
  from snaps s
  full join publies po
    on po.profile_id = s.profile_id and po.fenetre = s.fenetre
  order by 1, 2;
$$;

comment on function public.stats_clients_series(uuid[], date, date, text) is
  'Séries agrégées de Stats Clients. « publications » = posts Instagram + vidéos YouTube, '
  'dédoublonnés par contenu. Les stories en sont volontairement exclues : elles sont '
  'éphémères, bien plus fréquentes, et n''ont pas de date de publication en base.';

-- L''agrégat balaie l''historique YouTube sur une fenêtre de dates : sans index, c''est un
-- Seq Scan de plus à chaque chargement de page, sur une table qui grossit d''une ligne par
-- vidéo et par jour.
create index if not exists idx_yt_videos_profil_publication
  on public.analytics_yt_videos_history (profile_id, published_at);
