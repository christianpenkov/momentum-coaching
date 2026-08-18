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
  buyerKind: 'student' | 'external' | null;
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

  // Pseudo Instagram pour le sous-titre : une seule requête pour tous les leads
  // plutôt qu'une jointure — les leads archivés doivent rester lisibles.
  const leadIds = (deals ?? []).map(d => d.ig_lead_id).filter(Boolean) as string[];
  const leadNames = new Map<string, string>();
  if (leadIds.length) {
    const { data: leads } = await supa
      .from('instagram_leads')
      .select('id, ig_username')
      .in('id', leadIds);
    for (const l of leads ?? []) if (l.ig_username) leadNames.set(l.id, l.ig_username);
  }

  const rows: DealRow[] = (deals ?? []).map((d: any) => {
    const payments = d.deal_payments ?? [];
    const succeeded = payments.filter((p: any) => p.status === 'succeeded');
    const collected = succeeded.reduce((s: number, p: any) => s + Number(p.amount), 0);

    const username = d.ig_lead_id ? leadNames.get(d.ig_lead_id) : null;
    const subtitle = username
      ? `@${username}`
      : d.buyer_kind === 'student' ? 'élève plateforme'
      : d.buyer_kind === 'external' ? 'hors plateforme'
      : d.attribution_source === 'manual' ? 'saisi à la main'
      : null;

    return {
      id: d.id,
      buyerName: d.buyer_name,
      buyerSubtitle: subtitle,
      buyerKind: d.buyer_kind,
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
  const orphans = (allPayments ?? [])
    .filter(p => p.status === 'succeeded' && !attachedIds.has(p.payment_id));

  return NextResponse.json({
    profileId,
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
