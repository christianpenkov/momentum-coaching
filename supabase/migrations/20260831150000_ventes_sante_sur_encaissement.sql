-- Un deal ne peut pas avoir encaissé plus qu'il ne vaut
--
-- L'invariant : `somme des paiements réussis <= deals.amount_total`. Le franchir
-- signifie qu'une même somme a été écrite deux fois — quelle qu'en soit la cause.
--
-- ── Pourquoi un invariant plutôt qu'une détection ciblée ────────────────────────
-- Le doublement redouté venait d'un désaccord d'identifiants entre les deux chemins
-- d'écriture du cash : le webhook et `sync-stripe-payments`. On aurait pu écrire une
-- requête qui cherche exactement ce cas-là. Elle aurait eu deux défauts : interroger
-- Stripe (le lien charge <-> facture n'existe plus dans l'API `2026-04-22.dahlia`,
-- mesuré le 2026-08-31), et ne rien voir des autres sources de doublement.
--
-- Cette vue attrape le doublement de N'IMPORTE QUELLE source, pour toujours : une
-- redélivrance de webhook, un futur backfill, un troisième chemin d'écriture, ou une
-- divergence que personne n'a vue. Zéro appel externe, sur nos propres données.
--
-- ── Deux précisions qui comptent ────────────────────────────────────────────────
-- 1. L'alarme est UNIQUEMENT sur `encaissé > amount_total`. Un encaissement partiel
--    est normal : 300 € sur une vente de 900 €, c'est un paiement en N fois en cours,
--    pas une anomalie. C'est `deals_sante_montants` et l'écran des relances qui
--    traitent le reste dû.
-- 2. Les remboursements sont EXCLUS de la somme, jamais soustraits. On cherche un
--    doublement d'ÉCRITURE, pas un solde de trésorerie : soustraire masquerait un
--    doublon dès qu'un remboursement passe par là.
--
-- ⚠️ Cette vue ne fait pas doublon avec `encaisseRetenu()` de lib/dealCash.ts — c'est
-- son complément exact. `encaisseRetenu` PLAFONNE le sur-encaissement à la lecture,
-- pour que les taux ne dépassent pas 100 % ; la vue montre ce que ce plafond masque
-- volontairement. Sans elle, un doublement resterait invisible sur tous les écrans.
--
-- Vide = aucun deal n'a encaissé plus que son montant.
create or replace view ventes_sante_sur_encaissement as
select
  d.profile_id,
  d.id                                        as deal_id,
  d.buyer_name,
  d.amount_total,
  sum(dp.amount)                              as encaisse,
  sum(dp.amount) - d.amount_total             as excedent,
  count(*)                                    as nb_paiements,
  string_agg(dp.stripe_payment_id, ' | ' order by dp.paid_at) as identifiants,
  'encaisse_plus_que_le_montant'::text        as anomalie
from deals d
join deal_payments dp on dp.deal_id = d.id and dp.status = 'succeeded'
where d.status <> 'canceled'
group by d.profile_id, d.id, d.buyer_name, d.amount_total
-- Un centime de tolérance : un montant divisé en 3 laisse un écart d'arrondi que la
-- comparaison stricte ferait passer pour un doublement. Même seuil que CENTIME dans
-- lib/dealCash.ts.
having sum(dp.amount) > d.amount_total + 0.01;
