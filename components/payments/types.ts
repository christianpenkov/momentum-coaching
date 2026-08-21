/** Types partagés de la page Paiements — miroir de ce que renvoie /api/payments. */

export interface DealRow {
  id: string;
  buyerName: string;
  buyerSubtitle: string | null;
  /** Variante vue coach — voir app/api/payments/route.ts. */
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
  paidCount: number;
  expectedCount: number;
  hasFailure: boolean;
}

export interface DealPayment {
  id: string;
  amount: number | string;
  status: string;
  paid_at: string | null;
  stripe_payment_id: string;
  failure_reason: string | null;
}

export interface DealInstallment {
  id: string;
  rank: number;
  amount: number | string;
  due_on: string;
  status: string;
  short_url: string | null;
  sent_at: string | null;
}

export interface DealDetail {
  payments: DealPayment[];
  installments: DealInstallment[];
}

export interface Orphan {
  paymentId: string;
  amount: number;
  currency: string;
  date: string;
  description: string | null;
}

export interface PaymentsData {
  profileId: string;
  /** Sans Stripe, aucun lien de paiement ne peut être créé. */
  stripeConnected: boolean;
  kpis: {
    contracted: number;
    collected: number;
    remaining: number;
    unpaid: number;
    dealsCount: number;
    collectedRate: number;
    failedCount: number;
  };
  deals: DealRow[];
  orphans: Orphan[];
  details: Record<string, DealDetail>;
}

export interface Candidate {
  dealId: string;
  buyerName: string;
  amountTotal: number;
  signedAt: string;
  confidence: 'certain' | 'possible';
  reason: string;
}

/** Montants sans décimales : en high-ticket, les centimes sont du bruit. */
export function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
}

export function fmtDateLong(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/** « il y a 3 jours » — plus parlant qu'une date pour juger d'une relance. */
export function fmtRelative(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return `il y a ${days} jours`;
}
