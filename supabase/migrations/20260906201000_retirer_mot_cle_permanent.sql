-- Le mot-clé permanent est abandonné : trop de mécanique pour le service rendu.
--
-- Décision de Chris le 2026-09-06, après l'avoir vu à l'écran. Un mot-clé
-- redevient ce qu'il était : une propriété du CONTENU (content_links) ou de la
-- SÉQUENCE (story_sequences). Le lead magnet ne porte que son nom, son fichier
-- et le mot-clé proposé par défaut aux contenus.
--
-- On retire tout, y compris l'index d'unicité : il n'existait que pour rendre la
-- résolution déterministe, et il interdirait maintenant sans raison deux lead
-- magnets portant le même mot-clé — un cas que rien n'empêchait avant.

drop index if exists lead_magnets_mot_cle_unique;

alter table lead_magnets
  drop column if exists repond_partout,
  drop column if exists dm_accroche,
  drop column if exists dm_accroche_bouton,
  drop column if exists dm_lien,
  drop column if exists dm_lien_bouton,
  drop column if exists dm_relance;
