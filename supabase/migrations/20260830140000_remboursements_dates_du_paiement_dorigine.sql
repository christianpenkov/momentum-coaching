-- Les remboursements et litiges n'avaient aucune date, donc n'existaient nulle part
--
-- `deal_payments.paid_at` est la colonne qui BORNE les périodes partout dans
-- l'application : chaque écran filtre dessus en `gte`/`lte`. Or le webhook Stripe
-- l'écrivait à NULL pour tout statut autre que `succeeded` (recordPayment). Ces
-- lignes ne tombaient donc dans AUCUNE fenêtre, sur aucun écran, définitivement —
-- et n'étaient jamais déduites, alors que `lib/dealCash.ts` les soustrait.
--
-- Constaté le 2026-08-30 sur le deal a1e5b81e : 1 000 € encaissés, 200 € remboursés.
-- `calculerCash()` dit 800 € nets ; l'onglet Revenus et « Cash encaissé par origine »
-- disaient tous les deux 1 000 €.
--
-- Le code d'écriture est corrigé (app/api/webhooks/stripe/route.ts). Cette migration
-- rattrape les lignes déjà en base — nouvelle règle et backfill dans le même fichier,
-- jamais l'un sans l'autre.
--
-- ── Quelle date ? ───────────────────────────────────────────────────────────────
-- Celle du PAIEMENT D'ORIGINE, pas celle du remboursement (décision de Chris,
-- 2026-08-30). Le remboursement se soustrait au mois où l'argent était entré : ce
-- mois-là finit donc par dire ce qu'il a réellement rapporté. En contrepartie, un
-- mois déjà consulté peut changer de montant quand un remboursement arrive.
--
-- Pour les lignes déjà écrites, la date d'origine n'est pas stockée : on la retrouve
-- par le dernier encaissement réussi du MÊME deal antérieur à l'enregistrement de la
-- ligne. Quand un deal n'a qu'un encaissement — le cas courant — c'est exact.
-- Repli sur `created_at` s'il n'y en a aucun : une date approchée vaut mieux qu'un
-- NULL, qui rendrait la ligne invisible pour toujours.

update deal_payments dp
set paid_at = coalesce(
  (
    select p.paid_at
    from deal_payments p
    where p.deal_id = dp.deal_id
      and p.status = 'succeeded'
      and p.paid_at is not null
      and p.paid_at <= dp.created_at
    order by p.paid_at desc
    limit 1
  ),
  dp.created_at
)
where dp.status in ('refunded', 'disputed')
  and dp.paid_at is null;
