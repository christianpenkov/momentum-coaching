-- ⚠️ FICHIER RECONSTITUÉ le 2026-09-03. Appliquée le 2026-09-02, jamais versionnée.
--
-- Retrouvée en réconciliant `supabase_migrations.schema_migrations` avec les fichiers du
-- dépôt : sept migrations des 1ᵉʳ au 3 septembre n'existaient que dans la base.
-- Contenu lu en base le 2026-09-03 (`information_schema.columns`,
-- `pg_get_constraintdef`, `col_description`) — types, contrainte et commentaires sont
-- ceux réellement en place, rien n'est supposé.
--
-- Elle appartient au chantier Paiements (geste commercial et remboursements).
--
-- ── Ce que ces deux colonnes portent ──────────────────────────────────────────────
--
-- Pourquoi un remboursement a eu lieu. La distinction n'est pas décorative : elle décide
-- si l'argent rendu reste DÛ ou non.
--
--   * `erreur`            → l'encaissement n'aurait pas dû avoir lieu ; l'argent reste dû.
--   * `geste_commercial`  → remise consentie ; le montant de la vente baisse d'autant.
--   * `retractation`      → la vente est défaite ; rien n'est dû.
--   * `autre`             → précision libre dans `refund_reason_note`.
--
-- `null` ne veut pas dire « aucune raison » mais « pas encore demandée » : c'est l'écart
-- entre les remboursements enregistrés et ceux expliqués qui déclenche la question sur la
-- fiche (voir `deals.refund_explique`, migration suivante).
--
-- ⚠️ Une CONTRAINTE, et pas seulement une convention : un champ qui décide du sens d'un
-- montant ne doit pas pouvoir recevoir une chaîne libre. Le même principe que
-- `source_at_creation` côté liens — une valeur inattendue y serait rangée en silence dans
-- la mauvaise catégorie, et le chiffre affiché deviendrait faux sans que rien n'échoue.
--
-- ⚠️ Le `geste_commercial` a une conséquence qui a fait crier une alerte le 2026-09-03 :
-- il BAISSE `deals.amount_total` du montant rendu. La vue `ventes_sante_sur_encaissement`
-- comparait alors un encaissement BRUT à un montant contracté devenu plus petit, donc
-- alertait à chaque remise. Corrigée le même jour pour comparer le NET
-- (`encaissé − remboursé − contesté`, la règle unique de `lib/dealCash.ts`) —
-- `20260903150000_ventes_sante_sur_encaissement_net.sql`.

alter table public.deal_payments
  add column if not exists refund_reason      text,
  add column if not exists refund_reason_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deal_payments'::regclass
      and conname = 'deal_payments_refund_reason_check'
  ) then
    alter table public.deal_payments
      add constraint deal_payments_refund_reason_check
      check (refund_reason is null
             or refund_reason = any (array['geste_commercial', 'retractation', 'erreur', 'autre']));
  end if;
end $$;

comment on column public.deal_payments.refund_reason is
  'Pourquoi ce remboursement a eu lieu. NULL = pas encore demande. erreur = argent '
  'toujours du, les autres = non du.';

comment on column public.deal_payments.refund_reason_note is
  'Precision libre, saisie quand refund_reason = autre.';
