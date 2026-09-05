-- Un paiement rattache par `metadata` PROUVE que l'encaissement est passe par Stripe
--
-- Releve par Chris a l'ecran : TestYT affichait « comptant · hors Stripe » alors
-- qu'il a ete paye par carte, sur un lien Momentum (`pi_3U6Z6g…`).
--
-- ── D'ou venait l'erreur ─────────────────────────────────────────────────────
--
-- Du rattrapage 20260905160000, qui posait : « des echeances dont AUCUNE ne porte
-- de lien ⇒ hors Stripe ». La regle etait juste en elle-meme, mais elle
-- raisonnait sur une ABSENCE sans regarder ce qui etait PRESENT a cote — un vrai
-- paiement Stripe sur la meme vente.
--
-- Le cas de TestYT : paye 1 000 EUR par lien, puis 300 EUR rembourses, et une
-- echeance de 200 EUR creee pour suivre ce qu'il reste a re-encaisser. Cette
-- echeance-la n'a pas de lien — mais la vente, elle, a bien encaisse par Stripe.
--
-- C'est la troisieme fois de la journee que je cherche la reponse du cote de
-- l'absence. La lecon, ecrite ici parce qu'elle depasse cette colonne : quand une
-- preuve POSITIVE existe, elle prime toujours sur une deduction tiree d'un
-- manque. Ne raisonner par l'absence que lorsqu'il n'y a rien d'autre.
--
-- ── La preuve positive ──────────────────────────────────────────────────────
--
-- `deal_payments.match_method = 'metadata'` signifie que STRIPE LUI-MEME a
-- indique a quelle vente le paiement appartenait — ce que seule une metadonnee
-- posee par Momentum a la creation d'un lien ou d'un abonnement permet. Un
-- virement declare a la main porte `manual`, un rattachement humain aussi.
--
-- Donc : un paiement `metadata` ⇒ l'argent est entre par un objet Stripe de
-- Momentum ⇒ le moyen n'est pas « hors Stripe ».
--
-- On repose `lien` et non `prelevement` : les ventes a abonnement portent deja
-- `prelevement` depuis le premier rattrapage, et la condition les exclut.
update public.deals d
set moyen_encaissement = 'lien'
where d.moyen_encaissement = 'offline'
  and d.stripe_subscription_id is null
  and exists (select 1 from public.deal_payments p
               where p.deal_id = d.id and p.match_method = 'metadata');
