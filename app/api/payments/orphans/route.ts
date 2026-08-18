import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';

/**
 * Réconciliation des paiements orphelins.
 *
 * GET  — un paiement sans identifiant Momentum, avec ses deals candidats classés
 *        par certitude.
 * POST — rattache un paiement à un deal (ou le marque comme ignoré).
 *
 * JAMAIS de rattachement automatique, même sur un score parfait : un faux positif
 * silencieux attribue du cash au mauvais lead sans que personne le remarque. Deux
 * deals au même montant la même semaine suffisent à le produire. L'élève confirme,
 * et le rattachement est marqué match_method='manual' pour qu'on sache toujours
 * quel chiffre est certain et quel chiffre est déclaré.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Au-delà, un deal signé n'est plus un candidat crédible pour un paiement. */
const MATCH_WINDOW_DAYS = 45;

type Confidence = 'certain' | 'possible';

interface Candidate {
  dealId: string;
  buyerName: string;
  amountTotal: number;
  signedAt: string;
  confidence: Confidence;
  reason: string;
}

/**
 * Score un deal face à un paiement orphelin.
 *
 * « Certain » exige l'e-mail : c'est le seul signal qui identifie une personne.
 * Un montant identique ne prouve rien — deux clients peuvent payer le même prix.
 */
function scoreCandidate(
  deal: { id: string; buyer_name: string; buyer_email: string | null; amount_total: number; signed_at: string; call_email?: string | null },
  payment: { amount: number; email: string | null; date: string },
): Candidate | null {
  const amountMatch = Math.abs(Number(deal.amount_total) - payment.amount) < 0.01;
  const daysApart = Math.abs(
    (new Date(payment.date).getTime() - new Date(deal.signed_at).getTime()) / 86400_000
  );
  if (daysApart > MATCH_WINDOW_DAYS) return null;

  const dealEmails = [deal.buyer_email, deal.call_email].filter(Boolean).map(e => e!.toLowerCase());
  const payEmail = payment.email?.toLowerCase() ?? null;
  const emailExact = !!payEmail && dealEmails.includes(payEmail);

  // Même partie locale, domaine différent (perso vs pro) : un indice, pas une preuve.
  const emailFuzzy = !emailExact && !!payEmail && dealEmails.some(
    e => e.split('@')[0] === payEmail.split('@')[0]
  );

  if (emailExact && amountMatch) {
    return { ...base(deal), confidence: 'certain', reason: 'E-mail identique, montant identique' };
  }
  if (emailExact) {
    return { ...base(deal), confidence: 'certain', reason: `E-mail identique, montant différent (${deal.amount_total} €)` };
  }
  if (emailFuzzy && amountMatch) {
    return { ...base(deal), confidence: 'possible', reason: 'Montant identique, e-mail proche' };
  }
  if (amountMatch) {
    const when = daysApart < 1 ? 'le même jour' : `à ${Math.round(daysApart)} jours d'écart`;
    return { ...base(deal), confidence: 'possible', reason: `Montant identique, signé ${when}` };
  }
  return null;
}

function base(d: { id: string; buyer_name: string; amount_total: number; signed_at: string }) {
  return {
    dealId: d.id,
    buyerName: d.buyer_name,
    amountTotal: Number(d.amount_total),
    signedAt: d.signed_at,
  };
}

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const profileId = await resolveTargetProfile(user.id, params.get('profileId'));
  if (!profileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const paymentId = params.get('paymentId');
  if (!paymentId) return NextResponse.json({ error: 'paymentId requis' }, { status: 400 });

  const { data: payment } = await supa
    .from('stripe_payments')
    .select('payment_id, amount, currency, date, description')
    .eq('profile_id', profileId)
    .eq('payment_id', paymentId)
    .maybeSingle();

  if (!payment) return NextResponse.json({ error: 'Paiement introuvable' }, { status: 404 });

  // Seuls les deals non soldés sont candidats : un deal déjà payé en entier n'a
  // pas besoin d'un paiement de plus.
  const { data: deals } = await supa
    .from('deals')
    .select('id, buyer_name, buyer_email, amount_total, signed_at, status, call_id')
    .eq('profile_id', profileId)
    .neq('status', 'canceled');

  // L'e-mail du call complète celui du deal : un prospect a souvent réservé avec
  // une adresse et payé avec une autre.
  const callIds = (deals ?? []).map(d => d.call_id).filter(Boolean) as string[];
  const callEmails = new Map<string, string>();
  if (callIds.length) {
    const { data: calls } = await supa
      .from('calls').select('id, invitee_email').in('id', callIds);
    for (const c of calls ?? []) if (c.invitee_email) callEmails.set(c.id, c.invitee_email);
  }

  const payEmail = extractEmail(payment.description);

  const candidates = (deals ?? [])
    .map(d => scoreCandidate(
      { ...d, amount_total: Number(d.amount_total), call_email: d.call_id ? callEmails.get(d.call_id) ?? null : null },
      { amount: Number(payment.amount), email: payEmail, date: payment.date },
    ))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => (a.confidence === 'certain' ? -1 : 1) - (b.confidence === 'certain' ? -1 : 1));

  return NextResponse.json({
    payment: {
      paymentId: payment.payment_id,
      amount: Number(payment.amount),
      currency: payment.currency,
      date: payment.date,
      email: payEmail,
      description: payment.description,
    },
    candidates,
  });
}

/** L'e-mail du payeur n'a pas de colonne dédiée : il arrive dans la description. */
function extractEmail(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : null;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.paymentId) return NextResponse.json({ error: 'paymentId requis' }, { status: 400 });

  const profileId = await resolveTargetProfile(user.id, body.profileId ?? null);
  if (!profileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data: payment } = await supa
    .from('stripe_payments')
    .select('payment_id, amount, currency, date')
    .eq('profile_id', profileId)
    .eq('payment_id', body.paymentId)
    .maybeSingle();

  if (!payment) return NextResponse.json({ error: 'Paiement introuvable' }, { status: 404 });

  // « Ignorer » : le paiement n'est pas un deal (remboursement, virement perso).
  // dismissed_at et non status : le statut dit ce que Stripe a fait du paiement,
  // pas ce que l'utilisateur en pense. L'écraser perdrait l'information qu'il a réussi.
  if (body.action === 'ignore') {
    const { error } = await supa.from('stripe_payments')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .eq('payment_id', body.paymentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: 'ignored' });
  }

  if (!body.dealId) return NextResponse.json({ error: 'dealId requis' }, { status: 400 });

  const { data: deal } = await supa
    .from('deals')
    .select('id, amount_total, stripe_subscription_id')
    .eq('id', body.dealId)
    .eq('profile_id', profileId)   // empêche de rattacher au deal d'un autre profil
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Deal introuvable' }, { status: 404 });

  // delete + insert plutôt qu'upsert : onConflict est silencieusement inopérant
  // sur les index partiels avec le client Supabase JS.
  await supa.from('deal_payments')
    .delete()
    .eq('deal_id', deal.id)
    .eq('stripe_payment_id', payment.payment_id);

  const { error: insErr } = await supa.from('deal_payments').insert({
    deal_id: deal.id,
    stripe_payment_id: payment.payment_id,
    amount: Number(payment.amount),
    currency: payment.currency ?? 'eur',
    paid_at: payment.date,
    status: 'succeeded',
    match_method: 'manual',
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await refreshDealStatus(deal.id);

  return NextResponse.json({ ok: true, dealId: deal.id });
}

async function refreshDealStatus(dealId: string) {
  const { data: deal } = await supa
    .from('deals').select('amount_total, status').eq('id', dealId).maybeSingle();
  if (!deal) return;

  const { data: payments } = await supa
    .from('deal_payments').select('amount, status').eq('deal_id', dealId);

  const collected = (payments ?? [])
    .filter(p => p.status === 'succeeded')
    .reduce((s, p) => s + Number(p.amount), 0);
  const hasFailure = (payments ?? []).some(p => p.status === 'failed');

  // Tolérance d'un centime : un montant divisé en 3 laisse un écart d'arrondi.
  const status = collected >= Number(deal.amount_total) - 0.01
    ? 'paid' : hasFailure ? 'past_due' : 'open';

  if (status !== deal.status) {
    await supa.from('deals').update({ status }).eq('id', dealId);
  }
}
