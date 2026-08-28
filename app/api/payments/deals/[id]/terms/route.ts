import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeAccess, resolveTargetProfile } from '@/lib/stripe-account';
import {
  createDealPaymentLink, desactiverLiensDuDeal,
  ajusterPrelevements, ajusterNombreEcheances,
} from '@/lib/stripe-payment-links';
import { calculerCash, resteAEncaisser, type LignePaiement } from '@/lib/dealCash';

/**
 * Modifier les modalités d'une vente : le mode, le rythme, le nombre de fois.
 *
 * PATCH /api/payments/deals/[id]/terms
 *   { plan: 'one_shot'|'installments_auto'|'installments_manual'|'offline',
 *     count?: number, interval?: 'month'|'week' }
 *
 * ── Les deux seuls cas qui obligent à refaire la vente ─────────────────────
 * 1. Changer le RYTHME (mensuel ↔ hebdomadaire) : cela réinitialise l'ancre du
 *    cycle de facturation chez Stripe, qui tente alors un prélèvement immédiat.
 * 2. Changer le MODE (prélèvement ↔ liens ↔ hors Stripe) : ce sont des objets
 *    Stripe différents, un lien payé ne se convertit pas en prélèvement.
 *
 * …et seulement si de l'argent a déjà été encaissé. Tant que rien n'est payé,
 * tout se refait directement — il n'y a qu'un lien à remplacer.
 *
 * Le NOMBRE DE FOIS, lui, se modifie toujours en place : les échéances déjà
 * payées restent intactes, seules les suivantes sont recalculées.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const CENTIME = 0.01;
const arrondi = (n: number) => Math.round(n * 100) / 100;
const JOURS = { month: 30, week: 7 } as const;

type Plan = 'one_shot' | 'installments_auto' | 'installments_manual' | 'offline';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: dealId } = await params;
  const body = await request.json().catch(() => null);

  const plan = String(body?.plan ?? '') as Plan;
  const count = body?.count ? Number(body.count) : null;
  const interval = (body?.interval ?? 'month') as 'month' | 'week';

  if (!['one_shot', 'installments_auto', 'installments_manual', 'offline'].includes(plan)) {
    return NextResponse.json({ error: 'Mode de paiement inconnu' }, { status: 400 });
  }
  if (plan !== 'one_shot' && (!count || count < 2)) {
    return NextResponse.json({ error: "Nombre d'échéances invalide" }, { status: 400 });
  }

  const { data: deal } = await supa
    .from('deals')
    .select(`id, profile_id, status, amount_total, buyer_name, payment_plan, installments_count,
             installment_interval, currency, stripe_subscription_id, stripe_payment_link_id,
             ig_lead_id, first_touch_content_id,
             deal_payments(amount, status),
             deal_installments(id, rank, amount, status, due_on, stripe_payment_link_id)`)
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });

  const allowed = await resolveTargetProfile(user.id, deal.profile_id);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  if (deal.status === 'canceled') {
    return NextResponse.json({
      error: 'Cette vente est annulée. Ses modalités ne peuvent plus être modifiées.',
      code: 'deal_annule',
    }, { status: 409 });
  }

  const paiements = (deal.deal_payments ?? []) as LignePaiement[];
  const cash = calculerCash(paiements);
  const montant = Number(deal.amount_total);
  const reste = resteAEncaisser(cash, montant);

  const modeAvant = modeDe(deal);
  const modeApres = plan;
  const rythmeAvant = deal.installment_interval ?? 'month';

  const changeMode = modeAvant !== modeApres;
  const changeRythme = plan !== 'one_shot' && rythmeAvant !== interval;

  // ── Ce qui oblige à refaire, quand de l'argent est déjà là ─────────────────
  // On ne fait RIEN dans ce cas : la route renvoie ce qu'il faudra rembourser et
  // s'il faut d'abord arrêter des prélèvements, et l'écran conduit l'élève. Agir
  // à moitié laisserait une vente entre deux modes.
  if (cash.net > CENTIME && (changeMode || changeRythme)) {
    return NextResponse.json({
      ok: false,
      refaireRequis: true,
      raison: changeRythme ? 'rythme' : 'mode',
      aRembourser: cash.net,
      arretRequis: !!deal.stripe_subscription_id,
      message: changeRythme
        ? `Changer le rythme oblige à refaire la vente : chez Stripe, passer de ${libelleRythme(rythmeAvant)} à ${libelleRythme(interval)} remet à zéro la date de facturation et déclencherait un prélèvement immédiat sur la carte de ${deal.buyer_name}.`
        : `Changer le mode de paiement oblige à refaire la vente : un paiement déjà encaissé ne se convertit pas d’un mode à l’autre chez Stripe.`,
    }, { status: 409 });
  }

  const access = await getStripeAccess(deal.profile_id);
  const nbEcheances = plan === 'one_shot' ? 1 : count!;

  const echeances = ((deal.deal_installments ?? []) as Array<{ id: string; rank: number; status: string }>);

  // ── Combien d'échéances sont DÉJÀ derrière nous ? ─────────────────────────
  // En prélèvement automatique, `deal_installments` est VIDE : l'échéancier vit
  // chez Stripe. Compter les lignes payées y renvoyait donc toujours zéro, et
  // « passer en 4 fois » découpait le reste en 4 au lieu de 3 — une échéance de
  // trop, à un montant faux.
  //
  // Les lignes de paiement encaissées, elles, existent dans les quatre modes.
  const dejaPayees = echeances.length > 0
    ? echeances.filter(e => e.status === 'paid').length
    : paiements.filter(p => p.status === 'succeeded').length;

  // ══════════════════════════════════════════════════════════════════════════
  // PRÉLÈVEMENT AUTOMATIQUE : rien à créer, tout à ajuster chez Stripe
  // ══════════════════════════════════════════════════════════════════════════
  // Ce mode n'a ni échéance en base ni lien par échéance : c'est Stripe qui
  // prélève. Lui fabriquer des liens produisait un « échéance 1 sur 4 » payable
  // en double, sur une vente que Stripe continuait de prélever à l'ancien
  // montant — la base et Stripe racontaient deux histoires différentes.
  if (plan === 'installments_auto' && deal.stripe_subscription_id && !changeMode && !changeRythme) {
    if (!access) {
      return NextResponse.json({
        error: 'Stripe n’est pas connecté : les prélèvements ne peuvent pas être ajustés.',
        code: 'stripe_absent',
      }, { status: 502 });
    }

    const restantes = Math.max(1, nbEcheances - dejaPayees);
    const parEcheance = arrondi(reste / restantes);

    // Stripe d'abord, la base ensuite. Si l'ajustement échoue, la fiche ne doit
    // surtout pas annoncer un découpage que Stripe ne prélève pas.
    const montantOk = await ajusterPrelevements(
      access, deal.stripe_subscription_id, parEcheance, deal.currency ?? 'eur');
    if (!montantOk.ajuste) {
      return NextResponse.json({
        error: "Les prélèvements n'ont pas pu être ajustés chez Stripe. Rien n'a été modifié.",
        code: 'stripe_ajustement_impossible', raison: montantOk.raison,
      }, { status: 502 });
    }

    const bornageOk = await ajusterNombreEcheances(
      access, deal.stripe_subscription_id, nbEcheances, interval);
    if (!bornageOk.ajuste) {
      return NextResponse.json({
        error: "Le nombre de prélèvements n'a pas pu être modifié chez Stripe. Le montant, lui, a été ajusté — reprends l'opération.",
        code: 'stripe_bornage_impossible', raison: bornageOk.raison,
      }, { status: 502 });
    }

    await supa.from('deals').update({
      payment_plan: 'installments_auto',
      installments_count: nbEcheances > 1 ? nbEcheances : null,
      installment_interval: nbEcheances > 1 ? interval : null,
    }).eq('id', dealId);

    await supa.from('deal_events').insert({
      deal_id: dealId,
      kind: 'terms_changed',
      label: `Modalités modifiées · ${libelle(modeAvant, deal.installments_count, rythmeAvant)} → ${libelle(modeApres, nbEcheances > 1 ? nbEcheances : null, interval)}`,
      actor_id: user.id,
      meta: { avant: modeAvant, apres: modeApres, count: nbEcheances, interval, parEcheance, restantes },
    });

    return NextResponse.json({
      ok: true, liens: [], echeances: nbEcheances,
      prelevements: { restantes, parEcheance },
    });
  }

  // ── Refonte des échéances ─────────────────────────────────────────────────
  // Les échéances déjà payées ne sont jamais touchées. Seules les autres sont
  // supprimées puis recréées au nouveau découpage, avec leurs liens.
  if (access) await desactiverLiensDuDeal(supa, dealId, deal.profile_id);
  for (const e of echeances.filter(e => e.status !== 'paid')) {
    await supa.from('deal_installments').delete().eq('id', e.id);
  }

  const aCreer = Math.max(0, nbEcheances - dejaPayees);
  const liens: Array<{ rank: number; url: string; amount: number }> = [];

  if (aCreer > 0 && reste > CENTIME) {
    const part = arrondi(reste / aCreer);
    const premiere = arrondi(reste - part * (aCreer - 1));
    const depart = Date.now();

    for (let i = 0; i < aCreer; i++) {
      const rank = dejaPayees + i + 1;
      const somme = i === 0 ? premiere : part;
      const echeance = new Date(depart + i * JOURS[interval] * 86400_000);

      const { data: cree } = await supa.from('deal_installments').insert({
        deal_id: dealId,
        rank,
        amount: somme,
        due_on: echeance.toISOString().slice(0, 10),
        status: 'pending',
      }).select('id').single();

      // Hors Stripe : aucun lien, l'échéancier vit dans Momentum et c'est l'élève
      // qui coche les virements reçus.
      if (plan === 'offline' || !access || !cree) continue;

      const lien = await createDealPaymentLink({
        profileId: deal.profile_id,
        dealId,
        amount: somme,
        productName: nbEcheances > 1
          ? `Accompagnement — ${deal.buyer_name} — ${rank}/${nbEcheances}`
          : `Accompagnement — ${deal.buyer_name}`,
        leadId: deal.ig_lead_id,
        installmentId: nbEcheances > 1 ? cree.id : null,
        contentId: deal.first_touch_content_id,
        installments: plan === 'installments_auto' ? { count: aCreer, interval } : null,
      }, access);

      await supa.from('deal_installments').update({
        stripe_payment_link_id: lien.paymentLinkId,
        short_url: lien.url,
        stripe_url: lien.stripeUrl,
        shortio_link_id: lien.shortioId,
      }).eq('id', cree.id);

      liens.push({ rank, url: lien.url, amount: somme });

      // En prélèvement automatique, un seul lien suffit : c'est lui qui met en
      // place les prélèvements suivants quand le client le paie.
      if (plan === 'installments_auto') break;
    }
  }

  await supa.from('deals').update({
    payment_plan: plan === 'offline' ? (nbEcheances > 1 ? 'installments_manual' : 'one_shot') : plan,
    installments_count: nbEcheances > 1 ? nbEcheances : null,
    installment_interval: nbEcheances > 1 ? interval : null,
    short_url: liens[0]?.url ?? null,
    stripe_payment_link_id: null,
  }).eq('id', dealId);

  await supa.from('deal_events').insert({
    deal_id: dealId,
    kind: 'terms_changed',
    label: `Modalités modifiées · ${libelle(modeAvant, deal.installments_count, rythmeAvant)} → ${libelle(modeApres, nbEcheances > 1 ? nbEcheances : null, interval)}`,
    actor_id: user.id,
    meta: { avant: modeAvant, apres: modeApres, count: nbEcheances, interval },
  });

  return NextResponse.json({ ok: true, liens, echeances: nbEcheances });
}

/** Le mode réel d'une vente, déduit de ses objets Stripe plutôt que du seul plan. */
function modeDe(deal: {
  payment_plan: string | null;
  stripe_subscription_id: string | null;
  stripe_payment_link_id: string | null;
  deal_installments?: Array<{ stripe_payment_link_id: string | null }> | null;
}): Plan {
  if (deal.stripe_subscription_id) return 'installments_auto';
  const aDesLiens = !!deal.stripe_payment_link_id
    || (deal.deal_installments ?? []).some(e => !!e.stripe_payment_link_id);
  if (!aDesLiens) return 'offline';
  return deal.payment_plan === 'installments_manual' ? 'installments_manual' : 'one_shot';
}

const libelleRythme = (i: string) => (i === 'week' ? 'hebdomadaire' : 'mensuel');

function libelle(plan: Plan, count: number | null, interval: string): string {
  const noms: Record<Plan, string> = {
    one_shot: 'comptant',
    installments_auto: 'prélèvement automatique',
    installments_manual: 'un lien par échéance',
    offline: 'hors Stripe',
  };
  return count && count > 1
    ? `${count} fois ${libelleRythme(interval)}, ${noms[plan]}`
    : noms[plan];
}
