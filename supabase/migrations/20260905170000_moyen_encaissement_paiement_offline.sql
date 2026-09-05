-- Un paiement `offline_…` prouve lui aussi le choix « hors Stripe »
--
-- TROISIEME elargissement du meme rattrapage, et c'est le fait notable : a chaque
-- fois j'ai cherche la preuve du cote de STRIPE, alors que ce mode-la n'en laisse
-- aucune. Les trois passes, dans l'ordre :
--
--   1. objet Stripe (abonnement, lien)        -> `prelevement` / `lien`
--   2. echeancier sans aucun lien             -> `offline`
--   3. paiement dont l'identifiant est offline -> `offline`   (celle-ci)
--
-- Chacune a ete ecrite en croyant la liste close. La lecon vaut au-dela de cette
-- colonne : quand une option se definit par l'ABSENCE d'un mecanisme, chercher sa
-- trace dans ce mecanisme ne peut rien rendre. Il faut lister ce que l'option
-- PRODUIT, et le code le dit — ici, trois points d'ecriture d'identifiants.
--
-- ── Ce qui prouve quoi ───────────────────────────────────────────────────────
--
-- `stripe_payment_id` prefixe `offline_` n'est ecrit que par les chemins hors
-- Stripe, verifie exhaustivement dans le code :
--
--   links/route.ts:431         `offline_<dealId>`                comptant deja recu
--   links/route.ts:491         `offline_<installmentId>`         1re echeance deja recue
--   installments/route.ts:83   `offline_<installmentId>_<ts>`    echeance declaree recue
--
-- ⚠️ `offline_refund_…` (declare-refund:88) est EXCLU : c'est de l'argent qui
-- SORT. Un remboursement declare a la main peut porter sur une vente encaissee
-- par lien Stripe — il ne dit rien du moyen d'encaissement. Le filtre sur
-- `status = 'succeeded'` l'ecarte deja (un remboursement est `refunded`), mais on
-- le nomme aussi dans le `like` : deux gardes valent mieux qu'une quand la
-- premiere depend d'une convention de statut qui pourrait changer.
update public.deals d
set moyen_encaissement = 'offline'
where d.moyen_encaissement is null
  and d.stripe_subscription_id is null
  and d.stripe_payment_link_id is null
  and exists (
    select 1 from public.deal_payments p
     where p.deal_id = d.id
       and p.status = 'succeeded'
       and p.stripe_payment_id like 'offline\_%'
       and p.stripe_payment_id not like 'offline\_refund\_%');
