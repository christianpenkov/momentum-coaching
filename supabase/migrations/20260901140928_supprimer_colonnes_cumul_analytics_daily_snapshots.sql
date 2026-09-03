-- ⚠️ FICHIER RECONSTITUÉ le 2026-09-03. Appliqué le 2026-09-01, jamais versionné.
--
-- Retrouvé en réconciliant `supabase_migrations.schema_migrations` avec les fichiers du
-- dépôt : sept migrations des 1ᵉʳ au 3 septembre n'existaient que dans la base.
--
-- ── Comment la liste des colonnes a été RETROUVÉE, et non devinée ─────────────────
--
-- PostgreSQL ne conserve pas le nom d'une colonne supprimée (l'entrée survit dans le
-- catalogue sous `........pg.dropped.N........`), donc la base ne pouvait pas répondre.
-- La liste vient du commit `061c092`, « Retirer les ecrivains des huit colonnes de cumul,
-- avant de les supprimer », qui les nomme une par une dans son message — c'est l'étape 1
-- d'une procédure en deux temps, cette migration étant l'étape 2.
--
-- Les neuf colonnes ci-dessous ont ensuite été vérifiées ABSENTES de la table le
-- 2026-09-03. Aucune n'est supposée.
--
-- ⚠️ `ig_response_rate` est incluse par prudence. Elle suivait la même procédure en deux
-- temps (commit `30527ed`), mais AUCUNE migration séparée ne porte sa suppression dans
-- `schema_migrations` : soit elle est partie avec ce lot, soit avec une migration
-- antérieure, elle aussi absente du dépôt. Le `if exists` rend les deux hypothèses sans
-- conséquence — ce qu'on sait avec certitude, c'est qu'elle n'existe plus.
--
-- ── Pourquoi elles sont parties (message du commit 061c092, mesuré le 2026-09-01) ──
--
--   * **C'étaient des cumuls depuis l'origine**, pas des valeurs du jour : le même total
--     répété sur chaque ligne (17, 17, 17, 18, 18, 18…). Leur nom suggérait un flux,
--     leur contenu était un cumul — les sommer sur 30 jours donnait 360 000 € au lieu de
--     12 000.
--   * **Aucun écran ne les lisait.** `lib/statsClients.ts` les documentait même comme
--     « une troisième nature » qu'il exclut de ses agrégations.
--   * **`revenue` sommait `calls.revenue`**, le montant DÉCLARÉ au rapport : 12 000 €
--     là où les ventes valent 10 200 €. Depuis le 2026-08-20 tous les écrans lisent
--     `deals`.
--   * **`mrr` et `stripe_active_subs` étaient vides sur 356 lignes.** L'appel Stripe de
--     l'Edge Function a été retiré le 2026-08-31 et n'avait jamais rien écrit.
--
-- « Les corriger aurait rendu juste une donnée que personne ne lit. »
--
-- ⚠️ L'ORDRE des deux étapes n'est pas cosmétique : un `insert` qui nomme une colonne
-- absente échoue EN ENTIER. Supprimer avant d'avoir déployé la version qui n'écrit plus
-- ces colonnes aurait cassé `poll-leads` toutes les 5 minutes. Toute suppression de
-- colonne sur ce projet suit donc ce schéma : retirer les écrivains, déployer, puis
-- supprimer.
--
-- ⚠️ Et le piège inverse, nommé dans le commit voisin : le tableau « colonnes mortes » de
-- `docs/instagram-scalabilite.md` donnait sept colonnes pour vides, mesurées sur 107
-- lignes. Remesurées sur 356, **trois s'étaient remplies depuis**. Une colonne vide n'est
-- pas une colonne morte — c'est une mesure datée.

alter table public.analytics_daily_snapshots
  drop column if exists calls_booked,
  drop column if exists calls_honored,
  drop column if exists calls_canceled,
  drop column if exists calls_no_show,
  drop column if exists deals_closed,
  drop column if exists revenue,
  drop column if exists mrr,
  drop column if exists stripe_active_subs,
  drop column if exists ig_response_rate;
