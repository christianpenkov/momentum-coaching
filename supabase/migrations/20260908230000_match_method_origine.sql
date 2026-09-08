-- Une cinquième façon de rattacher un paiement à sa vente : par le paiement
-- qu'il rembourse.
--
-- Trouvé en production le 2026-09-08, en remboursant une échéance de
-- prélèvement automatique. Une charge issue d'un abonnement ne porte AUCUNE
-- metadata Momentum — Stripe ne les recopie pas de l'abonnement vers la charge —
-- et le gestionnaire de `charge.refunded` ne transmettait pas non plus
-- l'abonnement. Les deux chemins de résolution échouaient donc, et le
-- remboursement était enregistré comme orphelin : la vente continuait
-- d'afficher l'argent encaissé alors qu'il était reparti, sans le moindre
-- signal.
--
-- Le rattachement d'un remboursement ne peut pas dépendre de metadata : il
-- appartient par construction à la vente du paiement qu'il rembourse. La charge
-- porte `payment_intent` et `invoice`, et la ligne d'origine est enregistrée
-- sous l'un des deux. C'est cette résolution-là que `origine` nomme.
--
-- Nommée et non repliée sur `metadata` ou `subscription` : `match_method` sert
-- à savoir COMMENT un montant est arrivé sur une vente le jour où un chiffre
-- surprend. Une valeur approximative y vaut moins que pas de valeur du tout.

alter table public.deal_payments
  drop constraint if exists deal_payments_match_method_check;

alter table public.deal_payments
  add constraint deal_payments_match_method_check
  check (match_method = any (array['metadata', 'subscription', 'manual', 'legacy', 'origine']));
