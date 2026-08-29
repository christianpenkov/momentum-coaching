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
  /** Le deal a-t-il au moins un lien de paiement Stripe ? Faux = hors Stripe. */
  hasLinks: boolean;

  endedBy: 'stripe' | 'user' | null;
  endedAt: string | null;
  endedReason: string | null;
  stopsAt: string | null;
  disputeDueBy: string | null;
  unexpectedPaymentAt: string | null;
  refunded: number;
  disputed: number;
  /** Argent attendu à ce jour et non rentré — échéance dépassée ou prélèvement refusé. */
  overdue: number;
}

/** Un client et toutes ses ventes — l'unité de la liste et de la fiche. */
export interface PersonRow {
  key: string;
  name: string;
  subtitle: string | null;
  subtitleCoach: string | null;
  avatarUrl: string | null;
  dealIds: string[];
  contracted: number;
  collected: number;
  status: string;
  since: string;
}

export interface DealEvent {
  id: string;
  deal_id: string;
  kind: string;
  label: string;
  created_at: string;
  meta: Record<string, unknown> | null;
}

export interface DealPayment {
  id: string;
  /** L'échéance que ce paiement solde — nul en comptant et en prélèvement auto. */
  installment_id: string | null;
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
  /** Clics humains sur le lien de cette échéance, sur toute sa durée de vie. */
  clicks?: number;
  /** Jour de la première ouverture (AAAA-MM-JJ), ou null si jamais ouvert. */
  firstClickAt?: string | null;
  /** Le lien passe-t-il par Short.io ? Faux = aucune ouverture n'est mesurable. */
  tracked?: boolean;
}

export interface DealDetail {
  payments: DealPayment[];
  installments: DealInstallment[];
  /** Clics sur le lien porté par la vente elle-même (comptant). */
  clicks?: number;
  firstClickAt?: string | null;
  tracked?: boolean;
  events?: DealEvent[];
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
  people: PersonRow[];
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

/**
 * Montant au centime près — réservé aux écrans qui touchent à l'argent.
 *
 * Ailleurs l'arrondi est le bon choix : les centimes sont du bruit. Mais sur un
 * écran qui annonce « 200,00 € à rembourser », l'arrondi ferait taper dans
 * Stripe un chiffre différent de celui reçu, et laisserait un écart de quelques
 * centimes qui empêcherait la vente de se solder.
 */
export function fmtEurExact(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
  }).format(n);
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
