-- ⚠️ FICHIER RECONSTITUÉ le 2026-09-03. Appliquée le 2026-09-02, jamais versionnée.
--
-- Dernière des sept migrations retrouvées en réconciliant
-- `supabase_migrations.schema_migrations` avec les fichiers du dépôt. Contenu lu en base
-- le 2026-09-03 (`information_schema.columns`, `col_description`) : type, valeur par
-- défaut, nullabilité et commentaire sont ceux réellement en place.
--
-- Elle appartient au chantier Paiements, et va de pair avec la migration précédente
-- (`20260902143239_deal_payments_refund_reason`).
--
-- ── Ce que cette colonne rend possible ────────────────────────────────────────────
--
-- Elle porte le cumul des remboursements DÉJÀ EXPLIQUÉS sur une vente. L'écart non
-- expliqué vaut « somme des paiements `refunded` » moins cette valeur, et c'est cet écart
-- — pas la présence d'un remboursement — qui fait poser la question sur la fiche.
--
-- ⚠️ `not null default 0`, et le choix compte. Avec `null` par défaut, toute vente
-- ancienne aurait eu un écart « inconnu » impossible à distinguer d'un écart réel, et la
-- question se serait posée sur chacune. Zéro affirme quelque chose de vrai : rien n'a
-- encore été expliqué. C'est la règle du projet — « un 0 affirme quelque chose, un trou
-- dit qu'on ne sait pas » — appliquée dans le bon sens, parce qu'ici le zéro EST la
-- réalité de départ.
--
-- ⚠️ `numeric`, comme tous les montants de la plateforme. Un flottant ferait dériver le
-- cumul de quelques centimes au fil des additions, et l'écart non expliqué deviendrait
-- non nul tout seul — donc une question posée à l'élève sans qu'il se soit rien passé.

alter table public.deals
  add column if not exists refund_explique numeric not null default 0;

comment on column public.deals.refund_explique is
  'Cumul des remboursements deja expliques. L''ecart non explique vaut (somme des '
  'refunded) - cette valeur ; c''est lui qui declenche la question sur la fiche.';
