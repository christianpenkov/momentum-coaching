import type { SupabaseClient } from '@supabase/supabase-js';
import { calculerCash, statutDeal, prelevementsAVenir } from '@/lib/dealCash';
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
  /**
   * Qui a fait le geste, quand c'est un humain.
   *
   * Absent pour tout ce que Stripe nous apprend — un litige n'a pas d'auteur
   * chez nous. Renseigné dès qu'une PERSONNE décide : rattacher un paiement à
   * une vente, déclarer un virement. Ces gestes-là engagent quelqu'un, et le
   * nom est figé au moment du geste parce qu'un profil peut être renommé.
   */
  auteur?: { id: string; nom: string | null },
): Promise<void> {
  try {
    await supabase.from('deal_events').insert({
      deal_id: dealId, kind, label, meta: meta ?? null,
      ...(auteur ? { actor_id: auteur.id, actor_name: auteur.nom } : {}),
    });
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
  opts?: { argentEntrant?: boolean; remboursementConstate?: boolean },
) {
  const { data: deal } = await supabase
    .from('deals')
    // ⚠️ `cancel_requested_at` et `call_id` ne sont pas décoratifs : le premier
    // décide entre « annulée » et « clôturée », le second porte le déclassement
    // de l'appel. Les oublier ne casse rien visiblement — ça transforme
    // silencieusement une annulation voulue en clôture.
    .select('profile_id, amount_total, status, unexpected_payment_at, refund_explique, cancel_requested_at, call_id, payment_plan, stripe_subscription_id, installments_count')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return;

  const { data: payments } = await supabase
    .from('deal_payments')
    .select('amount, status')
    .eq('deal_id', dealId);

  const cash = calculerCash(payments);
  const status = statutDeal(cash, deal.amount_total, deal.status, {
    annulationDemandee: !!deal.cancel_requested_at,
    prelevementsAVenir: prelevementsAVenir(
      cash, deal.payment_plan, deal.stripe_subscription_id, deal.installments_count,
    ),
  });

  // ── Un remboursement de TROP-PERÇU n'appelle aucune explication ──────────
  //
  // Et il faut trancher MAINTENANT, pas plus tard : la question « ce
  // remboursement creuse-t-il la vente ? » se juge contre le montant contracté
  // AU MOMENT du remboursement. Le relire ensuite avec le montant du jour donne
  // une réponse fausse dès que le prix a bougé entre-temps.
  //
  // Constaté par Chris sur RZK le 2026-09-07 : 500 € versés sur une vente de
  // 300 €, 200 € rendus — un pur trop-perçu, rien à expliquer. Deux jours plus
  // tard la vente est portée à 400 €, et l'écran réclame soudain d'expliquer
  // 100 € « repartis ». La preuve que c'était faux tenait sur la même fiche :
  // les mêmes 100 € y figuraient AUSSI en « encore à encaisser, envoie ce
  // lien ». Le même euro ne peut pas être à la fois jamais versé et parti sans
  // raison.
  //
  // On inscrit donc, à l'instant où l'information existe, la part du
  // remboursement que le trop-perçu explique. `Math.max` avec l'existant : ce
  // champ cumule aussi les explications données à la main (RaisonRemboursement)
  // et par l'annulation — on ne redescend jamais ce qu'un humain a déclaré.
  //
  // Idempotent, donc sans danger à rejouer : le filet quotidien
  // (`sync-stripe-payments`) passe par la même porte.
  if (opts?.remboursementConstate && cash.rembourse > 0.005) {
    const coussin = Math.max(0, cash.encaisse - Number(deal.amount_total ?? 0));
    const explique = Math.round(Math.min(cash.rembourse, coussin) * 100) / 100;
    if (explique > Number(deal.refund_explique ?? 0) + 0.005) {
      await supabase.from('deals')
        .update({ refund_explique: explique })
        .eq('id', dealId);
    }
  }

  if (status && status !== deal.status) {
    // ── Une clôture RENSEIGNE toujours comment elle est arrivée ──────────────
    //
    // `end/route.ts` pose `ended_by` / `ended_at` / `ended_reason` en même temps
    // que le statut, et l'écran les lit : `etats.ts` choisit « Clôturée » ou
    // « Arrêtée » sur `ended_by`, et la fiche affiche la raison. Ce chemin-ci
    // n'écrivait que le statut — donc une vente terminée sans date ni motif,
    // c'est-à-dire un état que rien ne raconte.
    //
    // Constaté le 2026-09-09, sur le premier passage réel du nouveau code :
    // Incogniton portait `status = 'ended'` avec les trois colonnes à NULL,
    // pendant que le backfill de la migration du matin, lui, les avait bien
    // remplies. La migration et le code écrivaient deux états différents pour le
    // même fait — la partition, encore, entre le rattrapage et le chemin vivant.
    await supabase.from('deals').update({
      status,
      ...(status === 'ended' ? {
        ended_by: 'stripe',
        ended_at: new Date().toISOString(),
        ended_reason: 'Remboursement intégral constaté chez Stripe',
      } : {}),
    }).eq('id', dealId);

    // ── Une vente qui se termine emporte ses liens ──────────────────────────
    // Ce chemin-ci n'est PAS le parcours guidé : c'est un remboursement intégral
    // fait directement dans le dashboard Stripe, sans passer par Momentum. Le
    // parcours désactive les liens lui-même ; ici personne ne l'aurait fait, et
    // un lien resterait payable sur une vente sortie des chiffres.
    //
    // ⚠️ `ended` AUTANT que `canceled` depuis le 2026-09-09. C'est le motif
    // d'origine de la règle — « ne pas relancer un client qu'on vient de
    // rembourser » — et il ne tient pas qu'aux notifications : il tient d'abord
    // à ce lien-là. Le nouvel état ne doit surtout pas le perdre en route.
    if (status === 'canceled' || status === 'ended') {
      await desactiverLiensDuDeal(supabase, dealId, deal.profile_id);
      await journaliser(supabase, dealId, status,
        status === 'canceled'
          ? 'Vente annulée — remboursement intégral constaté chez Stripe'
          : 'Vente clôturée — remboursement intégral constaté chez Stripe');
    }

    // ── L'appel ne cesse de compter que sur une annulation VOULUE ───────────
    //
    // Le parcours guidé promet, à l'écran : « L'appel passera en perdu, sans
    // objection dans tes statistiques, et sortira de ton taux de closing »
    // (components/payments/FinDeVie.tsx). Quand rien n'était encaissé,
    // cancel/route.ts tenait cette promesse lui-même. Quand de l'argent était
    // là, l'annulation ne se conclut qu'ICI, plusieurs minutes plus tard — et
    // personne ne déclassait l'appel. La promesse n'était donc tenue que sur la
    // moitié des ventes, celle où il n'y avait pas d'argent à rendre.
    //
    // Mesuré le 2026-09-09 : les deux ventes annulées du compte de test portaient
    // encore `deal_closed = true`, donc comptaient dans le taux de closing pendant
    // que le cash contracté les excluait. Deux populations sur la même ligne de KPI.
    //
    // ⚠️ Et SEULEMENT sur `canceled`. Une clôture ne touche pas à l'appel : la
    // vente a bien eu lieu, l'argent est simplement reparti. C'est toute la
    // distinction que `cancel_requested_at` porte.
    if (status === 'canceled' && deal.call_id) {
      await supabase.from('calls').update({
        deal_closed: false,
        revenue: 0,
        outcome: 'lost',
      }).eq('id', deal.call_id);
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

  // ⚠️ ON NE TOUCHE À L'APPEL QUE SUR UNE ANNULATION DEMANDÉE — voir plus haut.
  //
  // Ce bloc a dit « ON NE TOUCHE PAS À L'APPEL ICI » jusqu'au 2026-09-09, et son
  // raisonnement reste exact ligne pour ligne : un remboursement dit qu'un
  // mouvement d'argent a eu lieu, jamais pourquoi. Erreur de saisie, geste
  // commercial, rétractation du client : trois raisons courantes, deux
  // conclusions opposées sur « cette vente a-t-elle eu lieu ». Momentum voit
  // l'argent, pas l'intention — deviner se tromperait une fois sur trois, et
  // ferait bouger une carte du kanban que personne n'a demandé à déplacer.
  //
  // Ce qui a changé, c'est que l'intention est maintenant LUE au lieu d'être
  // devinée : `cancel_requested_at` la porte. Quand elle est là, on ne devine
  // rien — quelqu'un a cliqué « Annuler la vente » et l'écran lui a annoncé que
  // l'appel passerait en perdu. Quand elle est absente, ce bloc s'applique
  // toujours intégralement, et l'appel n'est pas touché.
  //
  // Le geste qui déclasse une vente existe, et il est explicite : « Annuler la
  // vente », qui annonce à l'écran que l'appel passera en perdu. Deux faits
  // distincts, deux gestes distincts.
}
