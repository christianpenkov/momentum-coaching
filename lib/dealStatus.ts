import type { SupabaseClient } from '@supabase/supabase-js';
import { calculerCash, statutDeal } from '@/lib/dealCash';
import { desactiverLiensDuDeal } from '@/lib/stripe-payment-links';
import { sendPushToProfile } from '@/lib/googleCalendarService';

/**
 * Recalcul du statut d'un deal + ses effets de bord — LA source unique.
 *
 * Extrait de app/api/webhooks/stripe/route.ts le 2026-09-02, à l'identique, pour
 * une raison précise : l'Edge Function sync-stripe-payments portait une COPIE
 * Deno amputée de cette fonction — recalcul du statut seul, sans
 * `desactiverLiensDuDeal` ni le drapeau `unexpected_payment_at` ni la push.
 * Pour un compte en clé restreinte (pas de webhook, le cron est son seul
 * chemin), un remboursement intégral fait au dashboard Stripe annulait la vente
 * EN LAISSANT LE LIEN DE PAIEMENT ACTIF — le scénario exact que la désactivation
 * existe pour empêcher. Et la promesse de l'écran d'annulation (« tu seras
 * prévenu à son arrivée ») n'était pas tenue sur ce chemin.
 *
 * Le cron Deno appelle désormais /api/stripe/deal-effects (CRON_SECRET), qui
 * exécute CETTE fonction — une seule règle, deux chemins d'entrée, zéro copie.
 * C'est l'architecture qu'AGENTS.md recommande déjà pour cron-refresh-tokens et
 * cron-health : le code partagé reste côté Node, l'Edge Function le joint par
 * HTTP plutôt que d'en figer une copie.
 */

/**
 * Écrit une ligne dans le journal d'une vente.
 *
 * Ne lève jamais : le journal raconte ce qui s'est passé, il ne doit pas
 * empêcher que ça se passe. Une écriture ratée coûte une ligne d'historique,
 * pas un paiement.
 */
export async function journaliser(
  supabase: SupabaseClient,
  dealId: string,
  kind: string,
  label: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('deal_events').insert({ deal_id: dealId, kind, label, meta: meta ?? null });
  } catch (err) {
    console.error(`[stripe] journal impossible (deal ${dealId})`, err);
  }
}

/**
 * Recalcule le statut d'un deal à partir de ses paiements réellement encaissés.
 *
 * La règle vit dans lib/dealCash.ts — elle était recopiée ici, dans
 * app/api/payments/route.ts et dans l'Edge Function sync-stripe-payments, et
 * les trois ignoraient les remboursements.
 *
 * `statutDeal` renvoie `null` quand il ne faut RIEN changer : c'est le cas
 * d'un deal annulé, que ni un paiement retardataire ni un remboursement ne
 * doivent ressusciter.
 */
export async function refreshDealStatus(
  supabase: SupabaseClient,
  dealId: string,
  opts?: { argentEntrant?: boolean },
) {
  const { data: deal } = await supabase
    .from('deals')
    .select('profile_id, amount_total, status, unexpected_payment_at')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return;

  const { data: payments } = await supabase
    .from('deal_payments')
    .select('amount, status')
    .eq('deal_id', dealId);

  const status = statutDeal(calculerCash(payments), deal.amount_total, deal.status);

  if (status && status !== deal.status) {
    await supabase.from('deals').update({ status }).eq('id', dealId);

    // ── Une vente qui s'annule emporte ses liens ────────────────────────────
    // Ce chemin-ci n'est PAS le parcours guidé : c'est un remboursement intégral
    // fait directement dans le dashboard Stripe, sans passer par Momentum. Le
    // parcours désactive les liens lui-même ; ici personne ne l'aurait fait, et
    // un lien resterait payable sur une vente sortie des chiffres.
    if (status === 'canceled') {
      await desactiverLiensDuDeal(supabase, dealId, deal.profile_id);
      await journaliser(supabase, dealId, 'canceled',
        'Vente annulée — remboursement intégral constaté chez Stripe');
    }
  }

  // ── De l'argent sur une vente terminée ─────────────────────────────────────
  // Une vente clôturée, arrêtée ou annulée n'attend plus rien. Un paiement qui
  // arrive quand même a deux explications opposées — le client a repris ses
  // paiements, ou il s'est trompé — et Momentum ne peut pas trancher.
  //
  // Il pose donc un drapeau et pose la question, sans JAMAIS rouvrir la vente
  // tout seul : rouvrir à tort remettrait la vente dans les relances et
  // réclamerait au client un argent qu'il ne doit pas.
  //
  // Le drapeau seul est posé, le statut n'est pas touché : `statutDeal` renvoie
  // déjà `null` sur ces états, et l'argent reste compté dans l'encaissé — il est
  // bien sur le compte tant qu'il n'a pas été rendu.
  const terminee = deal.status === 'ended' || deal.status === 'canceled';
  if (opts?.argentEntrant && terminee && !deal.unexpected_payment_at) {
    await supabase.from('deals')
      .update({ unexpected_payment_at: new Date().toISOString() })
      .eq('id', dealId);
    await journaliser(supabase, dealId, 'unexpected_payment',
      'Paiement reçu sur une vente terminée');

    // L'écran d'annulation promet « tu seras prévenu à son arrivée » : sans
    // notification, l'argent dormirait sur une vente que personne ne rouvre.
    try {
      const { data: d } = await supabase
        .from('deals').select('buyer_name, profile_id').eq('id', dealId).maybeSingle();
      if (d) {
        await sendPushToProfile(
          d.profile_id,
          `${d.buyer_name} a payé après la fin de la vente`,
          'A-t-il repris ses paiements, ou s’est-il trompé ?',
          `/paiements?deal=${dealId}`,
        );
      }
    } catch { /* la notification est un confort, jamais une condition */ }
  }

  // ⚠️ ON NE TOUCHE PAS À L'APPEL ICI — ni `deal_closed`, ni `outcome`.
  //
  // Un remboursement dit qu'un mouvement d'argent a eu lieu, jamais pourquoi.
  // Erreur de saisie, geste commercial, rétractation du client : trois raisons
  // courantes, deux conclusions opposées sur « cette vente a-t-elle eu lieu ».
  // Momentum voit l'argent, pas l'intention — deviner se tromperait une fois sur
  // trois, et ferait bouger une carte du kanban que personne n'a demandé à
  // déplacer.
  //
  // Le geste qui déclasse une vente existe, et il est explicite : « Annuler la
  // vente », qui annonce à l'écran que l'appel passera en perdu. Deux faits
  // distincts, deux gestes distincts.
}
