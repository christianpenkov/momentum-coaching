-- ═══════════════════════════════════════════════════════════════════════════
-- Une vente dont l'abonnement prélèvera encore n'est pas terminée
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Suite immédiate de `20260909120000_annulation_demandee`, trouvée au PREMIER
-- passage réel de ce code : rembourser l'échéance 1/3 d'un plan en prélèvement
-- automatique déclarait la vente terminée, alors que Stripe prélèverait encore
-- les échéances 2 et 3.
--
-- Conséquence : `ended` ne se recalcule plus jamais (lib/dealCash.ts), donc le
-- prélèvement du mois suivant serait arrivé sur une vente figée et se serait
-- signalé comme « paiement reçu sur une vente terminée » — une alerte pour un
-- événement parfaitement normal.
--
-- ── Pourquoi la protection d'origine ne s'applique pas ici ─────────────────
-- La règle « tout remboursé → état terminal » existe pour ne pas relancer un
-- client qu'on vient de rembourser. En prélèvement automatique, Momentum ne
-- relance JAMAIS : `installment-reminders` écarte explicitement
-- `installments_auto`, et l'échéancier vit chez Stripe. Il n'y a personne à
-- relancer, donc rien à protéger — et le coût, lui, était réel.
--
-- La vente se terminera d'elle-même quand l'abonnement s'arrêtera :
-- `customer.subscription.deleted` la passe en `ended` (app/api/webhooks/stripe).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill — « cause fermée ≠ trace réparée »
-- ═══════════════════════════════════════════════════════════════════════════
--
-- On rend leur vrai état aux ventes que l'ancienne règle a terminées à tort :
-- celles dont l'abonnement n'a pas encore prélevé toutes ses échéances.
--
-- ⚠️ Le compte porte sur les encaissements RÉUSSIS, pas sur l'argent restant :
-- une échéance remboursée a bien été prélevée, et Stripe ne la reprélèvera pas.
-- C'est exactement la règle de `prelevementsAVenir` dans lib/dealCash.ts — même
-- prédicat des deux côtés, sinon la migration et le code diraient deux choses.
--
-- ⚠️ Une vente terminée par un GESTE humain (`ended_by = 'user'`) n'est pas
-- touchée : elle a été clôturée exprès, et le bouton refuse déjà de le faire
-- quand des prélèvements tournent.

with a_rouvrir as (
  select d.id
  from public.deals d
  where d.status = 'ended'
    and d.ended_by = 'stripe'
    and d.payment_plan = 'installments_auto'
    and d.stripe_subscription_id is not null
    and coalesce(d.installments_count, 0) > 0
    and (
      select count(*) from public.deal_payments p
      where p.deal_id = d.id and p.status = 'succeeded'
    ) < d.installments_count
)
update public.deals d
set status       = 'open',
    ended_by     = null,
    ended_at     = null,
    ended_reason = null
from a_rouvrir r
where d.id = r.id;

-- La trace, sans auteur : c'est une migration, personne n'a fait ce geste.
insert into public.deal_events (deal_id, kind, label, meta)
select d.id,
       'reopened',
       'Vente rendue en cours — son abonnement prélèvera encore',
       jsonb_build_object(
         'motif_rattrapage', 'migration 20260909140000_prelevements_a_venir_ne_terminent_pas',
         'statut_avant', 'ended',
         'echeances_prelevees', (
           select count(*) from public.deal_payments p
           where p.deal_id = d.id and p.status = 'succeeded'
         ),
         'echeances_prevues', d.installments_count
       )
from public.deals d
where d.status = 'open'
  and d.payment_plan = 'installments_auto'
  and d.stripe_subscription_id is not null
  and exists (
    select 1 from public.deal_payments p
    where p.deal_id = d.id and p.status = 'refunded'
  )
  -- Rejouable sans doubler la trace.
  and not exists (
    select 1 from public.deal_events e
    where e.deal_id = d.id
      and e.meta ->> 'motif_rattrapage' = 'migration 20260909140000_prelevements_a_venir_ne_terminent_pas'
  );
