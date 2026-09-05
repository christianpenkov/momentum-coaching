-- Le sur-encaissement n'alerte que s'il TRAINE : filet de securite, pas doublon de l'ecran
--
-- ⚠️ DEUXIEME CORRECTION DE CETTE VUE. La premiere (20260903150000) a remplace le brut
-- par le net, parce qu'elle criait a chaque geste commercial. Celle-ci ferme le meme
-- defaut sous sa forme suivante : elle crie encore sur des etats VOULUS.
--
-- ── Ce qui a change dans le produit depuis ────────────────────────────────────────
--
-- Le motif ecrit dans la migration precedente etait : « un trop-percu fait depasser
-- 100 % de collecte, et dans les totaux il vient effacer la dette d'un autre client ».
-- Les deux dangers sont desormais fermes DANS LE CODE, verifie site par site :
--
--   app/api/payments/route.ts:398   totaux generaux    -> collectedRetenu (plafonne)
--   app/api/payments/route.ts:351   totaux par personne -> collectedRetenu
--   components/payments/FicheClient.tsx:86  fiche client -> collectedRetenu
--   components/payments/FicheClient.tsx:342 pourcentage  -> borne a 100 %
--
-- Et depuis le 2026-09-05, la fiche affiche « X EUR verses en trop » AVEC un bouton
-- « Rembourser le trop-percu ». L'etat n'est donc plus ni invisible ni dangereux : il
-- est nomme a l'ecran et il a son geste.
--
-- ── Pourquoi ne pas simplement supprimer la vue ───────────────────────────────────
--
-- Parce qu'un paiement rattache au MAUVAIS deal produit exactement la meme signature,
-- et ca, c'est une vraie corruption. La vue ne sait pas distinguer les deux causes —
-- et aucune regle simple ne le peut, un paiement double par le client et un paiement
-- mal rattache sont indiscernables en base.
--
-- On change donc la QUESTION plutot que la detection. Au lieu de « y a-t-il un
-- sur-encaissement ? » — a quoi l'ecran repond deja, immediatement — elle demande
-- « un sur-encaissement est-il reste sans suite ? ». C'est une CONSEQUENCE de la regle,
-- pas une reimplementation de la regle : personne n'a clique le bouton en trois jours.
--
-- 72 h : assez pour couvrir un week-end de deux jours sans reveiller personne, assez
-- court pour qu'un paiement mal rattache ne dorme pas une semaine.
--
-- ── La date d'ou part le delai ────────────────────────────────────────────────────
--
-- Un sur-encaissement nait de DEUX gestes possibles, et le delai doit partir du plus
-- recent des deux :
--   · un paiement de trop            -> `paid_at` du dernier `succeeded`
--   · une baisse du montant contracte -> `at` du dernier `amount_changed` au journal
--
-- Ne prendre que `paid_at` daterait de l'encaissement d'origine une remise accordee
-- des mois plus tard, et l'alerte partirait immediatement — soit le defaut qu'on ferme.
--
-- ⚠️ TEMOIN POSITIF joue avant de valider, parce qu'une vue qui ne montre rien n'a rien
-- prouve : la meme requete avec un delai de 0 h fait bien apparaitre TestStory
-- (500 EUR nets sur 300 EUR contractes, excedent 200), et a 72 h elle disparait — son
-- `amount_changed` datant de moins de trois jours. Les deux branches sont donc vivantes.
--
-- ⚠️ `drop` puis `create` : une colonne s'ajoute, et un `create or replace` refuse tout
-- changement de la liste des colonnes.
drop view if exists public.ventes_sante_sur_encaissement;

create view public.ventes_sante_sur_encaissement as
select
  d.profile_id,
  d.id                                        as deal_id,
  d.buyer_name,
  d.amount_total,
  coalesce(sum(dp.amount) filter (where dp.status = 'succeeded'), 0) as encaisse_brut,
  coalesce(sum(dp.amount) filter (where dp.status = 'refunded'), 0)  as rembourse,
  coalesce(sum(dp.amount) filter (where dp.status = 'disputed'), 0)  as conteste,
  coalesce(sum(dp.amount) filter (where dp.status = 'succeeded'), 0)
    - coalesce(sum(dp.amount) filter (where dp.status = 'refunded'), 0)
    - coalesce(sum(dp.amount) filter (where dp.status = 'disputed'), 0) as encaisse_net,
  coalesce(sum(dp.amount) filter (where dp.status = 'succeeded'), 0)
    - coalesce(sum(dp.amount) filter (where dp.status = 'refunded'), 0)
    - coalesce(sum(dp.amount) filter (where dp.status = 'disputed'), 0)
    - d.amount_total                          as excedent,
  -- Depuis quand l'argent est en trop. Affiche, et pas seulement utilise dans le filtre :
  -- l'e-mail d'alerte doit pouvoir dire « depuis le 2 septembre », qui est la seule
  -- information qui rende le probleme actionnable.
  greatest(
    coalesce(max(coalesce(dp.paid_at, dp.created_at))
             filter (where dp.status = 'succeeded'), to_timestamp(0)),
    coalesce((select max(e.at) from public.deal_events e
               where e.deal_id = d.id and e.kind = 'amount_changed'), to_timestamp(0))
  )                                           as excedent_depuis,
  count(*) filter (where dp.status = 'succeeded') as nb_paiements,
  string_agg(dp.stripe_payment_id, ' | ' order by dp.paid_at)
    filter (where dp.status = 'succeeded')    as identifiants,
  'sur_encaissement_sans_suite'::text         as anomalie
from public.deals d
join public.deal_payments dp on dp.deal_id = d.id
where d.status <> 'canceled'
group by d.profile_id, d.id, d.buyer_name, d.amount_total
-- Un centime de tolerance : un montant divise en 3 laisse un ecart d'arrondi que la
-- comparaison stricte ferait passer pour un doublement. Meme seuil que CENTIME dans
-- lib/dealCash.ts.
having coalesce(sum(dp.amount) filter (where dp.status = 'succeeded'), 0)
     - coalesce(sum(dp.amount) filter (where dp.status = 'refunded'), 0)
     - coalesce(sum(dp.amount) filter (where dp.status = 'disputed'), 0)
     > d.amount_total + 0.01
   and greatest(
         coalesce(max(coalesce(dp.paid_at, dp.created_at))
                  filter (where dp.status = 'succeeded'), to_timestamp(0)),
         coalesce((select max(e.at) from public.deal_events e
                    where e.deal_id = d.id and e.kind = 'amount_changed'), to_timestamp(0))
       ) < now() - interval '72 hours';

comment on view public.ventes_sante_sur_encaissement is
  'Une ligne = un deal dont l''encaisse NET (succeeded - refunded - disputed, la regle '
  'de lib/dealCash.ts) depasse son montant contracte DEPUIS PLUS DE 72 H. Vide = aucun '
  'sur-encaissement laisse sans suite. '
  '⚠️ Comparait du BRUT jusqu''au 2026-09-03, et alertait SANS DELAI jusqu''au '
  '2026-09-05 : la fiche client affiche desormais le trop-percu avec un bouton pour le '
  'rendre, donc alerter tout de suite doublait l''ecran au lieu de le completer. Le '
  'delai transforme la vue en filet : elle ne dit plus qu''il existe, elle dit que '
  'personne ne l''a traite. La colonne excedent_depuis porte la date de depart.';

-- ⚠️ OBLIGATOIRE APRES CHAQUE `drop view` — le piege documente en 20260903150000.
-- Supabase pose des privileges PAR DEFAUT sur le schema `public` (`pg_default_acl`) :
-- recreer la vue la rend a nouveau lisible par `anon` et `authenticated`, donc depuis le
-- bundle JS de chaque eleve, RLS contournee puisque `security_invoker` vaut false par
-- defaut. Les trois lignes ne sont pas de la ceinture-bretelles : sans elles, cette
-- migration REOUVRE la faille que la precedente a fermee.
grant select on public.ventes_sante_sur_encaissement to service_role;
revoke select on public.ventes_sante_sur_encaissement from anon, authenticated;
alter view public.ventes_sante_sur_encaissement set (security_invoker = true);
