-- Remplit `ig_account_id` sur les instantanes quotidiens qui portent des metriques
-- Instagram sans dire de quel compte elles viennent.
--
-- Pendant du correctif d'ecriture du meme jour (poll-leads, commit 2e7436a) : la
-- colonne existait depuis le 2026-07-29 mais AUCUN chemin ne la renseignait. Toutes
-- les lignes ecrites depuis valaient NULL.
--
-- ── Portee stricte ─────────────────────────────────────────────────────────
-- Seules les lignes qui portent REELLEMENT des metriques Instagram sont remplies.
-- Une ligne sans `ig_views` ni `ig_reach` n'a aucune donnee Instagram : y ecrire un
-- compte mentirait sur la provenance, et c'est precisement ce que la colonne sert a
-- eviter. Mesure : 109 lignes de deux profils sans integration Instagram restent a
-- NULL a dessein — leur historique quotidien est purement YouTube et Short.io.
--
-- ── Pourquoi c'est sans ambiguite ──────────────────────────────────────────
-- Verifie AVANT d'ecrire : sur l'ensemble des lignes deja renseignees, il n'existe
-- qu'UN SEUL compte Instagram distinct par profil, et AUCUNE ligne archivee. Aucun
-- profil n'a donc jamais bascule d'un compte a un autre. Attribuer les lignes NULL
-- au compte actuellement connecte ne peut pas se tromper de provenance.
--
-- Si un profil avait bascule, ce backfill serait FAUX pour les lignes anterieures a
-- la bascule — d'ou la verification, qui doit etre REFAITE si cette migration devait
-- etre rejouee sur une autre base :
--
--   select profile_id, count(distinct ig_account_id), count(*) filter (where archived_at is not null)
--   from analytics_daily_snapshots where ig_account_id is not null group by 1;
--
-- ── Ce que ca change concretement ──────────────────────────────────────────
-- Rien aujourd'hui : depuis le correctif du matin, le callback OAuth Instagram
-- n'archive plus les lignes a NULL sur cette table (elles portent aussi les colonnes
-- yt_* et shortio_*, qu'un archivage emporterait). Cela rend en revanche une future
-- bascule vers un AUTRE compte Instagram FINE au lieu d'etre grossiere : les lignes
-- de l'ancien compte seront correctement distinguees, au lieu de rester visibles
-- faute de pouvoir les identifier.
--
-- Resultat mesure apres execution : 160 lignes renseignees, 0 ligne portant des
-- metriques Instagram sans compte, 1 seul compte distinct par profil.

update analytics_daily_snapshots s
set ig_account_id = i.metadata->>'ig_account_id'
from integrations i
where i.profile_id = s.profile_id
  and i.provider = 'instagram'
  and i.metadata->>'ig_account_id' is not null
  and s.ig_account_id is null
  and (s.ig_views is not null or s.ig_reach is not null);
