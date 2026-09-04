import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';
import { calculerCash, statutDeal, type LignePaiement } from '@/lib/dealCash';

/**
 * Déclarer un remboursement fait hors Stripe.
 *
 * POST /api/payments/deals/[id]/declare-refund
 *   { amount, date?, confirmed: true, finaliserAnnulation?: boolean }
 *
 * ── Pourquoi cette route existe ────────────────────────────────────────────
 * Sur un virement, Momentum est aveugle DANS LES DEUX SENS : il ne voit pas
 * l'argent entrer, il ne le voit pas sortir. Un remboursement par virement ne
 * produit aucun événement — sans déclaration, la vente resterait éternellement
 * « en attente de remboursement » alors que le client a été remboursé.
 *
 * ── Ce que la déclaration engage ───────────────────────────────────────────
 * Elle écrit un mouvement d'argent que personne ne peut vérifier. D'où la case
 * rouge, et la trace au journal de qui a déclaré quoi, et quand : c'est ce qui
 * protège l'élève si le client conteste plus tard.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const CENTIME = 0.01;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: dealId } = await params;
  const body = await request.json().catch(() => ({}));

  if (body?.confirmed !== true) {
    return NextResponse.json({
      error: 'Cette déclaration doit être confirmée.',
      code: 'confirmation_requise',
    }, { status: 400 });
  }

  const brut = Number(body?.amount);
  if (!Number.isFinite(brut) || brut <= 0) {
    return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
  }
  const montant = Math.round(brut * 100) / 100;

  const quand = body?.date ? new Date(body.date) : new Date();
  if (Number.isNaN(quand.getTime())) {
    return NextResponse.json({ error: 'Date invalide' }, { status: 400 });
  }

  const { data: deal } = await supa
    .from('deals')
    .select('id, profile_id, status, amount_total, buyer_name, call_id, refund_explique, deal_payments(amount, status)')
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });

  const allowed = await resolveTargetProfile(user.id, deal.profile_id);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const avant = calculerCash(deal.deal_payments as LignePaiement[]);

  // ── On ne rend pas plus qu'on n'a reçu ─────────────────────────────────────
  // Sans cette borne, une faute de frappe ferait passer l'encaissé sous zéro et
  // le total du client afficherait un montant négatif, sans que rien ne signale
  // l'erreur.
  if (montant > avant.net + CENTIME) {
    return NextResponse.json({
      error: `Cette vente n’a encaissé que ${fmt(avant.net)}. Tu ne peux pas déclarer un remboursement supérieur.`,
      code: 'montant_superieur_encaisse',
      encaisse: avant.net,
    }, { status: 400 });
  }

  const { error } = await supa.from('deal_payments').insert({
    deal_id: dealId,
    stripe_payment_id: `offline_refund_${dealId}_${Date.now()}`,
    amount: montant,
    currency: 'eur',
    paid_at: quand.toISOString(),
    status: 'refunded',
    match_method: 'manual',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const apres = calculerCash([
    ...(deal.deal_payments as LignePaiement[]),
    { amount: montant, status: 'refunded' },
  ]);

  // ── Le remboursement seul ne déclasse jamais la vente ──────────────────────
  // Même règle que côté Stripe : un mouvement d'argent dit qu'il a eu lieu,
  // jamais pourquoi. Seul `finaliserAnnulation` — le geste explicite du parcours
  // d'annulation — fait sortir la vente des chiffres.
  let annulee = false;

  if (body?.finaliserAnnulation === true && apres.net <= CENTIME) {
    await supa.from('deals').update({
      status: 'canceled',
      ended_at: new Date().toISOString(),
    }).eq('id', dealId);
    await supa.from('deal_installments').delete().eq('deal_id', dealId).neq('status', 'paid');

    if (deal.call_id) {
      await supa.from('calls').update({
        deal_closed: false, revenue: 0, outcome: 'lost',
      }).eq('id', deal.call_id);
    }
    annulee = true;

  } else {
    const suivant = statutDeal(apres, Number(deal.amount_total), deal.status);
    if (suivant && suivant !== deal.status) {
      await supa.from('deals').update({ status: suivant }).eq('id', dealId);
    }
  }

  // ── Un remboursement passé par ICI est déjà expliqué ──────────────────────
  // `refund_explique` sert au bandeau « Pourquoi X € sont-ils repartis ? », qui
  // existe pour les remboursements faits DIRECTEMENT dans Stripe : Momentum les
  // constate sans savoir pourquoi, et sans la raison on ignore si le client doit
  // encore la somme. Ceux qui passent par ce parcours, eux, ont une cause connue
  // — c'est l'élève qui vient de la poser, en annulant ou en baissant le montant.
  //
  // Sans ce crédit, la plateforme posait une question dont elle avait elle-même
  // la réponse, et collait un badge « À EXPLIQUER » sur une vente qu'on venait
  // d'annuler par le parcours guidé (constaté sur TestStory le 2026-09-05).
  await supa.from('deals')
    .update({ refund_explique: Math.round((Number(deal.refund_explique ?? 0) + montant) * 100) / 100 })
    .eq('id', dealId);

  await supa.from('deal_events').insert({
    deal_id: dealId,
    kind: 'refund_declared',
    label: `Remboursement déclaré hors Stripe · ${fmt(montant)}`,
    actor_id: user.id,
    meta: {
      montant,
      date: quand.toISOString(),
      encaisseAvant: avant.net,
      encaisseApres: apres.net,
      annulee,
      // La case cochée est la pièce qui protège : elle dit que l'élève a lu ce
      // qu'il engageait, et le journal dit quand.
      responsabiliteAcceptee: true,
    },
  });

  return NextResponse.json({
    ok: true,
    montant,
    encaisse: apres.net,
    resteARembourser: Math.max(0, Math.round(apres.net * 100) / 100),
    annulee,
  });
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
