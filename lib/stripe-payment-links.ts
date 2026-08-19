import Stripe from 'stripe';
import { getStripeAccess, type StripeAccess } from '@/lib/stripe-account';
import { shortenUrl } from '@/lib/shortio-create';

/**
 * Création des liens de paiement Stripe, et bornage des plans en N fois.
 *
 * ── Pourquoi un schedule et pas juste un Payment Link ──────────────────────
 * subscription_data d'un Payment Link n'accepte QUE description, invoice_settings,
 * metadata et trial_*. Il n'existe aucun paramètre pour limiter le nombre de
 * prélèvements : un « 3× mensuel » créé naïvement prélèverait le client À VIE.
 *
 * La méthode officielle (docs.stripe.com/billing/subscriptions/subscription-schedules,
 * section « Installment plans ») est un subscription schedule :
 *     phases[0].iterations = 3   → exactement 3 prélèvements
 *     end_behavior = 'cancel'    → Stripe annule après le dernier
 * C'est Stripe qui borne, pas nous — aucun compteur applicatif à maintenir.
 *
 * Mais un schedule ne naît pas d'un Payment Link : il faut une subscription
 * existante. D'où le montage en deux temps :
 *   1. le prospect paie via un Payment Link normal (il voit « payer 1 000 € ») ;
 *   2. le webhook attache le schedule à la subscription qui vient de naître.
 *
 * ensureInstallmentSchedule() ci-dessous est appelée à checkout.session.completed
 * ET à chaque invoice.paid : tant que le bornage n'est pas en place, chaque
 * événement retente. Voir le commentaire de la fonction pour les garde-fous.
 */

const METADATA_KEYS = {
  deal: 'momentum_deal_id',
  profile: 'momentum_profile_id',
  lead: 'momentum_lead_id',
  installment: 'momentum_installment_id',
} as const;

export interface DealLinkInput {
  profileId: string;
  dealId: string;
  amount: number;                 // en euros
  currency?: string;
  productName: string;            // ce que le prospect voit sur la page Stripe
  leadId?: string | null;
  customerEmail?: string | null;
  /** Mode automatique : Stripe prélève N fois puis s'arrête. */
  installments?: { count: number; interval: 'month' | 'week' } | null;
  /** Mode manuel : ce lien ne couvre qu'une échéance. */
  installmentId?: string | null;
  /** Contenu à l'origine du lead — pose utm_content pour les stats de clics. */
  contentId?: string | null;
  /** Pseudo du prospect — pose utm_term. */
  prospectHandle?: string | null;
}

export interface CreatedLink {
  paymentLinkId: string;
  /** URL à envoyer au prospect : Short.io si disponible, sinon Stripe directement. */
  url: string;
  /** URL Stripe brute, toujours présente — sert de repli et de référence. */
  stripeUrl: string;
  shortioId: string | null;
}

/** Stripe raisonne en centimes. Arrondi explicite : 0.1 + 0.2 ne fait pas 0.3. */
const toMinor = (amount: number) => Math.round(amount * 100);

/**
 * Crée un Payment Link pour un deal (ou une échéance en mode manuel).
 *
 * Les metadata voyagent Payment Link → Checkout Session → PaymentIntent → Charge,
 * ce qui rend le rattachement déterministe quel que soit le parcours du payeur :
 * abandon puis retour par l'historique, partage du lien, changement d'appareil.
 */
export async function createDealPaymentLink(
  input: DealLinkInput,
  access?: StripeAccess,
): Promise<CreatedLink> {
  const acc = access ?? await getStripeAccess(input.profileId);
  if (!acc) throw new Error('Stripe non connecté');

  const { stripe, opts } = acc;
  const currency = (input.currency || 'eur').toLowerCase();
  const recurring = input.installments
    ? { interval: input.installments.interval }
    : undefined;

  const metadata: Record<string, string> = {
    [METADATA_KEYS.deal]: input.dealId,
    [METADATA_KEYS.profile]: input.profileId,
  };
  if (input.leadId) metadata[METADATA_KEYS.lead] = input.leadId;
  if (input.installmentId) metadata[METADATA_KEYS.installment] = input.installmentId;

  const link = await stripe.paymentLinks.create({
    line_items: [{
      quantity: 1,
      price_data: {
        currency,
        unit_amount: toMinor(input.amount),
        product_data: { name: input.productName },
        ...(recurring ? { recurring } : {}),
      },
    }],
    metadata,
    // Sans 'always', Stripe ne crée un Customer que s'il en a besoin — or on en a
    // besoin pour rattacher les paiements suivants et pour l'écran de réconciliation.
    customer_creation: input.installments ? undefined : 'always',
    // Les metadata d'un Payment Link s'arrêtent à la Checkout Session : le
    // PaymentIntent et la Charge arrivent vides (constaté en réel le 19/08/2026).
    // On les repose ici pour qu'elles descendent jusqu'à la Charge — le webhook
    // n'en dépend pas (il lit la session), mais elles rendent le paiement
    // identifiable depuis le dashboard Stripe et depuis un export comptable.
    ...(input.installments ? {} : { payment_intent_data: { metadata } }),
    ...(input.installments ? {
      // Ces metadata-là sont indispensables : sans elles, les échéances 2 et 3
      // arrivent sans identifiant et tombent en paiements orphelins.
      subscription_data: { metadata },
    } : {}),
  }, opts);

  // ── Couche Short.io : le tracking du clic ─────────────────────────────────
  // Elle ne participe PAS au rattachement du paiement — ce sont les metadata
  // ci-dessus qui le portent, et elles vivent sur l'objet Stripe. Le lien court
  // sert à savoir si le prospect a OUVERT le lien sans payer, ce qui distingue
  // « jamais ouvert » (renvoyer le lien suffit) de « ouvert, pas payé »
  // (objection : un message personnel vaut mieux qu'un rappel).
  //
  // Échec silencieux assumé : sans Short.io connecté, on renvoie l'URL Stripe.
  // On perd le tracking du clic, jamais la capacité d'encaisser.
  const short = await shortenUrl(input.profileId, link.url, {
    title: input.productName,
    utms: {
      source: 'ig',
      medium: 'payment',
      campaign: `deal-${input.dealId.slice(0, 8)}`,
      // utm_content n'accepte qu'un vrai ID de contenu (contrat de lib/contentId.ts) :
      // y mettre un pseudo casserait « Performance par contenu ».
      ...(input.contentId ? { content: input.contentId } : {}),
      ...(input.prospectHandle ? { term: input.prospectHandle } : {}),
    },
  });

  return {
    paymentLinkId: link.id,
    url: short?.shortUrl ?? link.url,
    stripeUrl: link.url,
    shortioId: short?.id ?? null,
  };
}

/**
 * Borne une subscription à N prélèvements. Idempotent et sûr à rappeler.
 *
 * Quatre garde-fous superposés, parce qu'une subscription non bornée prélèverait
 * le client indéfiniment — c'est le seul endroit du chantier où un bug coûterait
 * de l'argent réel à quelqu'un :
 *
 *   1. Appelée au webhook checkout.session.completed (chemin nominal).
 *   2. Rappelée à CHAQUE invoice.paid : si le schedule manque encore, on l'attache.
 *      Stripe rejoue les webhooks en échec pendant 3 jours, et la 2e échéance
 *      n'arrive qu'à J+30 — la fenêtre de rattrapage est large.
 *   3. Si un schedule existe déjà, on ne fait rien (pas de doublon, pas d'erreur).
 *   4. Dernier recours dans le webhook : si le nombre de paiements encaissés
 *      atteint installments_count, on annule la subscription même sans schedule.
 */
export async function ensureInstallmentSchedule(
  access: StripeAccess,
  subscriptionId: string,
  installmentsCount: number,
  interval: 'month' | 'week',
): Promise<{ scheduled: boolean; reason: string }> {
  const { stripe, opts } = access;

  const sub = await stripe.subscriptions.retrieve(subscriptionId, undefined, opts);

  // Garde-fou 3 : déjà borné, rien à faire.
  if (sub.schedule) return { scheduled: true, reason: 'already_scheduled' };
  if (sub.status === 'canceled') return { scheduled: false, reason: 'canceled' };

  // from_subscription reprend la config existante (prix, intervalle, ancre de
  // facturation) : le schedule démarre exactement où la subscription en est.
  const schedule = await stripe.subscriptionSchedules.create(
    { from_subscription: subscriptionId },
    opts,
  );

  const phase = schedule.phases[0];
  if (!phase) return { scheduled: false, reason: 'no_phase' };

  // ⚠️ Durée de la phase — à revérifier en test réel avant la prod (test 3 du plan).
  //
  // La doc « Installment plans » de Stripe exprime ça en `iterations` (iterations=6
  // → « 6 monthly payments, total 6,000 USD »), mais le SDK installé (22.1.1)
  // n'expose pas ce champ : il expose `duration` { interval, interval_count }, qui
  // dit la même chose autrement — 3 prélèvements mensuels = 3 mois de phase.
  //
  // from_subscription fait démarrer la phase sur la période EN COURS, celle déjà
  // payée au checkout. interval_count = installments_count couvre donc bien les 3
  // paiements (celui déjà encaissé + les 2 suivants). Si le test montre un
  // prélèvement de trop, c'est cette ligne à corriger.
  //
  // On repasse aussi les items de la phase courante : l'API exige de renvoyer
  // toutes les phases présentes et futures à chaque update.
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'cancel',
    phases: [{
      items: phase.items.map(i => ({
        price: typeof i.price === 'string' ? i.price : i.price.id,
        quantity: i.quantity ?? 1,
      })),
      start_date: phase.start_date,
      duration: { interval, interval_count: installmentsCount },
      metadata: (phase.metadata ?? undefined) as Stripe.MetadataParam | undefined,
    }],
  }, opts);

  return { scheduled: true, reason: 'created' };
}

export { METADATA_KEYS };
