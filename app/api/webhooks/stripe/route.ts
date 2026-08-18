import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { getStripeAccess } from '@/lib/stripe-account';
import { ensureInstallmentSchedule, METADATA_KEYS } from '@/lib/stripe-payment-links';

const WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET!;

// Instance sans compte connecté : sert uniquement à vérifier la signature et à
// désérialiser l'événement. Les appels API passent par getStripeAccess().
//
// Instanciation PARESSEUSE (et non au niveau du module) : `next build` évalue les
// modules des routes pour collecter leurs métadonnées, sans les variables
// d'environnement d'exécution. Un `new Stripe(...)` au chargement échouait donc à
// la compilation — « Neither apiKey nor config.authenticator provided », build en
// erreur, déploiement Vercel bloqué. Même pattern que getServiceSupabase ci-dessous.
let _stripePlatform: Stripe | null = null;
function stripePlatform(): Stripe {
  if (!_stripePlatform) {
    _stripePlatform = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-04-22.dahlia' });
  }
  return _stripePlatform;
}

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type Supa = ReturnType<typeof getServiceSupabase>;

/** Résout le profile_id du compte connecté (OAuth) qui a émis l'événement. */
async function resolveProfileId(supabase: Supa, accountId: string | undefined): Promise<string | null> {
  if (!accountId) return null;
  const { data, error } = await supabase
    .from('integrations')
    .select('profile_id')
    .eq('provider', 'stripe')
    .eq('account_label', accountId)
    .maybeSingle();
  // Une erreur autre que "pas de ligne" doit remonter : mieux vaut un 500 que
  // Stripe retente, plutôt qu'un paiement silencieusement perdu.
  if (error) throw error;
  return data?.profile_id ?? null;
}

/**
 * Extrait la subscription et ses metadata d'une facture, quelle que soit la version
 * d'API du webhook.
 *
 * L'emplacement a changé entre deux versions : jusqu'à Acacia (2025-02-24) la
 * subscription était à la racine de l'Invoice ; depuis Dahlia elle vit sous
 * `parent.subscription_details`. La version appliquée est celle configurée sur le
 * endpoint côté Stripe, pas celle du SDK — un webhook créé il y a des mois envoie
 * donc encore l'ancien format. On lit les deux plutôt que de dépendre d'un réglage
 * de dashboard qui peut différer d'un compte à l'autre.
 *
 * Les `metadata` de subscription_details sont un INSTANTANÉ figé à la finalisation
 * de la facture — c'est précisément ce qui fait que les échéances 2 et 3 d'un 3×
 * portent encore l'identifiant du deal posé à la création du lien. Sans
 * `subscription_data.metadata`, ce champ serait vide et l'échéance orpheline.
 */
function readInvoiceSubscription(inv: Stripe.Invoice): {
  subscriptionId: string | null;
  meta: Record<string, string> | null;
} {
  // Dahlia et suivantes
  const details = inv.parent?.subscription_details ?? null;
  const subFromParent = details?.subscription ?? null;

  // Acacia et antérieures : champs à la racine, absents des types du SDK courant.
  const legacy = inv as unknown as {
    subscription?: string | { id: string } | null;
    subscription_details?: { metadata?: Record<string, string> | null } | null;
  };
  const subLegacy = legacy.subscription ?? null;

  const sub = subFromParent ?? subLegacy;

  return {
    subscriptionId: typeof sub === 'string' ? sub : sub?.id ?? null,
    // Ordre de préférence : metadata de la subscription (portent l'id du deal),
    // puis celles de la facture elle-même en dernier recours.
    meta: (details?.metadata
      ?? legacy.subscription_details?.metadata
      ?? inv.metadata
      ?? null) as Record<string, string> | null,
  };
}

/**
 * Enregistre un paiement sur son deal.
 *
 * Rattachement par ordre de certitude :
 *   1. metadata.momentum_deal_id — posé à la création du lien, voyage jusqu'à la
 *      Charge. Déterministe : survit à l'abandon, au partage du lien, au changement
 *      d'appareil, puisque la donnée vit sur l'objet Stripe et non dans le navigateur.
 *   2. stripe_subscription_id — pour les échéances d'un abonnement rattaché après
 *      coup dans l'écran de réconciliation.
 *   3. Rien → le paiement reste orphelin et remonte dans « À rattacher ».
 */
async function recordPayment(supabase: Supa, params: {
  profileId: string;
  stripePaymentId: string;
  amountMinor: number;
  currency: string;
  paidAt: string;
  status: 'succeeded' | 'failed' | 'pending' | 'refunded';
  failureReason?: string | null;
  metadata?: Record<string, string> | null;
  subscriptionId?: string | null;
}) {
  const dealId = params.metadata?.[METADATA_KEYS.deal] ?? null;
  const installmentId = params.metadata?.[METADATA_KEYS.installment] ?? null;

  let resolvedDealId = dealId;
  let matchMethod: 'metadata' | 'subscription' = 'metadata';

  if (!resolvedDealId && params.subscriptionId) {
    const { data } = await supabase
      .from('deals')
      .select('id')
      .eq('stripe_subscription_id', params.subscriptionId)
      .maybeSingle();
    if (data) { resolvedDealId = data.id; matchMethod = 'subscription'; }
  }

  // Toujours conserver la trace brute : c'est elle qui alimente « À rattacher »
  // quand aucun deal n'a pu être résolu.
  const { error: payErr } = await supabase.from('stripe_payments').upsert({
    profile_id: params.profileId,
    payment_id: params.stripePaymentId,
    amount: params.amountMinor / 100,
    currency: params.currency,
    date: params.paidAt,
    status: params.status,
  }, { onConflict: 'profile_id,payment_id' });
  if (payErr) throw payErr;

  if (!resolvedDealId) return { attached: false };

  // Index partiel + onConflict Supabase JS = combinaison silencieusement cassante
  // (cf. bug pipeline advance/reset). On passe par un delete+insert explicite.
  await supabase.from('deal_payments')
    .delete()
    .eq('deal_id', resolvedDealId)
    .eq('stripe_payment_id', params.stripePaymentId);

  const { error: dpErr } = await supabase.from('deal_payments').insert({
    deal_id: resolvedDealId,
    installment_id: installmentId,
    stripe_payment_id: params.stripePaymentId,
    amount: params.amountMinor / 100,
    currency: params.currency,
    paid_at: params.status === 'succeeded' ? params.paidAt : null,
    status: params.status,
    failure_reason: params.failureReason ?? null,
    match_method: matchMethod,
  });
  if (dpErr) throw dpErr;

  if (installmentId && params.status === 'succeeded') {
    await supabase.from('deal_installments').update({ status: 'paid' }).eq('id', installmentId);
  }

  await refreshDealStatus(supabase, resolvedDealId);
  return { attached: true, dealId: resolvedDealId };
}

/** Recalcule le statut d'un deal à partir de ses paiements réellement encaissés. */
async function refreshDealStatus(supabase: Supa, dealId: string) {
  const { data: deal } = await supabase
    .from('deals')
    .select('amount_total, status')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return;

  const { data: payments } = await supabase
    .from('deal_payments')
    .select('amount, status')
    .eq('deal_id', dealId);

  const collected = (payments ?? [])
    .filter(p => p.status === 'succeeded')
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const hasFailure = (payments ?? []).some(p => p.status === 'failed');

  // Tolérance d'un centime : les arrondis de conversion peuvent laisser un écart
  // infime sur un montant divisé en 3.
  const status = collected >= Number(deal.amount_total) - 0.01
    ? 'paid'
    : hasFailure ? 'past_due' : 'open';

  if (status !== deal.status) {
    await supabase.from('deals').update({ status }).eq('id', dealId);
  }
}

/**
 * Garantit qu'un deal en prélèvement automatique est borné à N prélèvements.
 *
 * Appelée à checkout.session.completed ET à chaque invoice.paid : tant que le
 * bornage n'est pas posé, chaque événement retente. Une subscription non bornée
 * prélèverait le client indéfiniment — c'est le seul endroit du chantier où un
 * bug coûte de l'argent réel, d'où la redondance.
 *
 * Dernier recours : si le nombre de paiements encaissés atteint installments_count
 * alors que le schedule n'a pas pu être posé, on annule la subscription nous-mêmes.
 */
async function guardInstallments(supabase: Supa, dealId: string, profileId: string) {
  const { data: deal } = await supabase
    .from('deals')
    .select('payment_plan, installments_count, installment_interval, stripe_subscription_id')
    .eq('id', dealId)
    .maybeSingle();

  if (!deal || deal.payment_plan !== 'installments_auto') return;
  if (!deal.stripe_subscription_id || !deal.installments_count) return;

  const access = await getStripeAccess(profileId);
  if (!access) return;

  try {
    await ensureInstallmentSchedule(
      access,
      deal.stripe_subscription_id,
      deal.installments_count,
      (deal.installment_interval as 'month' | 'week') ?? 'month',
    );
  } catch (err) {
    console.error(`[stripe] bornage échoué deal=${dealId}`, err);

    // Filet : si le compte y est déjà, on coupe sans attendre le schedule.
    const { count } = await supabase
      .from('deal_payments')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', dealId)
      .eq('status', 'succeeded');

    if ((count ?? 0) >= deal.installments_count) {
      await access.stripe.subscriptions.cancel(deal.stripe_subscription_id, undefined, access.opts)
        .catch(e => console.error(`[stripe] annulation de secours échouée deal=${dealId}`, e));
    }
  }
}

async function handleEvent(event: Stripe.Event) {
  const supabase = getServiceSupabase();
  const profileId = await resolveProfileId(supabase, event.account);

  if (!profileId) {
    // Compte non relié en OAuth : rien à faire ici. Ses paiements remontent par
    // le cron de lecture (chemin clé restreinte), pas par ce webhook.
    console.warn(`[stripe] événement ignoré — compte inconnu: ${event.account}`);
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const dealId = session.metadata?.[METADATA_KEYS.deal];
      if (!dealId) break;

      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id ?? null;
      const customerId = typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id ?? null;

      await supabase.from('deals').update({
        ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
        ...(customerId ? { stripe_customer_id: customerId } : {}),
        ...(session.customer_details?.email ? { buyer_email: session.customer_details.email } : {}),
      }).eq('id', dealId);

      // Chemin nominal du bornage : dès que la subscription existe.
      if (subscriptionId) await guardInstallments(supabase, dealId, profileId);
      break;
    }

    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice;
      const { subscriptionId, meta } = readInvoiceSubscription(inv);

      const res = await recordPayment(supabase, {
        profileId,
        stripePaymentId: inv.id!,
        amountMinor: inv.amount_paid ?? 0,
        currency: inv.currency ?? 'eur',
        paidAt: new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000).toISOString(),
        status: 'succeeded',
        metadata: meta,
        subscriptionId,
      });

      // Rattrapage : si le bornage n'a pas pu être posé au checkout (webhook perdu,
      // erreur réseau), chaque échéance retente. La 2e n'arrive qu'à J+30.
      if (res.attached && res.dealId) await guardInstallments(supabase, res.dealId, profileId);
      break;
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      const { subscriptionId, meta } = readInvoiceSubscription(inv);
      await recordPayment(supabase, {
        profileId,
        stripePaymentId: inv.id!,
        amountMinor: inv.amount_due ?? 0,
        currency: inv.currency ?? 'eur',
        paidAt: new Date(inv.created * 1000).toISOString(),
        status: 'failed',
        failureReason: (inv as any).last_finalization_error?.message ?? 'Paiement refusé',
        metadata: meta,
        subscriptionId,
      });
      break;
    }

    // Paiement comptant : pas de facture, c'est la charge qui porte les metadata.
    case 'charge.succeeded': {
      const charge = event.data.object as Stripe.Charge;
      if (charge.refunded) break;
      await recordPayment(supabase, {
        profileId,
        stripePaymentId: charge.id,
        amountMinor: charge.amount,
        currency: charge.currency,
        paidAt: new Date(charge.created * 1000).toISOString(),
        status: 'succeeded',
        metadata: charge.metadata as Record<string, string> | null,
      });
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      await recordPayment(supabase, {
        profileId,
        stripePaymentId: charge.id,
        amountMinor: charge.amount_refunded,
        currency: charge.currency,
        paidAt: new Date(charge.created * 1000).toISOString(),
        status: 'refunded',
        metadata: charge.metadata as Record<string, string> | null,
      });
      break;
    }

    // L'utilisateur a débranché Momentum depuis son dashboard Stripe.
    case 'account.application.deauthorized': {
      await supabase.from('integrations')
        .update({ access_token: null, refresh_token: null, status: 'disconnected' })
        .eq('provider', 'stripe')
        .eq('account_label', event.account!);
      break;
    }
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') || '';

  if (!WEBHOOK_SECRET) {
    console.error('[stripe] STRIPE_CONNECT_WEBHOOK_SECRET non configuré');
    return NextResponse.json({ error: 'Webhook non configuré' }, { status: 500 });
  }

  // constructEvent plutôt qu'une vérification maison : il contrôle la tolérance
  // temporelle (rejeu impossible) et ne lève pas de RangeError quand la signature
  // a une longueur inattendue — deux défauts de l'implémentation précédente.
  let event: Stripe.Event;
  try {
    event = stripePlatform().webhooks.constructEvent(payload, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] signature invalide', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // 500 → Stripe rejoue l'événement (jusqu'à 3 jours). Préférable à un 200
    // qui perdrait le paiement définitivement.
    console.error(`[stripe] échec traitement ${event.type}`, err);
    return NextResponse.json({ error: 'Échec traitement' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
