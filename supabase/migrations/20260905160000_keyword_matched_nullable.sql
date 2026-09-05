-- ─────────────────────────────────────────────────────────────────────────────
-- Un Cold DM n'a pas de mot-clé, et la base doit pouvoir le dire
--
-- ── CE QUI ARRIVAIT ──────────────────────────────────────────────────────────
--
-- `instagram_leads.keyword_matched` était NOT NULL. Le webhook, qui doit bien
-- écrire quelque chose, inscrivait donc la chaîne 'cold_dm' sur chaque fiche
-- créée par un démarchage direct. Une valeur inventée : personne n'a commenté
-- ce mot, il n'existe dans aucun lead magnet.
--
-- Ce que ça donnait à l'écran, sur la même fiche :
--
--   « Mot-clé : #cold_dm »              ← un mot-clé qui n'existe pas
--   « Commentaire détecté (#cold_dm) »  ← ce n'était pas un commentaire
--   « commentaire cold_dm » (PageLiens) ← sous le titre « Origine DÉJÀ CONNUE »
--
-- ── LE VRAI DÉFAUT N'EST PAS L'AFFICHAGE ─────────────────────────────────────
--
-- Une valeur fausse en base oblige CHAQUE lecteur à apprendre l'exception, et il
-- suffit qu'un seul l'oublie. C'est exactement ce qui s'est passé :
-- `PagePipeline.tsx` portait déjà `keyword_matched !== 'cold_dm'` — quelqu'un
-- avait contourné le problème là où il le voyait — pendant que la fiche détaillée
-- et deux endroits de `PageLiens` affichaient toujours la valeur brute.
--
-- On corrige donc la donnée, pas les lecteurs. Les trois affichages redeviennent
-- justes sans qu'aucun n'ait à connaître le cas particulier, et l'exception
-- devenue inutile est retirée de `PagePipeline` dans le même commit.
--
-- ── POURQUOI NULL EST LA BONNE VALEUR ────────────────────────────────────────
--
-- Règle du projet : aucune donnée inventée. `'cold_dm'` AFFIRME un mot-clé ;
-- `null` dit « il n'y en a pas », ce qui est la vérité. L'origine, elle, est
-- portée par `source` — la colonne faite pour ça, déjà correcte sur ces fiches,
-- et c'est déjà ce que fait `app/api/payments/chain` : il teste `source` et non
-- le mot-clé.
--
-- ⚠️ La contrainte était à l'envers de sa propre sémantique : la table qui
-- enregistre VRAIMENT une correspondance de mot-clé, `instagram_lead_lm_history`,
-- accepte NULL. `prospect_links` aussi. Seule `instagram_leads`, où le mot-clé
-- est facultatif par nature, l'interdisait.
--
-- ── CE QUI NE CHANGE PAS ─────────────────────────────────────────────────────
--
-- Vérifié lecteur par lecteur avant d'écrire cette migration : les statistiques
-- de lead magnets lisent `instagram_lead_lm_history`, pas cette colonne — et une
-- fiche Cold DM n'a aucune ligne dans cette table. Aucun chiffre ne bouge.
-- Les séquences DM2/DM3 gardent toutes leur condition (`&&`, `??`), et une fiche
-- Cold DM n'entre dans aucune d'elles.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.instagram_leads
  alter column keyword_matched drop not null;

comment on column public.instagram_leads.keyword_matched is
  'Le mot-cle commente par la personne. NULL quand il n''y en a pas (Cold DM, reponse a une story) : l''origine est portee par `source`, jamais par une valeur inventee ici.';

-- Le rattrapage part avec la correction, pas après : le code ne réécrit jamais
-- ces fiches, donc sans cette ligne les trois existantes garderaient le faux
-- mot-clé pour toujours, et la correction n'aurait d'effet que sur les futures.
update public.instagram_leads
set keyword_matched = null
where keyword_matched = 'cold_dm';
