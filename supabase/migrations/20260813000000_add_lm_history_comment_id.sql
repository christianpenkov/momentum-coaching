-- BUG "doublon lm_history" (trouvé 2026-08-13) : la contrainte unique
-- (profile_id, ig_user_id, media_id, detected_at) échouait à dédupliquer un même
-- commentaire traité à la fois par le webhook temps réel et par le cron pollIgComments
-- (fallback) — chacun calcule un detected_at légèrement différent pour le même
-- commentaire (webhook : value.timestamp du payload, souvent absent → new Date() au
-- moment du traitement ; cron : timestamp exact du commentaire renvoyé par l'API Meta).
-- Résultat observé : 2 lignes "Lead magnet réclamé" quasi simultanées dans le détail du
-- lead pour un seul vrai commentaire. comment_id (identifiant Meta stable, disponible
-- côté webhook ET côté cron) remplace detected_at comme clé de déduplication — les deux
-- sources convergent maintenant vers la même ligne.

alter table instagram_lead_lm_history add column if not exists comment_id text;

alter table instagram_lead_lm_history drop constraint if exists instagram_lead_lm_history_unique_event;

-- Nullable en fallback (comment_id peut être absent sur d'anciennes lignes ou si Meta ne
-- le fournit pas) : une contrainte unique classique ignore les lignes NULL, donc les
-- anciennes lignes sans comment_id restent non affectées par cette nouvelle contrainte.
create unique index instagram_lead_lm_history_unique_comment
  on instagram_lead_lm_history (profile_id, ig_user_id, media_id, comment_id)
  where comment_id is not null;

comment on column instagram_lead_lm_history.comment_id is 'Identifiant Meta du commentaire (value.id côté webhook, comment.id côté cron pollIgComments) — clé de déduplication stable entre les deux sources, contrairement à detected_at qui peut légèrement différer entre elles pour le même commentaire.';

-- Backfill : les lignes existantes n'ont pas de comment_id (colonne nouvelle), donc la
-- nouvelle contrainte (WHERE comment_id IS NOT NULL) ne les affecte pas rétroactivement —
-- elles restent potentiellement en doublon jusqu'à expiration naturelle des futurs
-- passages du cron sur ce media, sans nettoyage automatique ici (pas de comment_id
-- disponible a posteriori sans réappeler l'API Meta pour chaque ligne).
