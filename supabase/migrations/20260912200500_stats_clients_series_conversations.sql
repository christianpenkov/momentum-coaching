-- « Nouvelles conversations » rejoint les séries de Stats Clients.
--
-- Nouvelle version intégrale de `stats_clients_series` : c'est la convention du dépôt,
-- chaque changement re-crée la fonction entière plutôt que d'en modifier un morceau.
-- Le diff avec 20260906190000 tient en trois endroits — la colonne dans le `returns
-- table`, la somme dans le CTE `snaps`, et la projection finale.
--
-- ⚠️ FLUX et non NIVEAU : la colonne compte les fils APPARUS pendant la journée, donc
-- elle s'additionne sur la fenêtre, comme `ig_views`. C'est tout l'intérêt d'avoir
-- choisi « nouvelles » plutôt qu'« actives » — voir 20260912200000.
--
-- ⚠️ Pas de `coalesce(…, 0)` : contrairement à `publications`, cette colonne n'est PAS
-- comptée par énumération à la lecture. Un NULL y dit « la mesure n'a pas été prise »
-- — parce que l'élève n'a pas accordé la lecture de ses DM, ou parce que le cron n'est
-- pas passé — et surtout pas « aucune conversation ce jour-là ». Écrire zéro à la
-- place inventerait une mesure.

-- ⚠️ `drop` avant `create` : Postgres refuse un `create or replace` qui change le
-- `returns table` (« cannot change return type of existing function »). La fonction est
-- lue par le NAVIGATEUR du coach via PostgREST, jamais référencée par une vue ni une
-- contrainte, donc la supprimer un instant ne casse aucune dépendance — un appel tombant
-- pile dans l'intervalle recevrait une erreur, et la page se recharge.
drop function if exists public.stats_clients_series(uuid[], date, date, text);

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
  publications bigint,
  ig_conversations_nouvelles bigint
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
      -- Un fil n'est compté qu'au jour de son apparition : la somme sur la fenêtre est
      -- donc bien un nombre de fils distincts, jamais un même fil recompté.
      sum(s.ig_conversations_nouvelles) as ig_conversations_nouvelles
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
    case when s.profile_id is not null then coalesce(po.publications, 0) else po.publications end,
    s.ig_conversations_nouvelles
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

-- La vue du signal « ne publie plus », meme perimetre — voir l'en-tete.
create or replace view public.derniere_publication_par_profil
with (security_invoker = true) as
select profile_id, max(published_at) as derniere_publication
from (
  select profile_id, published_at
  from public.analytics_ig_posts_history
  where published_at is not null and archived_at is null
  union all
  select profile_id, published_at
  from public.analytics_yt_videos_history
  where published_at is not null
  union all
  select profile_id, posted_at
  from public.ig_stories
  where posted_at is not null and archived_at is null
) publications
group by profile_id;

comment on view public.derniere_publication_par_profil is
  'Derniere publication par eleve — posts et reels Instagram, videos YouTube, stories. '
  'Alimente le signal « ne publie plus » (SEUIL_JOURS_SANS_PUBLIER). Meme perimetre que '
  '« publications » dans stats_clients_series : le meme mot doit donner le meme nombre '
  'sur tous les ecrans. Un post supprime compte : il a ete publie (2026-09-06).';

-- ⚠️ PAS de `revoke` ici, contrairement aux quinze vues de sante. Celle-ci est lue par le
-- NAVIGATEUR du coach (signal « ne publie plus » de Stats Clients), et son
-- `security_invoker = true` fait deja le travail : la RLS de chaque table source
-- s'applique, donc `anon` ne lit aucune ligne et un coach ne voit que ses eleves. C'est
-- exactement le cas que 20260903170000 decrit comme satisfaisant l'invariant sans etre
-- touche. Un `revoke` ici casserait la page.
