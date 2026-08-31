-- POURQUOI un encaissement n'est rattaché à aucune vente
--
-- `stripe_payments` disait qu'un paiement était orphelin, jamais pourquoi. Depuis
-- cette table, « aucune metadata » et « le deal a été supprimé » sont strictement
-- indistinguables — et ce sont deux situations qui n'appellent pas la même action :
-- la première demande de retrouver la vente à la main, la seconde dit que la vente
-- n'existe plus et qu'il faut décider quoi faire de l'argent.
--
-- L'écran de rattachement ne pouvait que DEVINER. Deviner une cause est pire qu'un
-- en-tête générique : ça oriente vers la mauvaise action avec l'assurance d'un fait.
--
-- Les deux chemins d'écriture, eux, connaissent la cause — ils la calculent déjà pour
-- décider quoi faire, et la jetaient à la sortie de la fonction.
--
-- ── CONTRAINTE, et pas seulement une convention ─────────────────────────────────
-- Sans le CHECK, une faute de frappe crée une quatrième cause en silence, et l'écran
-- affiche « autre » sans que personne ne comprenne pourquoi.
--
-- ── DEUX RÈGLES DE CYCLE DE VIE, qui comptent autant que l'écriture ─────────────
-- 1. `null` quand le paiement EST rattaché. Cette colonne décrit un orphelinat en
--    cours, pas un historique.
-- 2. Remise à `null` dès que le paiement cesse d'être orphelin — passage suivant qui
--    trouve enfin le deal, ou rattachement manuel depuis la page Paiements. Sinon
--    elle devient une cause périmée affichée comme un fait actuel : le défaut de
--    `ig_followers`, une colonne qui garde la dernière valeur connue au lieu de
--    l'état réel.
--
-- ── BACKFILL ────────────────────────────────────────────────────────────────────
-- La règle du projet est « nouvelle colonne + backfill dans la même migration ».
-- Impossible en SQL ici : la cause n'existe que chez Stripe. La méthode est celle
-- déjà employée pour `buyer_email` — effacer le curseur une fois pour forcer une
-- relecture complète, vérifiée idempotente et sans effet sur le cash :
--
--   update integrations set metadata = metadata - 'stripe_synced_at'
--   where provider = 'stripe';
--
-- Les orphelins situés hors de la fenêtre Stripe resteront à `null`, et c'est
-- honnête : `null` dit « on ne sait pas », pas « aucune cause ».

alter table stripe_payments add column if not exists orphan_cause text;

alter table stripe_payments drop constraint if exists stripe_payments_orphan_cause_check;
alter table stripe_payments add constraint stripe_payments_orphan_cause_check
  check (orphan_cause is null or orphan_cause in (
    'metadata_absente',    -- l'objet Stripe ne porte aucun momentum_deal_id
    'deal_supprime',       -- il en porte un, mais la vente n'existe plus
    'abonnement_inconnu'   -- pas de metadata, et aucun deal ne porte cet abonnement
  ));

comment on column stripe_payments.orphan_cause is
  'Pourquoi ce paiement n''est rattache a aucune vente. NULL quand il EST rattache — '
  'c''est un etat courant, pas un historique : remis a NULL des que le paiement cesse '
  'd''etre orphelin, sinon la cause devient perimee et s''affiche comme un fait.';
