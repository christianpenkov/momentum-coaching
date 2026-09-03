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
  /** Un échéancier existe en base — distingue un hors Stripe choisi d'un vide. */
  hasSchedule: boolean;

  endedBy: 'stripe' | 'user' | null;
  endedAt: string | null;
  endedReason: string | null;
  stopsAt: string | null;
  disputeDueBy: string | null;
  unexpectedPaymentAt: string | null;
  refunded: number;
  disputed: number;
  /** Versé au-delà du montant de la vente — à rendre au client. Voir aRembourser(). */
  aRendre: number;
  /** Argent attendu à ce jour et non rentré — échéance dépassée ou prélèvement refusé. */
  overdue: number;
  /**
   * La part des remboursements qui n'a pas encore reçu d'explication.
   *
   * ⚠️ Ce n'est PAS `refunded` : un remboursement de trop-perçu ramène l'encaissé
   * au montant de la vente sans créer le moindre écart, et n'appelle donc aucune
   * question — alors qu'il porte bien une ligne remboursée. C'est l'écart, et lui
   * seul, qu'il faut expliquer.
   */
  refundInexplique: number;
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
  /** Quand la ligne a été enregistrée — sert de date de repli à un remboursement,
   *  qui n'a pas de `paid_at`. */
  created_at?: string | null;
  stripe_payment_id: string;
  failure_reason: string | null;
  /**
   * Pourquoi ce remboursement a eu lieu. Sur une ligne `refunded` uniquement.
   *
   * ⚠️ `null` = la question n'a PAS encore été posée, jamais « aucune raison ».
   * C'est cet état qui fait apparaître le bandeau sur la fiche : sans raison, on
   * ne sait pas si l'argent est encore dû, et la vente ne peut pas s'expliquer.
   */
  refund_reason?: RaisonRemboursement | null;
  refund_reason_note?: string | null;
}

/**
 * Les quatre réponses possibles à « pourquoi cet argent est-il reparti ? ».
 *
 * Une seule laisse l'argent DÛ (`erreur`) ; `autre` fait poser la question
 * explicitement. Les deux premières valent une remise : le montant de la vente
 * baisse d'autant, et elle redevient soldée à 100 %.
 */
export type RaisonRemboursement = 'geste_commercial' | 'retractation' | 'erreur' | 'autre';

export const LIBELLE_RAISON: Record<RaisonRemboursement, string> = {
  geste_commercial: 'geste commercial',
  retractation: 'rétractation partielle',
  erreur: 'remboursement parti par erreur',
  autre: 'autre raison',
};

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

/**
 * Pourquoi un encaissement n'appartient à aucune vente.
 *
 * Écrit par le filet (`sync-stripe-payments`) et par le webhook, au moment précis
 * où ils tranchent — c'est le seul endroit qui le sache. Rien en aval ne peut le
 * reconstituer : `stripe_payments` ne garde aucune metadata Stripe.
 */
export type CauseOrphelin = 'metadata_absente' | 'deal_supprime' | 'abonnement_inconnu';

export interface Orphan {
  paymentId: string;
  amount: number;
  currency: string;
  date: string;
  description: string | null;
  /**
   * ⚠️ `null` ne veut PAS dire « aucune cause » : il veut dire « on ne sait pas ».
   * Les encaissements antérieurs à la colonne, et ceux trop anciens pour que
   * Stripe les serve encore, n'en porteront jamais. L'écran doit distinguer les
   * deux, sinon il affirme une absence de problème là où il y a une ignorance.
   */
  cause: CauseOrphelin | null;
  /**
   * Les autres identifiants Stripe du MÊME encaissement.
   *
   * Une transaction d'abonnement existe sous deux identifiants (`in_…` facture
   * et `pi_…` PaymentIntent). Ils sont regroupés en une seule ligne côté route :
   * deux cartes auraient permis de rattacher deux fois le même argent.
   */
  autresIdentifiants: string[];
  /**
   * L'abonnement d'où vient ce prélèvement, si le filet a su le nommer.
   *
   * ⚠️ C'est CE champ, et non `cause`, qui commande l'offre de relier
   * l'abonnement à une vente. Le filet le pose dès qu'un abonnement a été vu sans
   * permettre le rattachement, quelle que soit la cause finalement retenue — les
   * seules lignes qui en portent un sont en `deal_supprime`, pas en
   * `abonnement_inconnu`. Conditionner sur la cause n'afficherait jamais rien.
   */
  subscriptionId: string | null;
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
