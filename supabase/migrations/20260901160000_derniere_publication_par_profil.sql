-- Stats Clients — le 3e signal de la bande « à regarder » : l'arrêt de publication.
--
-- Deux écrans doivent afficher LES MÊMES élèves : la carte « Clients à surveiller » de
-- l'accueil coach et la bande de Stats Clients. La règle vit dans lib/clientSignals.ts,
-- mais elle a besoin d'une donnée que personne ne chargeait : le nombre de jours depuis
-- la dernière publication de chaque élève.
--
-- ── Pourquoi une VUE et pas une fonction ────────────────────────────────────────────
-- `security_invoker = true` fait hériter les politiques des deux tables sources, qui
-- portent déjà exactement le bon périmètre (« coach sees clients » en SELECT sur
-- analytics_ig_posts_history et analytics_yt_videos_history). Le coach voit ses élèves
-- et personne d'autre, sans une ligne de filtrage à écrire — et donc sans une ligne de
-- filtrage à oublier. Une fonction SECURITY DEFINER aurait imposé de réécrire ce filtre
-- à la main, et une erreur y exposerait les élèves d'un autre coach.
--
-- ── Pourquoi les deux index ─────────────────────────────────────────────────────────
-- Les index existants portent sur `snapshot_date`, qui est la date de RELEVÉ, pas de
-- publication : chaque post est re-photographié à chaque passage, donc
-- max(snapshot_date) vaut « aujourd'hui » pour tout élève ayant le moindre post. Sans
-- index sur `published_at`, le `max(...) group by profile_id` deviendrait un balayage
-- complet — 40 élèves × 300 publications, c'est la table qui grossit le plus vite.
--
-- ── Ce que la vue ne dit pas ────────────────────────────────────────────────────────
-- Un élève absent du résultat n'a PAS « zéro jour sans publier » : on ne sait pas.
-- lib/clientSignals.ts le traite comme `null` et n'évalue alors pas le signal, plutôt
-- que d'affirmer quelque chose. Un 0 affirme, un trou dit « on ne sait pas ».

create index if not exists idx_ig_posts_profile_publie
  on public.analytics_ig_posts_history (profile_id, published_at desc)
  where published_at is not null;

create index if not exists idx_yt_videos_profile_publie
  on public.analytics_yt_videos_history (profile_id, published_at desc)
  where published_at is not null;

create or replace view public.derniere_publication_par_profil
with (security_invoker = true) as
select
  profile_id,
  max(published_at) as derniere_publication
from (
  -- Instagram : on écarte les publications supprimées et celles d'un compte archivé
  -- après une bascule OAuth — elles ne racontent plus l'activité du compte courant.
  select profile_id, published_at
  from public.analytics_ig_posts_history
  where published_at is not null
    and deleted_at is null
    and archived_at is null
  union all
  select profile_id, published_at
  from public.analytics_yt_videos_history
  where published_at is not null
) as publications
group by profile_id;

comment on view public.derniere_publication_par_profil is
  'Date de la dernière publication (Instagram ou YouTube) par élève. Alimente le 3e signal de la bande « à regarder » — voir SEUIL_JOURS_SANS_PUBLIER dans lib/clientSignals.ts. Un profil absent signifie « on ne sait pas », jamais « n''a jamais publié ».';
