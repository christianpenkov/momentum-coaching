-- ─────────────────────────────────────────────────────────────────────────────
-- Une nouvelle origine : la personne a écrit la première
--
-- ── CE QUI MANQUAIT ──────────────────────────────────────────────────────────
--
-- Le webhook ne créait de fiche Cold DM que dans la branche `is_echo`, c'est-à-
-- dire uniquement pour les messages que l'élève ENVOIE. Le chemin des messages
-- REÇUS se contentait de mettre à jour une fiche existante — il n'avait aucun
-- `else`.
--
-- Conséquence : quelqu'un qui écrivait spontanément, sans avoir commenté ni
-- répondu à une story, n'apparaissait NULLE PART dans le pipeline. Pas une fiche
-- mal étiquetée : aucune fiche. Vérifié en base — les trois fiches `cold_dm`
-- existantes sont toutes des messages partis de l'élève.
--
-- Décision de Chris (2026-09-05) : on crée la fiche, et c'est lui qui tranche
-- ensuite avec « ce n'est pas un lead ». Le bruit se retire à la main ; une
-- personne jamais vue ne se rattrape pas.
--
-- ── POURQUOI CETTE MIGRATION EXISTE ──────────────────────────────────────────
--
-- ⚠️ Une contrainte CHECK limitait `source` à quatre valeurs. Sans cette ligne,
-- l'insertion aurait été REFUSÉE par la base — et refusée en silence : le code
-- lit `fiche?.id`, donc un rejet ne produit ni fiche, ni erreur visible. C'est
-- très exactement le mode de panne de `cold_dm_sent`, écrit et rejeté pendant
-- des mois sans que personne ne le voie (voir AGENTS.md).
--
-- Elle a été trouvée en interrogeant `pg_constraint` AVANT de déployer, pas
-- après. Une contrainte de ce genre ne se lit dans aucun fichier du dépôt.
--
-- ── UNE ORIGINE, PAS UNE ÉTAPE ───────────────────────────────────────────────
--
-- `dm_entrant` répond à « d'où vient cette personne », jamais à « où en est-elle ».
-- Sa carte se range dans la MÊME colonne Cold DM qu'un démarchage sortant : les
-- deux sont au même endroit de l'entonnoir — un message existe, personne n'a
-- encore répondu. Le sens se lit sur le badge (↙ / ↗) et en toutes lettres dans
-- la fiche. La question se pose une seule fois, dans `lib/origineLead.ts`.
--
-- ── L'ATTRIBUTION NE CHANGE PAS, ET C'EST VÉRIFIÉ ────────────────────────────
--
-- `app/api/payments/links` ne retient une origine qu'À DÉFAUT de premier contact
-- (`if (!firstTouch && …)`). Une vente va donc au dernier contenu complet — un
-- lead arrivé par DM entrant qui prend ensuite un lead magnet et achète crédite
-- le LEAD MAGNET. C'est la règle que Chris a confirmée le 2026-09-05.
--
-- Et une fiche non-`cold_dm` sans contenu tombe déjà dans la branche `organic`,
-- ce qu'un DM entrant EST. Aucune ligne d'attribution à modifier.
--
-- ── LA VALEUR 'dm', LAISSÉE TELLE QUELLE ─────────────────────────────────────
--
-- La contrainte autorisait déjà 'dm', que rien n'écrit (0 ligne en base, aucune
-- occurrence dans le code). Elle n'est pas retirée ici : une migration qui
-- ajoute une possibilité ne doit pas en supprimer une au passage, et un retrait
-- se prouve sur l'historique complet, pas sur l'état du jour.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.instagram_leads
  drop constraint if exists instagram_leads_source_check;

alter table public.instagram_leads
  add constraint instagram_leads_source_check
  check (source = any (array['dm'::text, 'comment'::text, 'cold_dm'::text, 'story_reply'::text, 'dm_entrant'::text]));

comment on column public.instagram_leads.source is
  'D''ou vient la personne, fige a la premiere detection : comment | cold_dm (on a ecrit) | dm_entrant (elle a ecrit) | story_reply. Ce n''est PAS une etape, et ce n''est PAS l''attribution d''une vente (voir app/api/payments/links). La question se pose dans lib/origineLead.ts.';

-- Aucun rattrapage : personne ne peut être reclassé rétroactivement. Les
-- messages entrants d'avant ce jour n'ont laissé aucune trace exploitable — la
-- fiche n'existait pas. Un `0` inventé affirmerait qu'il n'y en a jamais eu.
