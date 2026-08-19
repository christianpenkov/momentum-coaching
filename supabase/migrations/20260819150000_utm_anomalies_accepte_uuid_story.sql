-- La vue utm_anomalies ne testait que 2 des 3 formats d'identifiant de contenu
-- acceptés par le code (lib/contentId.ts, isValidContentId : post Instagram,
-- vidéo YouTube, UUID de séquence story). Le format UUID manquait, donc tout
-- rendez-vous venu d'une story était signalé à tort comme anomalie.
--
-- Détecté par le test story du 2026-08-19 : TestStory, utm_content =
-- d1ad9817-7369-4a52-b66e-6465644ef83a — valide côté code, rejeté par la vue.
-- Le chemin story n'avait jamais été exercé en conditions réelles, la branche
-- UUID de la validation non plus.
--
-- Même motif que les trois bugs UTM précédents (utm_content sur trois chemins
-- Calendly, source, buildDestUrl) : une règle en plusieurs exemplaires qui
-- divergent en silence. Cette vue est la copie SQL de isValidContentId — toute
-- évolution de l'une doit être répercutée dans l'autre.
CREATE OR REPLACE VIEW utm_anomalies AS
SELECT id, coach_id, scheduled_at, invitee_name, revenue,
       source, utm_medium, utm_campaign, utm_content, utm_term,
  CASE
    WHEN source LIKE '%.%'
      THEN 'source contient un domaine au lieu de la plateforme'
    WHEN utm_content IS NOT NULL
      AND utm_content !~ '^[0-9]{15,20}$'                       -- post Instagram
      AND utm_content !~ '^[A-Za-z0-9_-]{11}$'                  -- vidéo YouTube
      AND utm_content !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'  -- séquence story
      THEN 'utm_content ne contient pas un identifiant de contenu'
    WHEN utm_medium IS NOT NULL
      AND utm_medium <> ALL (ARRAY['bio','description','dm','story'])
      THEN 'utm_medium hors nomenclature : ' || utm_medium
    WHEN source IS NOT NULL
      AND split_part(source,'_',1) <> ALL (ARRAY['ig','yt'])
      THEN 'plateforme inconnue dans source : ' || split_part(source,'_',1)
    WHEN source IS NOT NULL AND utm_medium IS NOT NULL
      AND split_part(source,'_',2) <> utm_medium
      THEN 'source et utm_medium se contredisent'
    ELSE NULL
  END AS anomalie
FROM calls c
WHERE call_type = 'calendly';
