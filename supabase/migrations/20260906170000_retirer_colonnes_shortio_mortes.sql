-- Retirer les quatre colonnes Short.io de `analytics_daily_snapshots`.
--
-- ── Pourquoi les supprimer plutôt que les laisser ───────────────────────────
--
-- Elles n'ont plus AUCUN écrivain depuis le 2026-08-28, et plus aucun lecteur depuis
-- le 2026-09-06 (`b216a82`, qui a rebranché `stats_clients_series` sur la table
-- vivante). Vérifié le 2026-09-06 avant suppression, sur les trois surfaces :
--
--   * code applicatif  : aucune occurrence hors commentaires ;
--   * base            : aucune fonction, aucune vue, aucun index ne les mentionne ;
--   * les trois RPC Short.io lisent toutes `shortio_link_daily_snapshots`.
--
-- Une colonne morte n'est pas inerte : elle contient des données d'apparence plausible,
-- figées, que le prochain auteur de requête lira sans se douter qu'elles ne bougent
-- plus. C'est exactement ce qui est arrivé — la carte « Clics » du coach a affiché
-- 550 clics pour un élève qui en avait 27, pendant neuf jours, sans qu'aucune alerte
-- ne se déclenche.
--
-- Le geste de `AGENTS.md` (« Personne ne lit cette colonne a une date de péremption »)
-- est donc la suppression : une colonne absente produit une erreur au premier `select`,
-- et c'est le seul signal qui ne se périme jamais. Un renommage aurait conservé les
-- données mais reporté la décision — quatre colonnes mortes que quelqu'un devrait
-- re-trancher un jour.
--
-- ── Ce qui est perdu, et pourquoi c'est accepté ─────────────────────────────
--
-- ⚠️ Le handoff qui a proposé ce ménage affirmait que « la table vivante couvre la même
-- période ». C'EST FAUX, et la vérification l'a montré :
--
--   colonnes supprimées ici              08/06/2026 → 28/08/2026
--   shortio_link_daily_snapshots         à partir du 19/07/2026
--
-- Un mois d'historique n'existe donc nulle part ailleurs : du 8 juin au 8 juillet,
-- soit 122 clics humains, 17 lignes de clics et 41 lignes de pays / référents.
--
-- Décision de Chris, 2026-09-06, prise en connaissance de cet écart : la perte est
-- acceptée, à la condition qu'août soit complet. Vérifié — 31 jours sur 31 présents
-- dans la table vivante, aucun trou.
--
-- ⚠️ Le backfill de ce mois manquant a été écarté, et pas par paresse : l'ancien format
-- est agrégé PAR JOUR ET PAR PROFIL, la table vivante est PAR LIEN. Il n'existe aucun
-- lien à qui attribuer ces clics — une recopie aurait donc inventé une ventilation.

alter table public.analytics_daily_snapshots
  drop column if exists shortio_clicks,
  drop column if exists shortio_human_clicks,
  drop column if exists shortio_top_countries,
  drop column if exists shortio_top_referrers;
