-- Le signal « ne publie plus » compte désormais les STORIES.
--
-- Tranché par Chris le 2026-09-04, avec les chiffres sous les yeux : sur son propre
-- compte, le signal disait 193 jours sans publier ; en comptant les stories il en dit 13.
-- Les quatre autres élèves ne bougent pas — ils n'en postent pas.
--
-- ⚠️ L'arbitrage n'était pas évident, et le motif doit survivre à ce fichier.
--
-- POUR : depuis ce matin, une story EST une publication partout ailleurs —
-- `stats_clients_series` les compte, la fiche client les compte, `PageClientStats` les
-- comptait déjà. Cette vue était la dernière à ne pas les compter, donc le même élève
-- recevait deux verdicts opposés selon l'écran. C'est la classe de défaut que le projet
-- a déjà payée onze fois le 2026-08-19.
--
-- CONTRE, et c'est ce qui a été écarté : une story se poste en dix secondes et disparaît
-- en vingt-quatre heures, là où un reel se produit. Un élève qui ne poste que des stories
-- décroche vraiment, et les compter rend le signal moins sensible. Chris a préféré la
-- cohérence entre écrans à la sensibilité du signal — le seuil reste par ailleurs à
-- 7 jours (`SEUIL_JOURS_SANS_PUBLIER`), donc son propre cas continue de se déclencher.
--
-- La date d'une story vient de `ig_stories.posted_at`, jamais de
-- `analytics_ig_stories_history` qui n'en porte aucune. Même source que partout ailleurs.
create or replace view public.derniere_publication_par_profil
with (security_invoker = true) as
select profile_id, max(published_at) as derniere_publication
from (
  select profile_id, published_at
  from public.analytics_ig_posts_history
  where published_at is not null and deleted_at is null and archived_at is null
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
  'Dernière publication par élève — posts et reels Instagram, vidéos YouTube, stories. '
  'Alimente le signal « ne publie plus » (SEUIL_JOURS_SANS_PUBLIER). Même périmètre que '
  '« publications » dans stats_clients_series : le même mot doit donner le même nombre '
  'sur tous les écrans.';
