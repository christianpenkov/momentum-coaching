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

-- BUG "upsert cassé par index partiel" (trouvé 2026-08-13, quelques heures après le
-- déploiement du fix ci-dessus) : la première version de cet index était partielle
-- (WHERE comment_id IS NOT NULL), en pensant qu'un index unique classique bloquerait les
-- lignes à comment_id NULL entre elles. Erreur : PostgreSQL ON CONFLICT (colonnes) exige
-- de cibler un index qui matche EXACTEMENT la clause — un index partiel ne peut être ciblé
-- que via ON CONFLICT (colonnes) WHERE <condition>, jamais généré automatiquement par
-- Supabase JS/PostgREST sur un simple `.upsert(..., { onConflict: '...' })`. Résultat :
-- chaque upsert écrivant dans instagram_lead_lm_history échouait avec l'erreur Postgres
-- 42P10 "no unique or exclusion constraint matching the ON CONFLICT specification" —
-- jamais catchée côté webhook (pas de vérification d'erreur sur cet appel), donc
-- silencieuse : plus AUCUNE ligne n'était écrite dans cette table depuis le déploiement,
-- alors même que le DM1 partait normalement et que le webhook logait "Lead stocké".
-- Un index unique NON partiel n'a en réalité pas besoin du WHERE pour obtenir le même
-- comportement voulu : PostgreSQL ne considère jamais deux valeurs NULL comme égales dans
-- une contrainte unique standard — les anciennes lignes à comment_id NULL ne se bloquent
-- donc jamais entre elles, sans avoir besoin d'exclure explicitement NULL de l'index.
create unique index instagram_lead_lm_history_unique_comment
  on instagram_lead_lm_history (profile_id, ig_user_id, media_id, comment_id);

comment on column instagram_lead_lm_history.comment_id is 'Identifiant Meta du commentaire (value.id côté webhook, comment.id côté cron pollIgComments) — clé de déduplication stable entre les deux sources, contrairement à detected_at qui peut légèrement différer entre elles pour le même commentaire. Index unique NON partiel (voir commentaire ci-dessus) — nécessaire pour que ON CONFLICT fonctionne via Supabase JS.';

-- Backfill : les lignes existantes n'ont pas de comment_id (colonne nouvelle), donc la
-- nouvelle contrainte (WHERE comment_id IS NOT NULL) ne les affecte pas rétroactivement —
-- elles restent potentiellement en doublon jusqu'à expiration naturelle des futurs
-- passages du cron sur ce media, sans nettoyage automatique ici (pas de comment_id
-- disponible a posteriori sans réappeler l'API Meta pour chaque ligne).
