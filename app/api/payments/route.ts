import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';

/**
 * Données de la page Paiements — les trois onglets en une requête.
 *
 * GET /api/payments?profileId=… (profileId optionnel : un coach peut consulter
 * un de ses élèves, contrôle d'accès via resolveTargetProfile).
 *
 * Un seul appel plutôt qu'un par onglet : les trois vues partagent les mêmes deals
 * et le ruban de KPI doit rester cohérent quel que soit l'onglet affiché.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Fenêtre au-delà de laquelle un paiement orphelin n'est plus proposé au rattachement. */
const ORPHAN_LOOKBACK_DAYS = 90;

export interface DealRow {
  id: string;
  buyerName: string;
  buyerSubtitle: string | null;
  /** Variante vue coach : distingue élève plateforme et client externe. */
  buyerSubtitleCoach: string | null;
  buyerKind: 'student' | 'external' | null;
  /** Photo Instagram du lead, ou avatar de l'élève côté coach. */
  avatarUrl: string | null;
  amountTotal: number;
  collected: number;
  status: string;
  paymentPlan: string;
  installmentsCount: number | null;
  installmentInterval: string | null;
  signedAt: string;
  shortUrl: string | null;
  igLeadId: string | null;
  callId: string | null;
  clientId: string | null;
  stripeSubscriptionId: string | null;
  /** Progression : versements encaissés sur le total prévu. */
  paidCount: number;
  expectedCount: number;
  hasFailure: boolean;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const requested = new URL(request.url).searchParams.get('profileId');
  const profileId = await resolveTargetProfile(user.id, requested);
  if (!profileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  // Sans Stripe, créer un lien est impossible : l'écran doit le dire d'emblée
  // plutôt que de laisser remplir un formulaire qui échouera à la validation.
  const { data: stripeIntegration } = await supa
    .from('integrations')
    .select('access_token, api_key')
    .eq('profile_id', profileId)
    .eq('provider', 'stripe')
    .maybeSingle();
  const stripeConnected = !!(stripeIntegration?.access_token || stripeIntegration?.api_key);

  // ── Deals + leurs paiements ────────────────────────────────────────────────
  const { data: deals, error: dealsErr } = await supa
    .from('deals')
    .select(`
      id, buyer_name, buyer_email, buyer_kind, amount_total, currency, status,
      payment_plan, installments_count, installment_interval, signed_at,
      short_url, ig_lead_id, call_id, client_id, prospect_id,
      stripe_subscription_id, stripe_customer_id, stripe_payment_link_id,
      first_touch_content_id, attribution_source,
      deal_payments ( id, amount, status, paid_at, stripe_payment_id, failure_reason ),
      deal_installments ( id, rank, amount, due_on, status, short_url, sent_at )
    `)
    .eq('profile_id', profileId)
    .order('signed_at', { ascending: false });

  if (dealsErr) return NextResponse.json({ error: dealsErr.message }, { status: 500 });

  // Pseudo et photo Instagram : une seule requête pour tous les leads plutôt
  // qu'une jointure — les leads archivés doivent rester lisibles.
  const leadIds = (deals ?? []).map(d => d.ig_lead_id).filter(Boolean) as string[];
  const leadNames = new Map<string, string>();
  const leadAvatars = new Map<string, string>();
  if (leadIds.length) {
    const { data: leads } = await supa
      .from('instagram_leads')
      .select('id, ig_username, avatar_url')
      .in('id', leadIds);
    for (const l of leads ?? []) {
      if (l.ig_username) leadNames.set(l.id, l.ig_username);
      if (l.avatar_url) leadAvatars.set(l.id, l.avatar_url);
    }
  }

  // Côté coach, l'acheteur peut être un élève de la plateforme : sa photo de
  // profil vaut mieux que des initiales.
  const clientIds = (deals ?? []).map(d => d.client_id).filter(Boolean) as string[];
  const clientAvatars = new Map<string, string>();
  if (clientIds.length) {
    const { data: rows } = await supa
      .from('clients')
      .select('id, profile_id, profiles(avatar_url)')
      .in('id', clientIds);
    for (const c of (rows ?? []) as any[]) {
      const url = c.profiles?.avatar_url;
      if (url) clientAvatars.set(c.id, url);
    }
  }

  const rows: DealRow[] = (deals ?? []).map((d: any) => {
    const payments = d.deal_payments ?? [];
    const succeeded = payments.filter((p: any) => p.status === 'succeeded');
    const collected = succeeded.reduce((s: number, p: any) => s + Number(p.amount), 0);

    const username = d.ig_lead_id ? leadNames.get(d.ig_lead_id) : null;
    // « élève plateforme » / « hors plateforme » ne parlent qu'au coach, qui
    // distingue ses élèves Momentum de ses clients externes. Côté élève, TOUS
    // ses clients sont externes par construction : le libellé n'apportait rien
    // et laissait croire que la vente s'était faite hors de Momentum. On décrit
    // alors l'origine du deal, seule information utile là.
    //
    // La route ignore qui regarde (le même composant est monté des deux côtés
    // avec une prop) : elle renvoie les deux libellés, le composant choisit.
    const subtitle = username
      ? `@${username}`
      : d.call_id ? 'call de vente'
      : d.attribution_source === 'client_existant' ? 'client existant'
      : d.attribution_source === 'cold_dm' ? 'cold DM'
      : 'saisi à la main';

    // « hors plateforme » se lisait « paie hors de Momentum », donc hors Stripe
    // — le sens exactement inverse de celui voulu, et déjà occupé par
    // l'encaissement par virement. On nomme ce qu'est la personne, pas ce
    // qu'elle n'est pas : un client du coach qui n'a pas de compte élève.
    const subtitleCoach = username
      ? `@${username}`
      : d.buyer_kind === 'student' ? 'élève Momentum'
      : d.buyer_kind === 'external' ? 'client direct'
      : subtitle;

    return {
      id: d.id,
      buyerName: d.buyer_name,
      buyerSubtitle: subtitle,
      buyerSubtitleCoach: subtitleCoach,
      buyerKind: d.buyer_kind,
      avatarUrl: (d.ig_lead_id ? leadAvatars.get(d.ig_lead_id) : null)
        ?? (d.client_id ? clientAvatars.get(d.client_id) : null)
        ?? null,
      amountTotal: Number(d.amount_total),
      collected,
      status: d.status,
      paymentPlan: d.payment_plan,
      installmentsCount: d.installments_count,
      installmentInterval: d.installment_interval,
      signedAt: d.signed_at,
      shortUrl: d.short_url,
      igLeadId: d.ig_lead_id,
      callId: d.call_id,
      clientId: d.client_id,
      stripeSubscriptionId: d.stripe_subscription_id,
      paidCount: succeeded.length,
      expectedCount: d.installments_count ?? 1,
      hasFailure: payments.some((p: any) => p.status === 'failed'),
    };
  });

  // ── KPI du ruban ───────────────────────────────────────────────────────────
  // Contracté = tout ce qui a été signé. Collecté = ce qui est réellement encaissé.
  // Impayés = ce qu'un échec de prélèvement a laissé en suspens, pas le reste dû :
  // une échéance à venir n'est pas un impayé.
  const contracted = rows.reduce((s, r) => s + r.amountTotal, 0);
  const collected = rows.reduce((s, r) => s + r.collected, 0);
  const unpaid = rows
    .filter(r => r.hasFailure)
    .reduce((s, r) => s + (r.amountTotal - r.collected), 0);

  const kpis = {
    contracted,
    collected,
    remaining: contracted - collected - unpaid,
    unpaid,
    dealsCount: rows.length,
    collectedRate: contracted > 0 ? Math.round((collected / contracted) * 100) : 0,
    failedCount: rows.filter(r => r.hasFailure).length,
  };

  // ── Onglet « À rattacher » ─────────────────────────────────────────────────
  // Un paiement Stripe qu'aucun deal ne revendique : virement encaissé à la main,
  // lien créé dans le dashboard, deal antérieur à la fonctionnalité.
  const since = new Date(Date.now() - ORPHAN_LOOKBACK_DAYS * 86400_000).toISOString();

  const { data: allPayments } = await supa
    .from('stripe_payments')
    .select('payment_id, amount, currency, date, description, status')
    .eq('profile_id', profileId)
    .gte('date', since)
    .is('dismissed_at', null)   // écartés par l'élève : ne remontent plus
    .order('date', { ascending: false });

  const { data: attachedPayments } = await supa
    .from('deal_payments')
    .select('stripe_payment_id, deals!inner(profile_id)')
    .eq('deals.profile_id', profileId);

  const attachedIds = new Set((attachedPayments ?? []).map((p: any) => p.stripe_payment_id));

  // Une même transaction d'abonnement arrive DEUX fois dans stripe_payments :
  // sous son id d'invoice (`in_…`) et sous celui de son PaymentIntent (`pi_…`),
  // au même montant et à la même seconde. Constaté en test le 20/08/2026 sur
  // TestBIO. Ne comparer que les identifiants faisait donc remonter la moitié
  // non retenue comme un faux orphelin — et la rattacher aurait dupliqué
  // 1 000 € dans le cash collecté.
  //
  // On écarte donc aussi tout paiement dont le montant ET l'instant coïncident
  // avec un paiement déjà rattaché. Deux vrais paiements distincts du même
  // montant à la même seconde n'existent pas en pratique ; et dans ce cas
  // improbable, mieux vaut un orphelin manquant qu'un doublon de cash.
  const { data: attachedDetail } = await supa
    .from('deal_payments')
    .select('amount, paid_at, deals!inner(profile_id)')
    .eq('deals.profile_id', profileId)
    .eq('status', 'succeeded');

  const attachedFingerprints = new Set(
    (attachedDetail ?? [])
      .filter((p: any) => p.paid_at)
      .map((p: any) => `${Number(p.amount)}@${new Date(p.paid_at).toISOString().slice(0, 19)}`)
  );

  const orphans = (allPayments ?? []).filter(p => {
    if (p.status !== 'succeeded') return false;
    if (attachedIds.has(p.payment_id)) return false;
    if (!p.date) return true;
    const fp = `${Number(p.amount)}@${new Date(p.date).toISOString().slice(0, 19)}`;
    return !attachedFingerprints.has(fp);
  });

  return NextResponse.json({
    profileId,
    stripeConnected,
    kpis,
    deals: rows,
    orphans: orphans.map(o => ({
      paymentId: o.payment_id,
      amount: Number(o.amount),
      currency: o.currency,
      date: o.date,
      description: o.description,
    })),
    // Détail par deal, pour le panneau latéral et l'échéancier déplié.
    details: Object.fromEntries((deals ?? []).map((d: any) => [d.id, {
      payments: (d.deal_payments ?? [])
        .sort((a: any, b: any) => (a.paid_at ?? '').localeCompare(b.paid_at ?? '')),
      installments: (d.deal_installments ?? []).sort((a: any, b: any) => a.rank - b.rank),
    }])),
  });
}
