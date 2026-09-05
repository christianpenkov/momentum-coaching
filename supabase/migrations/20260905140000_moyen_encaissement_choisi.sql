-- « Hors Stripe » etait un choix qui ne laissait aucune trace
--
-- ── Le defaut ─────────────────────────────────────────────────────────────────
--
-- `terms/route.ts` accepte quatre plans, dont `offline`, et n'en enregistre que
-- trois : ligne 261, `offline` etait replie sur `one_shot` ou
-- `installments_manual` selon le nombre d'echeances. Apres un choix EXPLICITE
-- « hors Stripe », la base devenait donc indiscernable d'une vente ou personne
-- n'avait rien decide — d'autant que `payment_plan` vaut `'one_shot'` PAR DEFAUT.
--
-- Consequence a l'ecran : `moyenDefini()` repondait « non defini » pour les deux
-- cas, et la fiche affichait « Choisir les modalites de paiement » indefiniment
-- sur une vente dont les modalites AVAIENT ete choisies. Un bouton qui reclame
-- une decision deja prise.
--
-- ⚠️ Le code nommait deja la cause, dans `etats.ts` : « `payment_plan` melange
-- les deux axes : "comptant" y repond a COMBIEN DE FOIS, les autres a PAR QUEL
-- MOYEN. Les separer est ce qui rend le virement unique representable. » La
-- separation etait faite dans les types et les fonctions de lecture, jamais en
-- base : il manquait la colonne.
--
-- ── Ce que la colonne dit, et ce qu'elle ne dit pas ───────────────────────────
--
-- Elle enregistre CE QUE L'ELEVE A CHOISI, pas ce que la plateforme deduit.
-- NULL n'est donc pas « aucun moyen » mais « personne n'a encore decide » — la
-- distinction que tout ce chantier existe pour rendre possible. Un ecran qui lit
-- NULL doit dire « a choisir », jamais « aucun ».
--
-- `payment_plan` n'est pas touche : il garde son axe (combien de fois), et les
-- deux se lisent ensemble. Le modifier aurait casse les lectures existantes pour
-- un gain nul.
alter table public.deals
  add column if not exists moyen_encaissement text
    check (moyen_encaissement in ('lien', 'auto', 'offline'));

comment on column public.deals.moyen_encaissement is
  'PAR QUEL MOYEN cette vente s''encaisse, tel que l''eleve l''a CHOISI : lien de '
  'paiement, prelevement automatique, ou hors Stripe. NULL = jamais choisi, et non '
  '« aucun moyen » — un ecran qui lit NULL doit proposer de choisir. Complement de '
  '`payment_plan`, qui repond a COMBIEN DE FOIS. Les deux axes etaient melanges '
  'dans `payment_plan` jusqu''au 2026-09-05, ce qui rendait « hors Stripe » '
  'indiscernable de « rien decide ».';

-- ── Rattrapage des lignes deja ecrites ───────────────────────────────────────
--
-- Meme migration que la colonne : une colonne ajoutee sans son backfill laisse un
-- NULL qui MENT — il dirait « jamais choisi » sur des ventes dont le moyen est
-- evident.
--
-- ⚠️ On ne remplit QUE ce qui est prouve par un objet Stripe existant. Une vente
-- sans lien ni abonnement reste a NULL, meme si de l'argent y a ete declare :
-- rien ne dit que quelqu'un a CHOISI « hors Stripe » plutot que de n'avoir jamais
-- ouvert l'ecran. Inventer ce choix ici recreerait exactement le defaut qu'on
-- ferme — une absence lue comme une decision.
update public.deals d
set moyen_encaissement = 'auto'
where d.moyen_encaissement is null
  and d.stripe_subscription_id is not null;

update public.deals d
set moyen_encaissement = 'lien'
where d.moyen_encaissement is null
  and (d.stripe_payment_link_id is not null
       or exists (select 1 from public.deal_installments i
                   where i.deal_id = d.id and i.stripe_payment_link_id is not null));
