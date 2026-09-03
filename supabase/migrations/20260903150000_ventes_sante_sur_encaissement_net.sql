-- Un deal ne peut pas avoir encaisse NET plus qu'il ne vaut
--
-- ⚠️ CORRECTION DU 2026-09-03 : la vue comparait du BRUT a un contrat qui peut baisser.
--
-- Elle excluait deliberement les remboursements, avec ce motif ecrit dans la migration
-- 20260831150000 : « on cherche un doublement d'ECRITURE, pas un solde de tresorerie ;
-- soustraire masquerait un doublon des qu'un remboursement passe par la ». Le
-- raisonnement tenait tant qu'`amount_total` ne bougeait pas.
--
-- Il ne tient plus. Le parcours de geste commercial livre le 2026-09-03 BAISSE le
-- montant de la vente du montant rendu : 1 000 EUR vendus, 200 EUR rendus, la vente
-- vaut 800 EUR. Le brut encaisse (1 000) depasse alors toujours le contracte (800), et
-- la vue criait a chaque remise. Une alerte qui se declenche sur un etat VOULU est une
-- alerte qu'on n'ouvre plus — et elle s'est declenchee une heure apres la livraison.
--
-- Signale par la session Paiements. Mesure : TestYT, une ligne `succeeded` 1 000 EUR et
-- une ligne `refunded` 200 EUR, contracte 800. Net = 800 = contracte. Aucun doublement,
-- une remise ordinaire.
--
-- ── Ce que la correction coute ───────────────────────────────────────────────────
--
-- La vue repond desormais a « le NET depasse-t-il le contracte » et non plus a « une
-- somme a-t-elle ete ecrite deux fois ». Un doublement reste attrape : il cree une
-- seconde ligne `succeeded`, donc 2 000 - 200 = 1 800 > 800.
--
-- ⚠️ TEMOIN POSITIF joue avant de valider, parce qu'une vue qui ne montre rien n'a rien
-- prouve : une ligne `succeeded` de 1 000 EUR ajoutee sur TestYT a bien declenche
-- l'alerte (brut 2 000, rembourse 200, net 1 800, excedent 1 000), puis supprimee.
--
-- Le seul cas qui echapperait est un remboursement egalant presque le doublon — or
-- rembourser l'un des deux exemplaires est justement la bonne remediation.
--
-- ⚠️ Remboursements et contestations sont des LIGNES SEPAREES, jamais un changement de
-- statut sur le paiement d'origine (verifie en base : `succeeded` 1 000 avec `paid_at`,
-- `refunded` 200 sans). La somme des `succeeded` ne les a donc jamais contenus, et les
-- soustraire ne retire rien deux fois.
--
-- ⚠️ Les CONTESTES sont deduits AUSSI. Le correctif propose par la session Paiements ne
-- deduisait que les remboursements ; la regle unique du cash est `lib/dealCash.ts` :
-- net = encaisse - rembourse - conteste. Une vue qui n'en deduirait que deux termes sur
-- trois rejouerait le meme faux positif au premier litige.
--
-- Complement de `encaisseRetenu()`, qui PLAFONNE le sur-encaissement a la lecture pour
-- que les taux ne depassent pas 100 % : la vue montre ce que ce plafond masque.
--
-- Vide = aucun deal n'a encaisse net plus que son montant.
--
-- `drop` puis `create` et non `create or replace` : les colonnes changent de nom, et
-- PostgreSQL refuse un renommage par remplacement.
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
  count(*) filter (where dp.status = 'succeeded') as nb_paiements,
  string_agg(dp.stripe_payment_id, ' | ' order by dp.paid_at)
    filter (where dp.status = 'succeeded')    as identifiants,
  'encaisse_net_plus_que_le_montant'::text    as anomalie
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
     > d.amount_total + 0.01;

comment on view public.ventes_sante_sur_encaissement is
  'Une ligne = un deal dont l''encaisse NET (succeeded - refunded - disputed, la regle '
  'de lib/dealCash.ts) depasse son montant contracte. Vide = aucun sur-encaissement. '
  '⚠️ Comparait du BRUT jusqu''au 2026-09-03, ce qui declenchait une alerte a chaque '
  'geste commercial : le parcours de remise BAISSE amount_total du montant rendu, donc '
  'le brut depassait toujours le contracte.';

-- ⚠️ CE COMMENTAIRE ETAIT FAUX — corrige le 2026-09-03, quelques heures apres.
--
-- Il disait « `service_role` SEULEMENT », et le `grant` ci-dessous ne mentionne bien que
-- lui. Mais un `grant` explicite ne dit RIEN de ce que la vue autorise deja : Supabase
-- pose des privileges par defaut sur le schema `public` (`select * from pg_default_acl`),
-- et le `drop view` + `create view` ci-dessus a donc rendu cette vue lisible par `anon`
-- et `authenticated` — sans session pour `anon`, dont la cle est publique et vit dans le
-- bundle JS de chaque eleve. `security_invoker` valant false par defaut, la RLS etait en
-- prime contournee : les ventes, montants et identifiants Stripe de TOUS les coachs.
--
-- **Ne jamais lire un `grant` comme une restriction.** Un `grant` ajoute ; il n'enleve
-- rien. La seule facon de savoir ce qu'une relation autorise est de le DEMANDER a la
-- base (`has_table_privilege('anon', …)`), jamais de le deduire des lignes ecrites.
--
-- Ferme, et surtout rendu detectable pour la prochaine fois, par
-- 20260903170000_verrou_structurel_lecture_public.sql — qui teste l'invariant « lisible
-- du navigateur ⇒ la RLS s'applique » plutot que de rejouer un `revoke` de plus.
grant select on public.ventes_sante_sur_encaissement to service_role;
revoke select on public.ventes_sante_sur_encaissement from anon, authenticated;
alter view public.ventes_sante_sur_encaissement set (security_invoker = true);
