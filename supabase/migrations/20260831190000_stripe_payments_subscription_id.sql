-- L'abonnement d'un encaissement orphelin — pour que le rattachement soit DURABLE
--
-- `orphan_cause = 'abonnement_inconnu'` dit qu'une facture d'abonnement est arrivée
-- sans qu'aucune vente ne porte cet abonnement. L'écran pouvait alors dire pourquoi,
-- mais pas quoi faire : à l'élève d'aller relier l'abonnement à la main dans Stripe.
--
-- Or l'identifiant est là, dans la variable dont l'échec produit justement cette
-- cause. En le stockant, le rattachement peut écrire `deals.stripe_subscription_id`
-- au passage — et TOUTES les échéances suivantes se rattachent seules.
--
-- ⚠️ C'est la différence entre corriger un symptôme et fermer la fuite : sans cette
-- colonne, un abonnement non relié ramène un nouvel orphelin chaque mois, et l'élève
-- refait le même geste à chaque échéance, indéfiniment.
--
-- ── MÊMES RÈGLES DE CYCLE DE VIE QUE `orphan_cause` ────────────────────────────
-- `null` quand le paiement EST rattaché : c'est une aide au rattachement d'un
-- orphelin, pas un historique. Une fois la vente trouvée, elle porte elle-même
-- `stripe_subscription_id` — garder l'information ici en ferait deux sources pour un
-- même fait, dont l'une se périmerait en silence.
--
-- Écrite uniquement quand un abonnement a été VU et n'a PAS permis de rattacher.
-- Quand il permet le rattachement, il n'y a pas d'orphelin ; quand il n'y en a pas,
-- il n'y a rien à proposer.
--
-- Backfill : impossible en SQL, l'information n'existe que chez Stripe. Même méthode
-- que `buyer_email` et `orphan_cause` — effacer le curseur une fois pour forcer une
-- relecture complète, vérifiée idempotente et sans effet sur le cash.

alter table stripe_payments add column if not exists subscription_id text;

comment on column stripe_payments.subscription_id is
  'L''abonnement Stripe vu sur cet encaissement, quand il n''a PAS permis de le '
  'rattacher a une vente. Sert a proposer, au moment du rattachement, d''ecrire '
  'deals.stripe_subscription_id — sans quoi chaque echeance suivante revient en '
  'orphelin. NULL des que le paiement est rattache : la vente porte alors elle-meme '
  'l''abonnement, et deux sources pour un meme fait se perimeraient.';
