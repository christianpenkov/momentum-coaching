import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeAccess, resolveTargetProfile } from '@/lib/stripe-account';
import {
  createDealPaymentLink,
  desactiverLiensDuDeal,
  ajusterPrelevements,
} from '@/lib/stripe-payment-links';
import { calculerCash, aRembourser, resteAEncaisser, type LignePaiement } from '@/lib/dealCash';

/**
 * Corriger le montant d'une vente.
 *
 * PATCH /api/payments/deals/[id]/amount   { amount: number }
 *
 * ── La règle, en une phrase ────────────────────────────────────────────────
 * Nouveau montant AU-DESSUS de l'encaissé → on refait ce qu'il faut (lien, liens
 * d'échéances, ou prélèvements) pour encaisser le reste. Nouveau montant EN
 * DESSOUS → on rembourse la différence.
 *
 * Vraie pour les quatre modes de paiement. Ce qui change d'un mode à l'autre,
 * c'est l'objet à refaire, jamais la logique.
 *
 * ── Ce que cette route ne fait jamais ──────────────────────────────────────
 * Elle ne rembourse pas et n'arrête pas de prélèvement : ces deux gestes sont
 * irréversibles chez Stripe et restent entre les mains de l'élève. Elle renvoie
 * `aRembourser` et `arretRequis`, et l'écran le conduit.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const CENTIME = 0.01;
const arrondi = (n: number) => Math.round(n * 100) / 100;

interface Echeance {
  id: string;
  rank: number;
  amount: number | string;
  status: string;
  due_on: string | null;
  stripe_payment_link_id: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: dealId } = await params;
  const body = await request.json().catch(() => null);
  const montant = Number(body?.amount);

  if (!Number.isFinite(montant) || montant <= 0) {
    return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
  }

  const { data: deal } = await supa
    .from('deals')
    .select(`id, profile_id, status, amount_total, buyer_name, payment_plan, installments_count,
             installment_interval, currency, stripe_subscription_id,
             ig_lead_id, first_touch_content_id,
             deal_payments(amount, status),
             deal_installments(id, rank, amount, status, due_on, stripe_payment_link_id)`)
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });

  const allowed = await resolveTargetProfile(user.id, deal.profile_id);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  // Une vente annulée n'a plus de montant à corriger : elle est sortie des
  // chiffres, la modifier n'aurait aucun effet visible.
  if (deal.status === 'canceled') {
    return NextResponse.json({
      error: 'Cette vente est annulée. Son montant ne peut plus être modifié.',
      code: 'deal_annule',
    }, { status: 409 });
  }

  const ancien = Number(deal.amount_total);
  const paiements = (deal.deal_payments ?? []) as LignePaiement[];
  const cash = calculerCash(paiements);
  const echeances = ((deal.deal_installments ?? []) as Echeance[])
    .slice().sort((a, b) => a.rank - b.rank);
  const aVenir = echeances.filter(e => e.status !== 'paid');

  const access = await getStripeAccess(deal.profile_id);

  // Hors Stripe se reconnaît à l'absence de TOUT objet Stripe : pas de lien sur
  // la vente, aucun sur ses échéances, pas de prélèvement. Se fier aux seules
  // échéances ne suffisait pas — un comptant hors Stripe déjà encaissé n'en a
  // aucune (links/route.ts enregistre directement le paiement).
  const horsStripe = !deal.stripe_subscription_id
    && !(deal as { stripe_payment_link_id?: string | null }).stripe_payment_link_id
    && echeances.every(e => !e.stripe_payment_link_id);

  const trop = aRembourser(cash, montant);
  const reste = resteAEncaisser(cash, montant);
  const liens: Array<{ rank: number | null; url: string; amount: number }> = [];
  let arretRequis = false;

  if (trop > CENTIME) {
    // ── Le nouveau montant passe SOUS ce qui est déjà encaissé ───────────────
    // Plus rien à encaisser : les échéances à venir sont annulées et leurs liens
    // cessent d'être payables. Le remboursement, lui, reste à faire par l'élève.
    for (const e of aVenir) {
      await supa.from('deal_installments').delete().eq('id', e.id);
    }
    if (access) await desactiverLiensDuDeal(supa, dealId, deal.profile_id);

    // Un prélèvement automatique en cours continuerait de prélever malgré tout :
    // seul l'élève peut l'arrêter, l'écran l'y conduit.
    arretRequis = !!deal.stripe_subscription_id;

  } else if (reste > CENTIME) {
    // ── Il reste à encaisser ────────────────────────────────────────────────
    if (deal.stripe_subscription_id && aVenir.length === 0 && access) {
      // Prélèvement automatique en cours : on ajuste les échéances restantes
      // chez Stripe. Rien n'est prélevé aujourd'hui, les dates ne bougent pas.
      //
      // ⚠️ CHEZ STRIPE D'ABORD, EN BASE ENSUITE. Si l'ajustement échoue, le
      // montant ne doit surtout pas avoir changé : la fiche annoncerait des
      // échéances à 500 € pendant que Stripe en prélèverait 1 000.
      //
      // Le nombre d'échéances déjà passées se compte sur les lignes de paiement
      // réellement encaissées — en mode automatique `deal_installments` est vide
      // (l'échéancier vit chez Stripe), et diviser l'encaissé par un montant
      // supposé se serait trompé dès la première correction.
      const passees = paiements.filter(p => p.status === 'succeeded').length;
      const restantes = Math.max(1, Number(deal.installments_count ?? 1) - passees);

      const ok = await ajusterPrelevements(
        access, deal.stripe_subscription_id, arrondi(reste / restantes), deal.currency ?? 'eur',
      );
      if (!ok.ajuste) {
        return NextResponse.json({
          error: "Les prélèvements n'ont pas pu être ajustés chez Stripe. Le montant n'a pas été modifié.",
          code: 'stripe_ajustement_impossible',
          raison: ok.raison,
        }, { status: 502 });
      }

    } else if (horsStripe) {
      // Hors Stripe : aucun lien, aucun prélèvement. Seul l'échéancier de
      // Momentum est recalculé — l'élève prévient son client lui-même.
      await repartir(aVenir, reste);

    } else if (aVenir.length > 0 && access) {
      // Un lien par échéance : ceux des échéances déjà payées ne sont jamais
      // touchés, seuls les autres sont remplacés.
      await desactiverLiensDuDeal(supa, dealId, deal.profile_id);
      const parEcheance = await repartir(aVenir, reste);
      for (const e of aVenir) {
        const lien = await createDealPaymentLink({
          profileId: deal.profile_id,
          dealId,
          amount: parEcheance.get(e.id) ?? 0,
          productName: `Accompagnement — ${deal.buyer_name} — ${e.rank}/${echeances.length}`,
          leadId: deal.ig_lead_id,
          installmentId: e.id,
          contentId: deal.first_touch_content_id,
        }, access);
        await supa.from('deal_installments').update({
          stripe_payment_link_id: lien.paymentLinkId,
          short_url: lien.url,
          stripe_url: lien.stripeUrl,
          shortio_link_id: lien.shortioId,
        }).eq('id', e.id);
        liens.push({ rank: e.rank, url: lien.url, amount: parEcheance.get(e.id) ?? 0 });
      }

    } else if (access) {
      // Comptant : soit rien n'est payé et le lien est refait au bon montant,
      // soit la vente est déjà payée et c'est un lien de COMPLÉMENT — dans les
      // deux cas un seul lien, pour exactement ce qu'il reste à encaisser.
      await desactiverLiensDuDeal(supa, dealId, deal.profile_id);
      const complement = cash.net > CENTIME;
      const lien = await createDealPaymentLink({
        profileId: deal.profile_id,
        dealId,
        amount: reste,
        productName: complement
          ? `Complément — ${deal.buyer_name}`
          : `Accompagnement — ${deal.buyer_name}`,
        leadId: deal.ig_lead_id,
        contentId: deal.first_touch_content_id,
      }, access);
      await supa.from('deals').update({
        stripe_payment_link_id: lien.paymentLinkId,
        short_url: lien.url,
        stripe_url: lien.stripeUrl,
        shortio_link_id: lien.shortioId,
      }).eq('id', dealId);
      liens.push({ rank: null, url: lien.url, amount: reste });
    }
  }

  // ── Le montant est écrit EN DERNIER ────────────────────────────────────────
  // Tout ce qui pouvait échouer — Stripe surtout — est passé. Écrire avant aurait
  // laissé une fiche qui annonce un montant que Stripe ne prélève pas.
  //
  // À partir d'ici, les montants font foi : l'écart s'affiche sur la fiche et
  // disparaît quand l'argent bouge. Aucune étape verrouillée — si l'élève ferme
  // l'écran, la fiche continue de dire ce qu'il reste à faire, et il n'y a rien
  // à reprendre ni à nettoyer.
  await supa.from('deals').update({ amount_total: montant }).eq('id', dealId);

  await supa.from('deal_events').insert({
    deal_id: dealId,
    kind: 'amount_changed',
    label: `Montant modifié · ${fmt(ancien)} → ${fmt(montant)}`,
    actor_id: user.id,
    meta: { avant: ancien, apres: montant, encaisse: cash.net, aRembourser: trop, resteDu: reste },
  });

  return NextResponse.json({
    ok: true,
    montant,
    encaisse: cash.net,
    aRembourser: trop,
    resteAEncaisser: reste,
    arretRequis,
    liens,
  });
}

/**
 * Répartit une somme sur des échéances, au centime près.
 * Le reliquat d'arrondi va sur la première : la somme des échéances doit faire
 * exactement le total, sinon la vente ne se solderait jamais.
 */
async function repartir(echeances: Echeance[], total: number): Promise<Map<string, number>> {
  const parts = new Map<string, number>();
  if (echeances.length === 0) return parts;

  const part = arrondi(total / echeances.length);
  const premiere = arrondi(total - part * (echeances.length - 1));

  for (const [i, e] of echeances.entries()) {
    const montant = i === 0 ? premiere : part;
    parts.set(e.id, montant);
    await supa.from('deal_installments').update({ amount: montant }).eq('id', e.id);
  }
  return parts;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
