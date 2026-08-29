-- Duree d'un post video Instagram, en secondes.
--
-- Pourquoi une table a part et pas une colonne de `analytics_ig_posts_history` :
-- cette derniere porte une ligne par post ET PAR JOUR (675 lignes de Reels pour une
-- trentaine de posts distincts sur le profil de test). La duree, elle, ne change
-- jamais — la recopier sur chaque instantane serait la meme valeur ecrite des
-- centaines de fois, et il faudrait la re-mesurer a chaque nouvelle ligne.
--
-- Une cle par post, mesuree une seule fois. C'est le profil « donnee immuable »
-- de docs/checklist-scalabilite.md : a collecter une fois, jamais a rafraichir.
--
-- ── Pourquoi ce n'est pas l'API qui la donne ──────────────────────────────────
-- Meta ne sert AUCUN champ de duree sur l'objet media Instagram : `video_data`,
-- `duration`, `video_duration` et `length` repondent tous
-- « Tried accessing nonexisting field » sur graph.instagram.com (teste contre
-- l'API reelle le 2026-08-29). `video_data` existe sur l'objet video de la
-- Facebook Graph API, pas ici.
--
-- La duree se lit donc dans le FICHIER : `media_url` pointe le MP4 sur le CDN, une
-- requete `Range` sur les premiers ~400 Ko suffit a lire la boite `mvhd` de
-- l'en-tete (les fichiers Instagram sont en faststart). Mesure : 390 Ko et ~1,1 s
-- par post. RIEN N'EST STOCKE : les octets transitent en memoire, on garde le
-- nombre.
--
-- `indisponible` : un post sur douze n'a pas de `media_url` (musique protegee).
-- Sans ce drapeau, on le retelecharge a chaque passage, indefiniment. Il vaut
-- « on a essaye, Meta ne le donne pas » — a distinguer de « pas encore essaye »,
-- qui est l'absence de ligne.
create table if not exists ig_post_durees (
  post_id       text primary key,
  profile_id    uuid not null references profiles(id) on delete cascade,
  duree_sec     numeric,
  indisponible  boolean not null default false,
  mesure_le     timestamptz not null default now(),
  constraint ig_post_durees_coherence check (
    (duree_sec is not null and duree_sec > 0 and indisponible = false)
    or (duree_sec is null and indisponible = true)
  )
);

create index if not exists ig_post_durees_profil on ig_post_durees (profile_id);

alter table ig_post_durees enable row level security;

create policy "ig_post_durees_lecture" on ig_post_durees
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from clients c where c.profile_id = ig_post_durees.profile_id and c.coach_id = auth.uid())
  );
