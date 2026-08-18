import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Lecture des paiements Stripe pour les comptes connectés par CLÉ RESTREINTE.
 *
 * Le webhook Connect (app/api/webhooks/stripe) ne reçoit d'événements que pour les
 * comptes reliés en OAuth : c'est `event.account` qui permet de retrouver le profil.
 * Un élève dont le compte Stripe est déjà contrôlé par une autre plateforme ne peut
 * pas passer par OAuth (restriction Stripe de juin 2021) et n'a que la clé — d'où
 * cette fonction, qui lit ses paiements et les rattache par les MÊMES metadata.
 *
 * Les comptes OAuth sont ignorés ici : leur webhook fait déjà le travail en temps
 * réel, les traiter aussi doublerait les appels pour rien.
 *
 * Appel : cron-job.org, header `Authorization: Bearer ${CRON_SECRET}`.
 * NE PAS toucher vercel.json — les crons du projet vivent sur cron-job.org.
 *
 * Déploiement : supabase functions deploy sync-stripe-payments --no-verify-jwt
 * (le --no-verify-jwt est obligatoire : cron-job.org envoie CRON_SECRET, pas un JWT).
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Metadata posées à la création du lien (lib/stripe-payment-links.ts). Dupliquées
// ici faute d'import cross-runtime possible — même pattern que isValidContentId
// dans sync-calendly/index.ts.
const MD_DEAL = 'momentum_deal_id';
const MD_INSTALLMENT = 'momentum_installment_id';

/** Filet en cas de première passe ou de panne prolongée du cron. */
const MAX_LOOKBACK_DAYS = 30;
/** Recouvrement volontaire : un paiement à cheval sur deux passes est vu deux fois
 *  plutôt que zéro. Le dédoublonnage se fait en base, le coût est nul. */
const OVERLAP_MINUTES = 30;

interface SyncResult { seen: number; attached: number; errors: string[] }

/** Un appel Stripe. La clé EST celle du compte : pas d'en-tête Stripe-Account. */
async function stripeGet(apiKey: string, path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}?${qs}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Stripe-Version': '2026-04-22.dahlia',
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || `Stripe ${path} ${res.status}`);
  return body;
}

/**
 * Pagination explicite : sans elle, un compte actif verrait ses paiements les plus
 * récents tronqués au-delà de 100 — exactement le piège rencontré sur
 * shortio_link_daily_snapshots (limite implicite silencieuse, aucune erreur levée).
 * Borne dure à 10 pages pour ne jamais saturer le temps d'exécution.
 */
async function stripeList(apiKey: string, path: string, since: number, extra: Record<string, string> = {}): Promise<any[]> {
  const out: any[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < 10; page++) {
    const body = await stripeGet(apiKey, path, {
      'created[gte]': String(since),
      limit: '100',
      ...extra,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const data: any[] = body.data ?? [];
    out.push(...data);
    if (!body.has_more || !data.length) break;
    startingAfter = data[data.length - 1].id;
  }

  return out;
}

async function refreshDealStatus(dealId: string) {
  const { data: deal } = await supabase
    .from('deals').select('amount_total, status').eq('id', dealId).maybeSingle();
  if (!deal) return;

  const { data: payments } = await supabase
    .from('deal_payments').select('amount, status').eq('deal_id', dealId);

  const collected = (payments ?? [])
    .filter((p: any) => p.status === 'succeeded')
    .reduce((s: number, p: any) => s + Number(p.amount), 0);
  const hasFailure = (payments ?? []).some((p: any) => p.status === 'failed');

  // Tolérance d'un centime : un montant divisé en 3 laisse un écart d'arrondi.
  const status = collected >= Number(deal.amount_total) - 0.01
    ? 'paid' : hasFailure ? 'past_due' : 'open';

  if (status !== deal.status) {
    await supabase.from('deals').update({ status }).eq('id', dealId);
  }
}

/** Même ordre de certitude que le webhook : metadata, puis subscription. */
async function upsertPayment(profileId: string, p: {
  paymentId: string;
  amountMinor: number;
  currency: string;
  paidAt: string;
  metadata: Record<string, string> | null;
  subscriptionId: string | null;
}): Promise<boolean> {
  const { error: payErr } = await supabase.from('stripe_payments').upsert({
    profile_id: profileId,
    payment_id: p.paymentId,
    amount: p.amountMinor / 100,
    currency: p.currency,
    date: p.paidAt,
    status: 'succeeded',
  }, { onConflict: 'profile_id,payment_id' });
  if (payErr) throw payErr;

  let dealId = p.metadata?.[MD_DEAL] ?? null;
  let matchMethod: 'metadata' | 'subscription' = 'metadata';

  if (!dealId && p.subscriptionId) {
    const { data } = await supabase
      .from('deals').select('id')
      .eq('stripe_subscription_id', p.subscriptionId)
      .maybeSingle();
    if (data) { dealId = data.id; matchMethod = 'subscription'; }
  }

  if (!dealId) return false;

  // Le recouvrement de fenêtre fait repasser sur des paiements déjà traités :
  // on sort avant d'écrire plutôt que de compter sur un upsert (index partiel +
  // onConflict Supabase JS = échec silencieux, cf. bug pipeline advance/reset).
  const { data: existing } = await supabase
    .from('deal_payments').select('id')
    .eq('deal_id', dealId).eq('stripe_payment_id', p.paymentId)
    .maybeSingle();
  if (existing) return false;

  const installmentId = p.metadata?.[MD_INSTALLMENT] ?? null;

  const { error } = await supabase.from('deal_payments').insert({
    deal_id: dealId,
    installment_id: installmentId,
    stripe_payment_id: p.paymentId,
    amount: p.amountMinor / 100,
    currency: p.currency,
    paid_at: p.paidAt,
    status: 'succeeded',
    match_method: matchMethod,
  });
  if (error) throw error;

  if (installmentId) {
    await supabase.from('deal_installments').update({ status: 'paid' }).eq('id', installmentId);
  }

  await refreshDealStatus(dealId);
  return true;
}

async function syncProfile(profileId: string, apiKey: string, lastSyncedAt: string | null): Promise<SyncResult> {
  const errors: string[] = [];
  let seen = 0;
  let attached = 0;

  // Fenêtre incrémentale : on repart du dernier passage réussi, moins un
  // recouvrement. Sans borne basse (première passe), on remonte 30 jours.
  const floor = Date.now() - MAX_LOOKBACK_DAYS * 86400_000;
  const from = lastSyncedAt
    ? Math.max(new Date(lastSyncedAt).getTime() - OVERLAP_MINUTES * 60_000, floor)
    : floor;
  const since = Math.floor(from / 1000);

  // Charges : les paiements comptant. Factures : les échéances d'abonnement.
  // Un paiement d'abonnement produit les deux — le dédoublonnage se fait en base.
  const charges = await stripeList(apiKey, 'charges', since);
  for (const charge of charges) {
    if (charge.status !== 'succeeded' || charge.refunded) continue;
    seen++;
    try {
      if (await upsertPayment(profileId, {
        paymentId: charge.id,
        amountMinor: charge.amount,
        currency: charge.currency,
        paidAt: new Date(charge.created * 1000).toISOString(),
        metadata: charge.metadata ?? null,
        subscriptionId: null,
      })) attached++;
    } catch (e) {
      errors.push(`charge ${charge.id}: ${(e as Error).message}`);
    }
  }

  const invoices = await stripeList(apiKey, 'invoices', since, { status: 'paid' });
  for (const inv of invoices) {
    if (!inv.id) continue;
    seen++;
    // API Dahlia : la subscription a déménagé sous parent.subscription_details.
    // Ses metadata sont un instantané figé à la finalisation — c'est ce qui fait
    // que les échéances 2 et 3 d'un 3× portent encore l'id du deal.
    const details = inv.parent?.subscription_details ?? null;
    const sub = details?.subscription ?? null;
    try {
      if (await upsertPayment(profileId, {
        paymentId: inv.id,
        amountMinor: inv.amount_paid ?? 0,
        currency: inv.currency ?? 'eur',
        paidAt: new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000).toISOString(),
        metadata: details?.metadata ?? inv.metadata ?? null,
        subscriptionId: typeof sub === 'string' ? sub : sub?.id ?? null,
      })) attached++;
    } catch (e) {
      errors.push(`invoice ${inv.id}: ${(e as Error).message}`);
    }
  }

  return { seen, attached, errors };
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 });
  }

  // Uniquement les comptes SANS access_token : ceux en OAuth passent par le webhook.
  const { data: integrations, error } = await supabase
    .from('integrations')
    .select('profile_id, api_key, metadata')
    .eq('provider', 'stripe')
    .is('access_token', null)
    .not('api_key', 'is', null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!integrations?.length) {
    return new Response(JSON.stringify({ ok: true, profiles: 0, attached: 0 }), { status: 200 });
  }

  // Borne figée AVANT traitement : un paiement arrivant pendant l'exécution sera
  // repris au cycle suivant, que le recouvrement de 30 min garantit de couvrir.
  const runStartedAt = new Date().toISOString();

  // En parallèle : ~10 appels Stripe par profil, très en deçà du timeout à 20 élèves.
  const results = await Promise.all(
    (integrations as any[]).map((integ) =>
      // last_synced_at est déjà utilisée par sync-calendly sur d'autres lignes, mais
      // c'est la même colonne : on isole la borne Stripe dans metadata pour que les
      // deux crons ne se marchent jamais dessus.
      syncProfile(integ.profile_id, integ.api_key, integ.metadata?.stripe_synced_at ?? null)
        .then(r => ({ profile_id: integ.profile_id, metadata: integ.metadata, ...r }))
        .catch((e: any) => ({
          profile_id: integ.profile_id, metadata: integ.metadata,
          seen: 0, attached: 0, errors: [e?.message || 'unknown'],
        }))
    )
  );

  // On n'avance la borne QUE pour les profils sans erreur : un profil en échec
  // rejouera sa fenêtre complète au cycle suivant. En cas de doute on retraite
  // trop, jamais trop peu — même règle que sync-calendly.
  for (const r of results) {
    if (r.errors.length) continue;
    await supabase.from('integrations')
      .update({ metadata: { ...(r.metadata ?? {}), stripe_synced_at: runStartedAt } })
      .eq('provider', 'stripe')
      .eq('profile_id', r.profile_id);
  }

  const allErrors: Record<string, string[]> = {};
  for (const r of results) if (r.errors.length) allErrors[r.profile_id] = r.errors;

  return new Response(JSON.stringify({
    ok: true,
    profiles: integrations.length,
    seen: results.reduce((a, r) => a + r.seen, 0),
    attached: results.reduce((a, r) => a + r.attached, 0),
    errors: allErrors,
  }), { status: 200 });
});
