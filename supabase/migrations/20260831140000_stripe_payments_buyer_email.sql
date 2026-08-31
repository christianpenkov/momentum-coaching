-- L'e-mail du payeur, en COLONNE — pas deviné depuis un texte libre
--
-- `stripe_payments` ne stockait pas l'e-mail. L'écran de rattachement le récupérait
-- en l'extrayant de `description` par expression régulière (extractEmail, dans
-- app/api/payments/orphans/route.ts).
--
-- ── Pourquoi c'était cassé ──────────────────────────────────────────────────────
-- Le niveau de confiance « Certain » exige un e-mail exact : c'est le seul signal qui
-- identifie une personne. Sans e-mail, aucun candidat ne peut dépasser « Possible » —
-- et sur une échéance (300 € sur une vente de 900 €), le montant ne correspond pas non
-- plus. L'écran affiche alors « Aucun deal ne correspond », avec « Ignorer » pour seul
-- bouton : le filet ramène l'argent, et l'écran invite à l'écarter.
--
-- Mesuré le 2026-08-31 : 10 lignes sur 10 sans description, donc sans e-mail
-- exploitable. Le défaut existait avant, mais il était dormant — c'est le filet
-- (sync-stripe-payments étendu aux comptes OAuth) qui a ramené les orphelins et
-- rendu l'écran de rattachement réellement utilisé.
--
-- ── Pourquoi une colonne et pas `description` ──────────────────────────────────
-- Remplir `description` aurait été une ligne. Mais `extractEmail` devrait alors
-- continuer d'extraire une adresse d'un texte libre — une heuristique qui casse en
-- silence au premier changement de libellé côté Stripe. Or Stripe expose l'adresse
-- directement : `charge.billing_details.email` et `invoice.customer_email`, tous deux
-- renseignés sur 100 % des objets du compte de test.
--
-- On ne devine pas ce qu'on peut stocker.

alter table stripe_payments add column if not exists buyer_email text;

comment on column stripe_payments.buyer_email is
  'E-mail du payeur, lu sur charge.billing_details.email ou invoice.customer_email. '
  'Sert au rattachement d''un paiement orphelin a sa vente : c''est le seul signal qui '
  'identifie une personne, et le niveau « Certain » l''exige.';

-- Les lignes deja ecrites restent a NULL : aucun backfill SQL possible, l'adresse
-- n'existe que chez Stripe. `sync-stripe-payments` les remplira a son prochain
-- passage — l'upsert sur (profile_id, payment_id) met a jour les lignes existantes.
-- Pour forcer la relecture immediate d'une fenetre deja parcourue :
--   update integrations set metadata = metadata - 'stripe_synced_at'
--   where provider = 'stripe';
