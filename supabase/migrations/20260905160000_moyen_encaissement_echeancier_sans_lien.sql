-- Un echeancier sans aucun lien EST la signature d'un choix « hors Stripe »
--
-- Question de Chris, deux heures apres la migration precedente : « si TestYT n'a
-- pas de moyen de paiement, comment il peut avoir une echeance ? ».
--
-- Il ne peut pas. Un echeancier n'apparait jamais seul : il est cree par l'ecran
-- des modalites (`links/route.ts` ou `terms/route.ts`), c'est-a-dire par un choix
-- explicite. TestYT AVAIT donc choisi son moyen — c'est mon rattrapage qui ne
-- savait pas le voir.
--
-- ── L'erreur du rattrapage precedent, et elle est instructive ─────────────────
--
-- Il ne remplissait que ce qu'un OBJET STRIPE prouvait — abonnement ou lien — en
-- se justifiant ainsi : « rien ne dit que quelqu'un a CHOISI hors Stripe plutot
-- que de n'avoir jamais ouvert l'ecran ».
--
-- C'etait exactement le defaut que cette colonne existe pour fermer, applique une
-- fois de plus : lire une ABSENCE comme une absence de decision. Pour le mode
-- hors Stripe, l'absence d'objet Stripe n'est pas un silence — c'est sa SIGNATURE.
-- Exiger une preuve Stripe d'un choix qui, par definition, n'en cree aucune,
-- revenait a le rendre indemontrable.
--
-- ── La preuve, elle, est nette ───────────────────────────────────────────────
--
-- Des echeances dont AUCUNE ne porte de lien. Le mode « un lien par echeance »
-- cree aussi des echeances, mais chacune porte le sien — verifie en base : les
-- trois de Test Description en ont un, celles de TestYT et Chris Penkov n'en ont
-- aucun. Le `not exists` couvre donc les deux cotes de la partition.
--
-- Les ventes SANS echeance et sans lien restent a NULL : la, rien n'a jamais ete
-- configure, et le NULL dit vrai.
update public.deals d
set moyen_encaissement = 'offline'
where d.moyen_encaissement is null
  and d.stripe_subscription_id is null
  and d.stripe_payment_link_id is null
  and exists (select 1 from public.deal_installments i where i.deal_id = d.id)
  and not exists (select 1 from public.deal_installments i
                   where i.deal_id = d.id
                     and (i.stripe_payment_link_id is not null or i.short_url is not null));
