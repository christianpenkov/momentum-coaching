-- ⚠️ MIGRATION DÉPASSÉE LE JOUR MÊME. Ce qui suit décrit une colonne qui a été
-- renommée ET dont le contenu a changé de nature quelques heures plus tard, par
-- `20260907203000_story_sequences_arbitrage_parution.sql` — lire celle-là.
--
-- En deux mots : retenir l'HEURE DU CLIC était faux, parce que la parution d'une
-- story est datée par Instagram et le clic par notre serveur. La colonne porte
-- désormais une PARUTION, et s'appelle `stories_arbitrees_jusqua`.
--
-- Ce fichier reste ici parce qu'il a été appliqué, et qu'un rejeu depuis zéro doit
-- créer la colonne avant de la renommer. Rien d'autre ne doit s'y référer.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Quand le coach a rattaché des stories à cette séquence pour la dernière fois.
--
-- Sert à ne plus proposer ce qu'il a délibérément laissé de côté. Le raisonnement
-- tient en une phrase : au moment où il clique « Les rattacher », les stories
-- qu'il n'a PAS rattachées sont celles qu'il ne veut pas. Il n'y a donc rien à
-- mémoriser du geste de refus — l'acceptation le dit déjà.
--
-- Remplace un `localStorage` par appareil : la croix « ne pas rattacher celle-ci »
-- ne survivait qu'au navigateur qui l'avait cliquée, donc un refus sur ordinateur
-- réapparaissait sur téléphone. Cette colonne est lue par tous les appareils.
--
-- ⚠️ Colonne DÉDIÉE, et surtout pas `updated_at` : celui-ci bouge à chaque
-- modification — renommer la séquence, corriger un message — et effacerait
-- silencieusement des propositions en attente qui n'ont rien à voir.
alter table story_sequences
  add column if not exists stories_rattachees_le timestamptz;

comment on column story_sequences.stories_rattachees_le is
  'Dernier rattachement de stories par le coach. Les stories publiées AVANT cette date et restées libres ne sont plus proposées : ne pas les avoir rattachées à ce moment-là valait refus.';
