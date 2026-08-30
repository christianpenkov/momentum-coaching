-- Passage a l'echelle de la collecte des contenus Instagram (objectif 30-40 eleves).
--
-- Deux tables « une ligne par post », jamais « une ligne par post et par jour ».
-- Meme profil de donnee que ig_post_durees : a etablir une fois, pas a rafraichir.
-- Leur taille suit le nombre de posts, jamais le nombre de jours.

-- ── 1. Vignette perennisee ───────────────────────────────────────────────────
--
-- La vignette d'un post est copiee dans le bucket `instagram-post-thumbnails` a la
-- premiere collecte, parce que l'URL servie par Meta expire. Jusqu'ici, savoir si
-- cette copie existait deja coutait UN appel `storage.list()` PAR POST ET PAR
-- PASSAGE — 15 posts x 4 profils aujourd'hui, 500 x 40 = 20 000 par nuit a la
-- cible. Le cache en memoire ne servait qu'a l'interieur d'une invocation.
--
-- L'URL est deterministe (`<bucket>/<post_id>.jpg`) et definitive. La retenir ici,
-- c'est remplacer 20 000 appels par UNE lecture par profil.
--
-- `indisponible` : Meta n'a pas servi l'image (URL expiree cote CDN, media
-- protege). Distinct de l'absence de ligne, qui vaut « pas encore essaye ».
create table if not exists ig_post_vignettes (
  post_id       text primary key,
  profile_id    uuid not null references profiles(id) on delete cascade,
  url           text,
  indisponible  boolean not null default false,
  mesure_le     timestamptz not null default now(),
  constraint ig_post_vignettes_coherence check (
    (url is not null and indisponible = false)
    or (url is null and indisponible = true)
  )
);

create index if not exists ig_post_vignettes_profil on ig_post_vignettes (profile_id);

alter table ig_post_vignettes enable row level security;

create policy "ig_post_vignettes_lecture" on ig_post_vignettes
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from clients c where c.profile_id = ig_post_vignettes.profile_id and c.coach_id = auth.uid())
  );

-- Backfill : les vignettes deja perennisees vivent dans
-- `analytics_ig_posts_history.thumbnail`. Sans cette reprise, le premier passage
-- rejouerait le telechargement + l'upload de chaque post deja traite.
-- Seules les URL du bucket sont reprises : une URL Meta (`*.cdninstagram.com`)
-- expire, elle ne prouve pas qu'une copie existe.
insert into ig_post_vignettes (post_id, profile_id, url, indisponible, mesure_le)
select distinct on (h.post_id)
  h.post_id, h.profile_id, h.thumbnail, false, h.snapshot_at
from analytics_ig_posts_history h
where h.thumbnail like '%/storage/v1/object/public/instagram-post-thumbnails/%'
order by h.post_id, h.snapshot_date desc
on conflict (post_id) do nothing;

-- ── 2. Memoire des refus d'insights ──────────────────────────────────────────
--
-- Constate contre l'API reelle le 2026-08-30 : certains posts ne rendront JAMAIS
-- d'insights. Le cas le plus frequent est le sous-code 2108006 — « publie avant la
-- conversion du compte en compte professionnel ». Sur le compte de test, 2 posts
-- sur 14 sont dans ce cas, et aucune metrique n'y repond, ni groupee ni unitaire.
--
-- Sans memoire, ces posts sont redemandes chaque nuit pour rien — et surtout, comme
-- les insights sont desormais lus par lots (`?ids=`), UN post refuse fait echouer
-- TOUT le lot. Les exclure n'est donc pas une economie, c'est ce qui rend le
-- groupage possible.
--
-- `jeu_metriques` est une degradation, pas un interrupteur :
--   'complet' — jeu complet (l'absence de ligne vaut 'complet')
--   'reduit'  — seules les 5 metriques communes repondent ; les metriques propres
--               au type de media ont ete refusees. C'est ce qui absorbe SANS
--               INTERVENTION une depreciation de metrique cote Meta : la
--               plateforme perd la metrique concernee, pas toutes les autres.
--   'aucun'   — le post ne rend aucune metrique.
--
-- `reessayer_apres` : null = definitif (2108006 ne se leve jamais). Une date pour
-- tout le reste, pour qu'une panne passagere ne condamne pas un post a vie.
create table if not exists ig_post_insights_etat (
  post_id          text primary key,
  profile_id       uuid not null references profiles(id) on delete cascade,
  ig_account_id    text,
  jeu_metriques    text not null default 'complet',
  code             integer,
  sous_code        integer,
  message          text,
  constate_le      timestamptz not null default now(),
  reessayer_apres  timestamptz,
  constraint ig_post_insights_etat_jeu check (jeu_metriques in ('complet', 'reduit', 'aucun'))
);

create index if not exists ig_post_insights_etat_profil on ig_post_insights_etat (profile_id);

alter table ig_post_insights_etat enable row level security;

create policy "ig_post_insights_etat_lecture" on ig_post_insights_etat
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from clients c where c.profile_id = ig_post_insights_etat.profile_id and c.coach_id = auth.uid())
  );

-- ── 3. Vue de sante ──────────────────────────────────────────────────────────
--
-- Meme regle que yt_sante_donnees : une vue, rien a maintenir, rien a purger.
-- Elle repond a la seule question qui compte — « des posts sont-ils muets sans
-- qu'on le sache ? ». Un post 'aucun' definitif n'est PAS une anomalie : c'est une
-- limite connue de Meta. Une degradation 'reduit' recente, elle, signale une
-- depreciation de metrique en cours, qui merite un oeil.
create or replace view ig_sante_insights_posts as
select
  e.profile_id,
  count(*) filter (where e.jeu_metriques = 'aucun' and e.reessayer_apres is null)  as posts_muets_definitif,
  count(*) filter (where e.jeu_metriques = 'aucun' and e.reessayer_apres is not null) as posts_muets_temporaire,
  count(*) filter (where e.jeu_metriques = 'reduit')                                as posts_metriques_reduites,
  max(e.constate_le) filter (where e.jeu_metriques = 'reduit')                      as derniere_degradation,
  case
    when count(*) filter (where e.jeu_metriques = 'reduit' and e.constate_le > now() - interval '7 days') > 0
      then 'depreciation_metrique_probable'
    else 'ok'
  end as etat
from ig_post_insights_etat e
group by e.profile_id;
