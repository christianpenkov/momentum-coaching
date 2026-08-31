import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';
import { calculerCash, resteAEncaisser, type LignePaiement } from '@/lib/dealCash';

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
 * À quoi le montant d'un paiement peut légitimement correspondre sur une vente.
 *
 * ⚠️ Ne comparer QU'AU TOTAL était le défaut : sur une vente en plusieurs fois,
 * un prélèvement ne vaut jamais le total. Un versement de 300 € sur une vente de
 * 900 € ne trouvait donc aucun candidat, l'écran affichait « Aucun deal ne
 * correspond » et le seul bouton restant était « Ignorer » — sur de l'argent
 * réellement encaissé. Le filet ramenait le paiement, l'écran invitait à
 * l'écarter.
 *
 * L'ordre est celui de la force du signal : le total désigne une vente entière,
 * l'échéance un prélèvement attendu, le restant dû un solde. Les trois sont des
 * indices de montant, jamais des preuves — seul l'e-mail identifie une personne.
 */
interface MontantsPlausibles {
  total: number;
  /** Ce qu'il reste à encaisser, calculé par lib/dealCash — jamais à la main. */
  reste: number;
  /** Le montant d'une échéance, si la vente est en plusieurs fois. */
  echeance: number | null;
  /** Pour la phrase affichée : « échéance sur 3 ». */
  nbEcheances: number | null;
}

function correspondanceMontant(
  m: MontantsPlausibles, montant: number,
): 'total' | 'echeance' | 'reste' | null {
  const egal = (v: number | null) => v !== null && Math.abs(v - montant) < 0.01;
  if (egal(m.total)) return 'total';
  if (egal(m.echeance)) return 'echeance';
  if (egal(m.reste)) return 'reste';
  return null;
}

/**
 * Score un deal face à un paiement orphelin.
 *
 * « Certain » exige l'e-mail : c'est le seul signal qui identifie une personne.
 * Un montant identique ne prouve rien — deux clients peuvent payer le même prix.
 */
function scoreCandidate(
  deal: { id: string; buyer_name: string; buyer_email: string | null; amount_total: number; signed_at: string; call_email?: string | null; montants: MontantsPlausibles },
  payment: { amount: number; email: string | null; date: string },
): Candidate | null {
  const quoi = correspondanceMontant(deal.montants, payment.amount);
  const amountMatch = quoi !== null;
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

  // Nommer CE À QUOI le montant correspond, et pas seulement « montant identique » :
  // sur une vente en plusieurs fois, « montant d'une échéance sur 3 » se vérifie
  // d'un coup d'œil, là où « montant identique » laisserait croire à une vente
  // entière et ferait douter du rattachement au moment de cliquer.
  const nb = deal.montants.nbEcheances;
  const montantDit =
    quoi === 'total' ? 'montant identique au total de la vente'
    : quoi === 'echeance' ? `montant d'une échéance${nb ? ` sur ${nb}` : ''}`
    : 'montant du restant dû';
  const MontantDit = montantDit[0].toUpperCase() + montantDit.slice(1);

  if (emailExact && amountMatch) {
    return { ...base(deal), confidence: 'certain', reason: `E-mail identique, ${montantDit}` };
  }
  if (emailExact) {
    return { ...base(deal), confidence: 'certain', reason: `E-mail identique, montant différent (${deal.amount_total} €)` };
  }
  if (emailFuzzy && amountMatch) {
    return { ...base(deal), confidence: 'possible', reason: `${MontantDit}, e-mail proche` };
  }
  if (amountMatch) {
    const when = daysApart < 1 ? 'le même jour' : `à ${Math.round(daysApart)} jours d'écart`;
    return { ...base(deal), confidence: 'possible', reason: `${MontantDit}, vente signée ${when}` };
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
    .select('payment_id, amount, currency, date, description, buyer_email, orphan_cause')
    .eq('profile_id', profileId)
    .eq('payment_id', paymentId)
    .maybeSingle();

  if (!payment) return NextResponse.json({ error: 'Paiement introuvable' }, { status: 404 });

  // Toutes les ventes sauf les annulées. Une vente soldée reste candidate à
  // dessein : un paiement de plus sur une vente terminée est justement le cas
  // « paiement inattendu », qu'il faut pouvoir rattacher pour le voir.
  //
  // Les paiements et les échéances viennent avec, pour calculer le restant dû et
  // le montant d'une échéance. Sans eux, la correspondance ne pourrait se faire
  // qu'au total — le défaut corrigé ici.
  const { data: deals } = await supa
    .from('deals')
    .select('id, buyer_name, buyer_email, amount_total, signed_at, status, call_id, installments_count, deal_payments(amount, status), deal_installments(amount)')
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

  // La colonne d'abord, l'extraction seulement en repli sur les lignes anciennes.
  const payEmail = payment.buyer_email ?? extractEmail(payment.description);

  const candidates = (deals ?? [])
    .map(d => scoreCandidate(
      {
        ...d,
        amount_total: Number(d.amount_total),
        call_email: d.call_id ? callEmails.get(d.call_id) ?? null : null,
        montants: montantsPlausibles(d),
      },
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

/**
 * Les trois montants auxquels un paiement peut correspondre sur cette vente.
 *
 * Le restant dû passe par `calculerCash` : c'est la règle unique du cash, et une
 * somme faite à la main ici ne déduirait pas les remboursements — elle ferait
 * correspondre un paiement à un solde qui n'existe plus.
 *
 * Pour l'échéance, `deal_installments` fait foi quand il est rempli (mode manuel).
 * En prélèvement automatique la table est vide, l'échéancier vivant chez Stripe :
 * on retombe sur la division du total, qui est ce que la vente a promis.
 */
function montantsPlausibles(d: {
  amount_total: number | string;
  installments_count: number | null;
  deal_payments?: { amount: number | string; status: string }[] | null;
  deal_installments?: { amount: number | string }[] | null;
}): MontantsPlausibles {
  const total = Number(d.amount_total);
  const cash = calculerCash((d.deal_payments ?? []).map(p => ({
    amount: p.amount, status: p.status as LignePaiement['status'],
  })));

  const lignes = d.deal_installments ?? [];
  const nb = d.installments_count ?? (lignes.length > 1 ? lignes.length : null);
  const echeance = lignes.length > 0
    ? Number(lignes[0].amount)
    : (nb && nb > 1 ? Math.round((total / nb) * 100) / 100 : null);

  return { total, reste: resteAEncaisser(cash, total), echeance, nbEcheances: nb };
}

/**
 * L'e-mail du payeur, extrait de la description — REPLI D'HISTORIQUE UNIQUEMENT.
 *
 * ⚠️ Ne jamais en refaire la source de vérité. `stripe_payments.buyer_email` existe
 * depuis le 2026-08-31 (migration 20260831140000) et est renseignée par les cinq
 * chemins d'écriture, depuis `charge.billing_details.email`, `invoice.customer_email`
 * ou la session de paiement. Sortir une adresse d'un texte libre tient jusqu'au jour
 * où Stripe change son libellé — et ce jour-là le niveau « Certain » s'éteindrait sans
 * que rien ne le signale, laissant chaque paiement orphelin sans autre issue que
 * « Ignorer ».
 *
 * Ne reste ici que pour les lignes écrites AVANT la colonne. Mesuré ce jour-là :
 * 10 lignes sur 10 sans description, donc ce repli ne rendait déjà rien.
 */
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

  // La cause d'orphelinat décrit un état RÉVOLU dès que le paiement est rattaché.
  // La laisser en place la ferait afficher comme un fait actuel — « ce paiement
  // visait une vente supprimée » alors qu'il en a désormais une. C'est le défaut
  // de la colonne qui garde la dernière valeur connue au lieu de l'état réel.
  //
  // `dismissed_at` n'est PAS touché ici, volontairement : il dit ce que
  // l'utilisateur a décidé, et rattacher plus tard n'efface pas cette décision.
  await supa.from('stripe_payments')
    .update({ orphan_cause: null })
    .eq('profile_id', profileId)
    .eq('payment_id', payment.payment_id);

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
