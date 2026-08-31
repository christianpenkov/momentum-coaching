import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { getStripeAccess } from '@/lib/stripe-account';
import { ensureInstallmentSchedule, desactiverLiensDuDeal, METADATA_KEYS } from '@/lib/stripe-payment-links';
import { sendPushToProfile } from '@/lib/googleCalendarService';
import { calculerCash, statutDeal } from '@/lib/dealCash';

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

/**
 * Pourquoi un encaissement n'est rattaché à aucune vente. `null` = il l'est.
 * Valeurs tenues par la contrainte CHECK de `stripe_payments.orphan_cause`.
 *
 * L'écran de rattachement ne pouvait que deviner : depuis `stripe_payments`,
 * « aucune metadata » et « le deal a été supprimé » sont indistinguables, alors
 * qu'ils n'appellent pas la même action. Deviner une cause est pire qu'un en-tête
 * générique — ça oriente vers la mauvaise action avec l'assurance d'un fait.
 */
type OrphanCause = 'metadata_absente' | 'deal_supprime' | 'abonnement_inconnu' | null;

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
 * Le deal désigné par des metadata Stripe existe-t-il encore chez nous ?
 *
 * ⚠️ Les metadata d'une facture sont un INSTANTANÉ figé à sa finalisation : elles
 * gardent l'identifiant du deal pour toujours, même si la vente a été supprimée
 * depuis. Insérer sans vérifier lève une violation de clé étrangère, donc un 500 —
 * et Stripe REJOUE un webhook en échec, pendant des jours. La boucle ne s'arrête
 * jamais d'elle-même : chaque tentative échoue au même endroit.
 *
 * Constaté le 2026-08-31 sur le chemin jumeau (`sync-stripe-payments`), où deux
 * factures pointant vers des deals disparus figeaient le rattrapage à chaque passage.
 * Le webhook a exactement la même faiblesse, avec une conséquence pire : Stripe insiste.
 *
 * Un deal introuvable n'est pas une erreur de traitement — c'est un paiement ORPHELIN,
 * comme un paiement sans metadata. Il garde sa trace dans `stripe_payments` et remonte
 * dans « À rattacher ».
 */
async function dealExiste(supabase: Supa, dealId: string): Promise<boolean> {
  // Une metadata se saisit à la main dans le dashboard Stripe : elle peut ne pas être
  // un UUID du tout, et Postgres répondrait 22P02 au lieu de « rien trouvé ».
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId)) return false;
  const { data } = await supabase.from('deals').select('id').eq('id', dealId).maybeSingle();
  return !!data;
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
  /** Lu sur charge.billing_details.email / invoice.customer_email / session. */
  buyerEmail?: string | null;
}) {
  const dealId = params.metadata?.[METADATA_KEYS.deal] ?? null;
  const installmentId = params.metadata?.[METADATA_KEYS.installment] ?? null;

  let resolvedDealId = dealId;
  let matchMethod: 'metadata' | 'subscription' = 'metadata';

  let cause: OrphanCause = null;

  // La vente a pu disparaître depuis que Stripe a figé ces metadata — voir
  // dealExiste(). On retombe alors sur la résolution par abonnement, puis sur
  // « orphelin », au lieu de lever un 500 que Stripe rejouerait sans fin.
  if (resolvedDealId && !(await dealExiste(supabase, resolvedDealId))) {
    resolvedDealId = null;
    cause = 'deal_supprime';
  }

  if (!resolvedDealId && params.subscriptionId) {
    const { data } = await supabase
      .from('deals')
      .select('id')
      .eq('stripe_subscription_id', params.subscriptionId)
      .maybeSingle();
    if (data) { resolvedDealId = data.id; matchMethod = 'subscription'; cause = null; }
    // `deal_supprime` l'emporte s'il a déjà été posé : plus précis et plus
    // actionnable qu'« abonnement inconnu », qui n'en serait que la conséquence.
    else if (!cause) cause = 'abonnement_inconnu';
  }

  // Ni metadata exploitable, ni abonnement : l'objet Stripe ne portait rien qui
  // nous désigne.
  if (!resolvedDealId && !cause) cause = 'metadata_absente';

  // Toujours conserver la trace brute : c'est elle qui alimente « À rattacher »
  // quand aucun deal n'a pu être résolu.
  const { error: payErr } = await supabase.from('stripe_payments').upsert({
    profile_id: params.profileId,
    payment_id: params.stripePaymentId,
    amount: params.amountMinor / 100,
    currency: params.currency,
    date: params.paidAt,
    status: params.status,
    // ⚠️ SANS CET E-MAIL, L'ÉCRAN DE RATTACHEMENT NE SERT À RIEN.
    // Le niveau « Certain » l'exige — c'est le seul signal qui identifie une
    // personne. Sans lui aucun candidat ne dépasse « Possible », et sur une
    // échéance le montant ne correspond pas non plus : l'écran affiche « Aucun
    // deal ne correspond », avec « Ignorer » pour seul bouton.
    //
    // Colonne dédiée, et non `description` : l'extraire d'un texte libre par
    // expression régulière casse en silence au premier changement de libellé côté
    // Stripe. On ne devine pas ce qu'on peut stocker.
    buyer_email: params.buyerEmail ?? null,
    // ⚠️ TOUJOURS écrite, y compris à `null` quand le paiement EST rattaché.
    // C'est ce qui fait la remise à zéro : un événement qui trouve enfin le deal
    // efface la cause de l'orphelinat précédent. Sans ça, elle survivrait au
    // rattachement et s'afficherait comme un fait actuel alors qu'elle est périmée.
    orphan_cause: cause,
    // ⚠️ L'ABONNEMENT NON RÉSOLU, pour que le rattachement soit DURABLE.
    //
    // `abonnement_inconnu` dit pourquoi ce paiement est orphelin ; ceci dit quoi
    // faire. Au rattachement, l'écran peut proposer d'écrire aussi
    // `deals.stripe_subscription_id` — et toutes les échéances suivantes se
    // rattachent seules. Sans ça, un abonnement non relié ramène un orphelin
    // chaque mois, et le même geste est à refaire indéfiniment.
    //
    // `null` quand le paiement est rattaché : la vente porte alors elle-même
    // l'abonnement, et deux sources pour un même fait se périmeraient.
    subscription_id: resolvedDealId ? null : params.subscriptionId ?? null,
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
    // ⚠️ `refunded` porte une date, au même titre que `succeeded`.
    //
    // Cette colonne est ce qui BORNE les périodes partout dans l'application
    // (`gte`/`lte` sur paid_at). La laisser à NULL ne rendait pas les
    // remboursements « sans date » : elle les rendait invisibles de TOUTES les
    // fenêtres, sur tous les écrans, définitivement — donc jamais déduits nulle
    // part, alors que calculerCash() les soustrait. Constaté le 2026-08-30 :
    // 1 000 € encaissés et 200 € remboursés s'affichaient 1 000 €.
    //
    // La date posée est celle de la charge D'ORIGINE (`charge.created`, voir le
    // case `charge.refunded`), pas celle du remboursement : le remboursement se
    // soustrait au mois où l'argent était entré, donc ce mois-là finit par dire
    // ce qu'il a vraiment rapporté. Décision de Chris, 2026-08-30.
    //
    // `failed` et `pending` restent à NULL : aucun argent n'a bougé, ils n'ont
    // pas de date d'encaissement à porter.
    paid_at: params.status === 'succeeded' || params.status === 'refunded' ? params.paidAt : null,
    status: params.status,
    failure_reason: params.failureReason ?? null,
    match_method: matchMethod,
  });
  if (dpErr) throw dpErr;

  if (installmentId && params.status === 'succeeded') {
    await supabase.from('deal_installments').update({ status: 'paid' }).eq('id', installmentId);
  }

  await refreshDealStatus(supabase, resolvedDealId, {
    argentEntrant: params.status === 'succeeded',
  });
  return { attached: true, dealId: resolvedDealId };
}

/**
 * Retrouve la vente concernée par un événement qui porte sur une charge.
 *
 * ── Pourquoi ce n'est pas immédiat ─────────────────────────────────────────
 * Un litige est ouvert par la banque du client, pas par Momentum : il n'arrive
 * avec aucune de nos metadata. Et il désigne une CHARGE (`ch_…`), alors qu'un
 * paiement comptant est enregistré chez nous sous l'identifiant de son
 * PaymentIntent (`pi_…`). Chercher `ch_…` dans nos lignes ne trouve donc rien.
 *
 * Trois pistes, de la plus sûre à la moins :
 *   1. les metadata de l'événement, quand il en porte ;
 *   2. la charge elle-même, relue chez Stripe — le paiement comptant y pose ses
 *      metadata (payment_intent_data), et elle donne le `pi_…` correspondant ;
 *   3. une ligne déjà enregistrée sous cet identifiant, cas d'un remboursement
 *      antérieur qui aurait créé la ligne `ch_…`.
 *
 * Renvoie `dealId: null` plutôt que de deviner : rattacher un litige au mauvais
 * deal retirerait de l'argent de la mauvaise vente.
 *
 * Renvoie AUSSI `paidAt`, la date du paiement contesté quand la ligne a pu être
 * retrouvée. Une ligne de litige doit porter la date de l'argent qu'elle retire,
 * pas celle du litige : sans elle, elle serait invisible de toutes les fenêtres
 * de période, donc jamais déduite (voir le commentaire de `paid_at` dans
 * recordPayment). La recherche de ligne est désormais faite même quand les
 * metadata ont déjà donné le deal — c'est une lecture indexée, sur un chemin
 * rare, et c'est le seul endroit qui connaît la date d'origine.
 */
async function dealDuPaiement(
  supabase: Supa,
  profileId: string,
  chargeId: string,
  metadata: Stripe.Metadata | null | undefined,
): Promise<{ dealId: string | null; paidAt: string | null }> {
  const viaMeta = metadata?.[METADATA_KEYS.deal] ?? null;

  const identifiants = [chargeId];
  let viaCharge: string | null = null;

  const access = await getStripeAccess(profileId);
  if (access) {
    try {
      const charge = await access.stripe.charges.retrieve(chargeId, undefined, access.opts);
      viaCharge = charge.metadata?.[METADATA_KEYS.deal] ?? null;

      const pi = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
      if (pi) identifiants.push(pi);
    } catch (err) {
      // Stripe injoignable : on tente quand même par les identifiants connus.
      console.error(`[stripe] lecture de la charge ${chargeId} impossible`, err);
    }
  }

  const { data } = await supabase
    .from('deal_payments')
    .select('deal_id, paid_at, deals!inner(profile_id)')
    .eq('deals.profile_id', profileId)
    .in('stripe_payment_id', identifiants)
    .limit(1)
    .maybeSingle();

  const ligne = data as { deal_id?: string; paid_at?: string | null } | null;

  return {
    dealId: viaMeta ?? viaCharge ?? ligne?.deal_id ?? null,
    paidAt: ligne?.paid_at ?? null,
  };
}

/**
 * Écrit une ligne dans le journal d'une vente.
 *
 * Ne lève jamais : le journal raconte ce qui s'est passé, il ne doit pas
 * empêcher que ça se passe. Une écriture ratée coûte une ligne d'historique,
 * pas un paiement.
 */
async function journaliser(
  supabase: Supa,
  dealId: string,
  kind: string,
  label: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('deal_events').insert({ deal_id: dealId, kind, label, meta: meta ?? null });
  } catch (err) {
    console.error(`[stripe] journal impossible (deal ${dealId})`, err);
  }
}

/**
 * Recalcule le statut d'un deal à partir de ses paiements réellement encaissés.
 *
 * La règle vit dans lib/dealCash.ts — elle était recopiée ici, dans
 * app/api/payments/route.ts et dans l'Edge Function sync-stripe-payments, et
 * les trois ignoraient les remboursements.
 *
 * `statutDeal` renvoie `null` quand il ne faut RIEN changer : c'est le cas
 * d'un deal annulé, que ni un paiement retardataire ni un remboursement ne
 * doivent ressusciter.
 */
async function refreshDealStatus(
  supabase: Supa,
  dealId: string,
  opts?: { argentEntrant?: boolean },
) {
  const { data: deal } = await supabase
    .from('deals')
    .select('profile_id, amount_total, status, unexpected_payment_at')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return;

  const { data: payments } = await supabase
    .from('deal_payments')
    .select('amount, status')
    .eq('deal_id', dealId);

  const status = statutDeal(calculerCash(payments), deal.amount_total, deal.status);

  if (status && status !== deal.status) {
    await supabase.from('deals').update({ status }).eq('id', dealId);

    // ── Une vente qui s'annule emporte ses liens ────────────────────────────
    // Ce chemin-ci n'est PAS le parcours guidé : c'est un remboursement intégral
    // fait directement dans le dashboard Stripe, sans passer par Momentum. Le
    // parcours désactive les liens lui-même ; ici personne ne l'aurait fait, et
    // un lien resterait payable sur une vente sortie des chiffres.
    if (status === 'canceled') {
      await desactiverLiensDuDeal(supabase, dealId, deal.profile_id);
      await journaliser(supabase, dealId, 'canceled',
        'Vente annulée — remboursement intégral constaté chez Stripe');
    }
  }

  // ── De l'argent sur une vente terminée ─────────────────────────────────────
  // Une vente clôturée, arrêtée ou annulée n'attend plus rien. Un paiement qui
  // arrive quand même a deux explications opposées — le client a repris ses
  // paiements, ou il s'est trompé — et Momentum ne peut pas trancher.
  //
  // Il pose donc un drapeau et pose la question, sans JAMAIS rouvrir la vente
  // tout seul : rouvrir à tort remettrait la vente dans les relances et
  // réclamerait au client un argent qu'il ne doit pas.
  //
  // Le drapeau seul est posé, le statut n'est pas touché : `statutDeal` renvoie
  // déjà `null` sur ces états, et l'argent reste compté dans l'encaissé — il est
  // bien sur le compte tant qu'il n'a pas été rendu.
  const terminee = deal.status === 'ended' || deal.status === 'canceled';
  if (opts?.argentEntrant && terminee && !deal.unexpected_payment_at) {
    await supabase.from('deals')
      .update({ unexpected_payment_at: new Date().toISOString() })
      .eq('id', dealId);
    await journaliser(supabase, dealId, 'unexpected_payment',
      'Paiement reçu sur une vente terminée');

    // L'écran d'annulation promet « tu seras prévenu à son arrivée » : sans
    // notification, l'argent dormirait sur une vente que personne ne rouvre.
    try {
      const { data: d } = await supabase
        .from('deals').select('buyer_name, profile_id').eq('id', dealId).maybeSingle();
      if (d) {
        await sendPushToProfile(
          d.profile_id,
          `${d.buyer_name} a payé après la fin de la vente`,
          'A-t-il repris ses paiements, ou s’est-il trompé ?',
          `/paiements?deal=${dealId}`,
        );
      }
    } catch { /* la notification est un confort, jamais une condition */ }
  }

  // ⚠️ ON NE TOUCHE PAS À L'APPEL ICI — ni `deal_closed`, ni `outcome`.
  //
  // Un remboursement dit qu'un mouvement d'argent a eu lieu, jamais pourquoi.
  // Erreur de saisie, geste commercial, rétractation du client : trois raisons
  // courantes, deux conclusions opposées sur « cette vente a-t-elle eu lieu ».
  // Momentum voit l'argent, pas l'intention — deviner se tromperait une fois sur
  // trois, et ferait bouger une carte du kanban que personne n'a demandé à
  // déplacer.
  //
  // Le geste qui déclasse une vente existe, et il est explicite : « Annuler la
  // vente », qui annonce à l'écran que l'appel passera en perdu. Deux faits
  // distincts, deux gestes distincts.
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

      // ⚠️ Paiement comptant : c'est ICI qu'on enregistre, pas dans charge.succeeded.
      //
      // Vérifié en conditions réelles le 19/08/2026 : les metadata d'un Payment Link
      // s'arrêtent à la Checkout Session. Le PaymentIntent et la Charge qui en
      // découlent arrivent avec `metadata: {}` — la propagation décrite par la doc
      // vaut pour un PaymentIntent créé directement, pas via un Payment Link.
      // S'en remettre à charge.succeeded laissait donc le paiement orphelin.
      //
      // La session porte les metadata ET le montant : tout ce qu'il faut.
      if (!subscriptionId && session.payment_status === 'paid') {
        const paymentRef = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? session.id;

        await recordPayment(supabase, {
          profileId,
          stripePaymentId: paymentRef,
          amountMinor: session.amount_total ?? 0,
          currency: session.currency ?? 'eur',
          paidAt: new Date(session.created * 1000).toISOString(),
          status: 'succeeded',
          metadata: session.metadata as Record<string, string> | null,
          buyerEmail: session.customer_details?.email ?? session.customer_email ?? null,
        });
      }

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
        buyerEmail: inv.customer_email ?? null,
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
        buyerEmail: inv.customer_email ?? null,
      });
      break;
    }

    // Charge : filet pour les encaissements qui ne passent PAS par un Payment Link
    // Momentum (virement enregistré dans Stripe, lien créé à la main). Les paiements
    // Momentum sont déjà enregistrés par checkout.session.completed ci-dessus.
    //
    // On identifie la charge par son payment_intent, pas par son propre id : c'est
    // la référence utilisée par le handler de session, donc la contrainte d'unicité
    // sur (deal_id, stripe_payment_id) suffit à empêcher le doublon.
    case 'charge.succeeded': {
      const charge = event.data.object as Stripe.Charge;
      if (charge.refunded) break;
      // ⚠️ NE PAS tenter de rattacher cette charge à une facture. Mesuré contre
      // l'API réelle le 2026-08-31, version `2026-04-22.dahlia` :
      //
      //   • `charge.invoice` N'EXISTE PLUS — champ absent de la réponse, y compris
      //     sur une charge d'abonnement. Le SDK ne le type pas : ce n'est pas un
      //     trou de génération, c'est un retrait d'API. `invoice.charge` et
      //     `payment_intent.invoice` ont disparu aussi. Le seul lien restant est
      //     `invoice.payments` sous `expand`, donc au prix d'un appel par facture.
      //
      //   • Et le doublon que ce rattachement viserait NE PEUT PAS se produire :
      //     une charge d'abonnement porte `metadata: {}`, donc recordPayment ne lui
      //     trouve aucun deal et n'écrit rien dans `deal_payments`. Les seules
      //     charges qui portent nos metadata sont des paiements COMPTANT, qui n'ont
      //     pas de facture. `invoice.paid` écrit `in_…`, cette branche `pi_…`, et
      //     les deux ne visent jamais le même argent.
      //
      // Ce qui protège vraiment, si les metadata voyageaient un jour jusqu'à la
      // charge : la vue `ventes_sante_sur_encaissement`, qui alarme dès qu'un deal
      // encaisse plus que son montant — quelle que soit la SOURCE du doublement.
      // Une garde qui dépend d'un champ d'API se périme ; un invariant sur nos
      // propres données, non.
      const paymentRef = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? charge.id;
      await recordPayment(supabase, {
        profileId,
        stripePaymentId: paymentRef,
        amountMinor: charge.amount,
        currency: charge.currency,
        paidAt: new Date(charge.created * 1000).toISOString(),
        status: 'succeeded',
        metadata: charge.metadata as Record<string, string> | null,
        buyerEmail: charge.billing_details?.email ?? null,
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
        buyerEmail: charge.billing_details?.email ?? null,
      });
      break;
    }

    // ── Le client conteste un paiement auprès de sa banque ───────────────────
    // Stripe reprend l'argent immédiatement, avant même l'instruction. Le cash
    // doit donc baisser tout de suite — mais la vente n'est pas annulée pour
    // autant : l'élève peut gagner et récupérer les fonds. D'où un statut
    // `disputed` et non `canceled`, qui l'aurait figée (une annulation ne se
    // recalcule jamais).
    //
    // C'est le seul endroit de la plateforme où ne pas être prévenu coûte
    // directement de l'argent : un litige sans réponse sous 7 à 21 jours est
    // perdu automatiquement. La date limite est stockée pour être affichée.
    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
      if (!chargeId) break;

      const { dealId, paidAt: dateContestee } = await dealDuPaiement(supabase, profileId, chargeId, dispute.metadata);
      if (!dealId) break;

      // Identifiant préfixé : la ligne du litige doit coexister avec celle du
      // paiement, jamais la remplacer. Même règle que pour les remboursements.
      await supabase.from('deal_payments')
        .delete().eq('deal_id', dealId).eq('stripe_payment_id', `dispute_${chargeId}`);
      await supabase.from('deal_payments').insert({
        deal_id: dealId,
        stripe_payment_id: `dispute_${chargeId}`,
        amount: (dispute.amount ?? 0) / 100,
        currency: dispute.currency ?? 'eur',
        // Date du paiement contesté, pas celle du litige : la somme retirée se
        // soustrait au mois où elle était entrée. Repli sur la date du litige
        // quand la ligne d'origine n'a pas pu être retrouvée — une date
        // approchée vaut mieux qu'un NULL, qui rendrait le litige invisible de
        // toutes les périodes et donc jamais déduit.
        paid_at: dateContestee ?? new Date((dispute.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        status: 'disputed',
        match_method: 'metadata',
      });

      const echeance = dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
        : null;
      await supabase.from('deals').update({ dispute_due_by: echeance }).eq('id', dealId);

      await journaliser(supabase, dealId, 'dispute',
        `Paiement contesté auprès de la banque — ${Math.round((dispute.amount ?? 0) / 100)} €`,
        { due_by: echeance, reason: dispute.reason });

      await refreshDealStatus(supabase, dealId);

      // ── Prévenir tout de suite ──────────────────────────────────────────
      // Le seul incident de toute la chaîne où l'inaction coûte de l'argent :
      // sans réponse dans le délai — 7 à 21 jours selon la banque — Stripe perd
      // le litige automatiquement et l'argent ne revient jamais. Découvrir la
      // chose en ouvrant la plateforme trois semaines plus tard serait trop tard.
      //
      // L'échec d'envoi n'interrompt rien : le bandeau rouge et la pastille
      // restent, la notification n'est qu'un raccourci.
      try {
        const { data: d } = await supabase
          .from('deals').select('buyer_name, profile_id').eq('id', dealId).maybeSingle();
        if (d) {
          const limite = echeance
            ? ` Réponse à donner dans Stripe avant le ${new Date(echeance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.`
            : ' Une réponse est à donner dans Stripe.';
          await sendPushToProfile(
            d.profile_id,
            `${d.buyer_name} conteste un paiement`,
            `${Math.round((dispute.amount ?? 0) / 100)} €.${limite}`,
            `/paiements?deal=${dealId}`,
          );
        }
      } catch { /* la notification est un confort, jamais une condition */ }
      break;
    }

    // ── Litige gagné : Stripe rend les fonds ─────────────────────────────────
    // Écouter la reprise sans écouter la restitution laisserait un chiffre faux
    // à vie. La ligne du litige disparaît, et le statut se recalcule tout seul.
    case 'charge.dispute.funds_reinstated': {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
      if (!chargeId) break;

      const { dealId } = await dealDuPaiement(supabase, profileId, chargeId, dispute.metadata);
      if (!dealId) break;

      await supabase.from('deal_payments')
        .delete().eq('deal_id', dealId).eq('stripe_payment_id', `dispute_${chargeId}`);
      await supabase.from('deals').update({ dispute_due_by: null }).eq('id', dealId);

      await journaliser(supabase, dealId, 'dispute',
        `Litige gagné — les fonds sont revenus`, { charge: chargeId });

      await refreshDealStatus(supabase, dealId);
      break;
    }

    // ── Un remboursement a échoué ────────────────────────────────────────────
    // Carte fermée, compte clos : Stripe renvoie les fonds sur le compte de
    // l'élève. L'argent n'est donc PAS parti — la ligne de remboursement doit
    // disparaître, sinon le cash resterait amputé d'une somme qui est toujours là.
    case 'refund.failed': {
      const refund = event.data.object as Stripe.Refund;
      const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
      if (!chargeId) break;

      const { dealId } = await dealDuPaiement(supabase, profileId, chargeId, refund.metadata);
      if (!dealId) break;

      await supabase.from('deal_payments')
        .delete().eq('deal_id', dealId).eq('stripe_payment_id', chargeId).eq('status', 'refunded');

      await journaliser(supabase, dealId, 'refund',
        `Remboursement de ${Math.round((refund.amount ?? 0) / 100)} € refusé — les fonds sont revenus sur ton compte`,
        { reason: refund.failure_reason, charge: chargeId });

      await refreshDealStatus(supabase, dealId);
      break;
    }

    // ── Les prélèvements changent ou s'arrêtent ──────────────────────────────
    // `.deleted` seul ne suffit pas : une annulation « à la fin de la période »
    // n'émet que `.updated` tout de suite, et le `.deleted` n'arrive que des
    // semaines plus tard. Entre les deux, l'écran afficherait une vente qui a
    // l'air active — l'élève croirait que son annulation n'a pas fonctionné et
    // recommencerait.
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const { data: deal } = await supabase
        .from('deals').select('id, status').eq('stripe_subscription_id', sub.id).maybeSingle();
      if (!deal) break;

      const finPrevue = sub.cancel_at_period_end
        ? (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.cancel_at
        : sub.cancel_at;

      await supabase.from('deals').update({
        stops_at: finPrevue ? new Date(finPrevue * 1000).toISOString() : null,
      }).eq('id', deal.id);

      if (finPrevue && !['ended', 'canceled'].includes(deal.status)) {
        await journaliser(supabase, deal.id, 'terms_changed',
          `Arrêt des prélèvements programmé pour le ${new Date(finPrevue * 1000).toLocaleDateString('fr-FR')}`,
          { stops_at: finPrevue });
      }
      break;
    }

    // Les prélèvements se sont réellement arrêtés. La vente se termine sans être
    // annulée : l'argent déjà versé reste acquis, elle sort simplement des
    // relances. `ended_by: 'stripe'` distingue cet arrêt constaté d'une clôture
    // déclarée par l'élève — l'écran dit « Arrêté » dans un cas, « Clôturé » dans
    // l'autre.
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const { data: deal } = await supabase
        .from('deals').select('id, status').eq('stripe_subscription_id', sub.id).maybeSingle();
      if (!deal) break;

      // Une vente déjà soldée ou annulée ne devient pas « arrêtée » : la fin
      // normale d'un plan en 3 fois émet aussi cet événement.
      if (['paid', 'canceled', 'ended'].includes(deal.status)) break;

      await supabase.from('deals').update({
        status: 'ended',
        ended_by: 'stripe',
        ended_at: new Date().toISOString(),
        stops_at: null,
      }).eq('id', deal.id);

      await journaliser(supabase, deal.id, 'ended',
        'Prélèvements arrêtés chez Stripe', { subscription: sub.id });
      break;
    }

    // L'utilisateur a débranché Momentum depuis son dashboard Stripe.
    //
    // ⚠️ `status` n'accepte QUE 'ok' ou 'failed' — contrainte
    // `integrations_status_check`. Ce case écrivait 'disconnected' : l'UPDATE
    // était rejeté par Postgres, l'erreur n'était pas lue, et RIEN n'était
    // écrit. Le jeton mort restait en base, l'intégration restait « ok », et
    // l'élève continuait de voir des chiffres figés sur une connexion rompue —
    // exactement la panne invisible que le bandeau de santé cherche à montrer,
    // et que ce case était censé déclarer.
    case 'account.application.deauthorized': {
      const { error } = await supabase.from('integrations')
        .update({
          access_token: null,
          refresh_token: null,
          status: 'failed',
          last_snapshot_status: 'error',
          last_snapshot_error: 'stripe: compte débranché depuis le dashboard Stripe',
        })
        .eq('provider', 'stripe')
        .eq('account_label', event.account!);
      // Une écriture de santé qui échoue en silence est pire que pas d'écriture
      // du tout : elle laisse croire que la surveillance fonctionne.
      if (error) console.error('[stripe] deauthorized non enregistré:', error.message);
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
