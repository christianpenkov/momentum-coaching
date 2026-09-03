import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RateLimiter, mapWithConcurrency } from '../_shared/rate-limit.ts';
import { calculerCash, statutDeal } from '../_shared/dealCash.ts';

/**
 * Le FILET du cash : relit les paiements chez Stripe, pour TOUS les comptes.
 *
 * Deux modes de connexion coexistent. En OAuth, le webhook Connect
 * (app/api/webhooks/stripe) reçoit les événements en temps réel — `event.account`
 * donne le profil. En clé restreinte, il n'y a pas de webhook du tout : un élève dont
 * le compte Stripe est déjà contrôlé par une autre plateforme ne peut pas passer par
 * OAuth (restriction Stripe de juin 2021), et cette fonction est son seul chemin.
 *
 * ⚠️ ELLE COUVRE AUSSI L'OAUTH DEPUIS LE 2026-08-30, et c'est le point important.
 * Les comptes OAuth en étaient exclus au motif que « leur webhook fait déjà le travail
 * en temps réel ». Vrai du temps réel, faux du RATTRAPAGE : le webhook était pour eux
 * l'unique chemin d'écriture. Un événement non délivré, et le paiement n'existait nulle
 * part — ni dans le cash, ni dans « À rattacher », ni dans aucune vue de santé, sans
 * aucun signal et définitivement. Trois charges du compte de test étaient dans ce cas.
 *
 * Le webhook reste le chemin nominal. Ceci passe TOUTES LES 30 MINUTES derrière lui
 * (cron-job.org, passage autonome vérifié le 2026-08-31 à 14:01 puis 14:30 UTC).
 *
 * La cadence n'est pas arbitraire : `OVERLAP_MINUTES = 30` fait que chaque fenêtre
 * couvre l'intervalle PLUS son recouvrement. À 30 minutes, un passage manqué est
 * intégralement rattrapé par le suivant. À une passe quotidienne — la cadence prévue
 * à l'origine — ce même recouvrement de 30 minutes laissait un trou de 23 h 30 sans
 * filet. Changer l'un sans l'autre rouvre ce trou.
 *
 * ⚠️ Les identifiants écrits ici DOIVENT être ceux du webhook, sinon le même argent
 * s'écrit deux fois et le cash double — voir `refCharge` et `refundId`.
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
// Pour joindre /api/stripe/deal-effects — même pattern que poll-leads et
// notify-rapport.
const PLATFORM_URL = Deno.env.get('NEXT_PUBLIC_PLATFORM_URL') || 'https://momentum-plateforme.vercel.app';
// Clé PLATEFORME — sert aux comptes OAuth, avec l'en-tête `Stripe-Account`. Les
// comptes en clé restreinte utilisent la leur. Même dualité que lib/stripe-account.ts.
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Limiteur Stripe PARTAGÉ par tout le run. Stripe plafonne à ~100 req/s en live
// et 25/s en mode test (et non l'inverse — corrigé le 2026-09-02, la version
// précédente de ce commentaire avait inversé les deux), et le compteur est par
// compte — or plusieurs élèves peuvent
// dépendre du même compte Stripe (clé restreinte d'une plateforme tierce).
// 20 req/s laisse une marge sous la limite live, sans ralentir un run normal.
// Le 429 de Stripe renvoie l'en-tête standard, géré par le backoff du limiteur.
const stripeLimiter = new RateLimiter({
  concurrency: 5,
  tokensPerInterval: 20,
  intervalMs: 1_000,
  maxRetryWaitMs: 15_000,
  maxRetries: 3,
});

// Metadata posées à la création du lien (lib/stripe-payment-links.ts). Dupliquées
// ici faute d'import cross-runtime possible — même pattern que isValidContentId
// dans sync-calendly/index.ts.
const MD_DEAL = 'momentum_deal_id';

/**
 * Le deal désigné par des metadata Stripe existe-t-il encore chez nous ?
 *
 * ⚠️ Les metadata d'une facture sont un INSTANTANÉ figé à sa finalisation : elles
 * gardent l'identifiant du deal pour toujours, même si la vente a été supprimée
 * depuis — ce qui arrive en test, et arrivera en production le jour d'un ménage.
 * Insérer sans vérifier lève alors une violation de clé étrangère, le profil part
 * en erreur, `stripe_synced_at` n'avance pas, et la passe suivante rejoue la MÊME
 * fenêtre pour échouer au même endroit. Blocage permanent : le filet ne rattrape
 * plus jamais rien, en journalisant chaque jour la même erreur.
 *
 * Constaté au premier lancement réel, le 2026-08-31 : deux factures pointant vers
 * des deals disparus suffisaient à figer le profil.
 *
 * Un deal introuvable n'est pas une erreur de traitement — c'est un paiement
 * orphelin, exactement comme un paiement sans metadata. Il garde sa trace dans
 * `stripe_payments` et remonte dans « À rattacher ».
 */
async function dealExiste(dealId: string): Promise<boolean> {
  // Une metadata est saisissable à la main dans le dashboard Stripe : elle peut ne
  // pas être un UUID du tout, et Postgres répondrait 22P02 au lieu de « rien trouvé ».
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId)) return false;
  const { data } = await supabase.from('deals').select('id').eq('id', dealId).maybeSingle();
  return !!data;
}
const MD_INSTALLMENT = 'momentum_installment_id';

/** Filet en cas de première passe ou de panne prolongée du cron. */
const MAX_LOOKBACK_DAYS = 30;
/** Recouvrement volontaire : un paiement à cheval sur deux passes est vu deux fois
 *  plutôt que zéro. Le dédoublonnage se fait en base, le coût est nul. */
const OVERLAP_MINUTES = 30;

interface SyncResult { seen: number; attached: number; errors: string[]; tronque: boolean }

/**
 * Comment joindre le compte Stripe d'un élève. Deux modes, comme lib/stripe-account.ts :
 *   clé restreinte → la clé EST celle du compte, aucun en-tête à poser ;
 *   OAuth          → notre clé PLATEFORME, plus l'en-tête `Stripe-Account: acct_…`.
 */
interface AccesStripe { cle: string; compte: string | null }

/**
 * Pourquoi un encaissement n'est rattaché à aucune vente. `null` = il l'est.
 * Valeurs tenues par la contrainte CHECK de `stripe_payments.orphan_cause`.
 */
type OrphanCause = 'metadata_absente' | 'deal_supprime' | 'abonnement_inconnu' | null;

/** Un appel Stripe. */
async function stripeGet(acces: AccesStripe, path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  // Passe par le limiteur partagé : sémaphore + token bucket + backoff sur 429.
  const res = await stripeLimiter.run(() => fetch(`https://api.stripe.com/v1/${path}?${qs}`, {
    headers: {
      Authorization: `Bearer ${acces.cle}`,
      'Stripe-Version': '2026-04-22.dahlia',
      ...(acces.compte ? { 'Stripe-Account': acces.compte } : {}),
    },
  }));
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
async function stripeList(acces: AccesStripe, path: string, since: number, extra: Record<string, string> = {}): Promise<{ data: any[]; tronque: boolean }> {
  const out: any[] = [];
  let startingAfter: string | undefined;
  let tronque = false;

  // 30 pages = 3 000 objets = 30 requêtes (~1,5 s au limiteur 20 req/s) : la borne
  // protège le budget de 150 s sans être atteignable par un compte de coaching
  // normal. Elle était à 10, ce qui créait un risque de blocage PERMANENT : un
  // profil tronqué ne voit pas sa borne avancer (voulu — le plus ancien serait
  // perdu), donc il rejouait la MÊME fenêtre de > 1 000 objets à chaque passage,
  // indéfiniment. Le seul compte capable de dépasser 3 000 objets en 30 jours est
  // une clé restreinte partagée avec une plateforme tierce à très fort volume —
  // et ce cas-là se voit : la troncature est journalisée dans cron_runs à chaque
  // passage.
  const MAX_PAGES = 30;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await stripeGet(acces, path, {
      'created[gte]': String(since),
      limit: '100',
      ...extra,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const data: any[] = body.data ?? [];
    out.push(...data);
    if (!body.has_more || !data.length) break;
    startingAfter = data[data.length - 1].id;
    // Dernière page ET il en reste : on s'arrête sur la borne, pas sur la fin des
    // données. Le drapeau remonte jusqu'au curseur, qui ne bougera pas.
    if (page === MAX_PAGES - 1) tronque = true;
  }

  return { data: out, tronque };
}

/**
 * Recalcule le statut d'un deal — en déléguant les cas À EFFETS à la route
 * /api/stripe/deal-effects, qui exécute la règle COMPLÈTE (lib/dealStatus.ts).
 *
 * Cette copie Deno était une version AMPUTÉE de celle du webhook : recalcul du
 * statut seul, sans `desactiverLiensDuDeal` ni le drapeau `unexpected_payment_at`
 * ni la push. Pour un compte en clé restreinte (pas de webhook — ce cron est son
 * seul chemin), un remboursement intégral fait au dashboard Stripe annulait la
 * vente EN LAISSANT LE LIEN DE PAIEMENT ACTIF. Constaté à l'audit du 2026-09-02.
 *
 * On ne porte PAS ces effets en Deno : ils importent le SDK Stripe, getStripeAccess
 * et web-push — trois copies figées de plus, le mode de panne dominant du projet.
 * La route les exécute avec le code de lib/, LA source. Même architecture que
 * cron-refresh-tokens et cron-health (AGENTS.md, « Pourquoi les deux dernières
 * restent sur Vercel »).
 *
 * ⚠️ Sur échec de la route, on n'applique PAS la transition localement : on lève.
 * C'est ce qui rend la reprise CONVERGENTE — l'erreur retient la borne du profil,
 * la passe suivante rejoue la fenêtre, revoit le remboursement, retombe sur la
 * transition encore en attente, et re-délègue. Appliquer le statut localement
 * aurait « consommé » la transition : la route, rappelée plus tard, n'aurait plus
 * rien vu à faire, et les liens seraient restés actifs pour toujours. Le statut
 * reste stale quelques passages en cas de panne Vercel ; le cash, lui, reste
 * juste (il se calcule sur deal_payments, jamais sur le statut).
 *
 * Les transitions SANS effets (open → partiellement payé, etc.) restent locales :
 * pas de saut réseau sur le chemin courant.
 */
async function refreshDealStatus(dealId: string, argentEntrant: boolean) {
  const { data: deal } = await supabase
    .from('deals').select('amount_total, status').eq('id', dealId).maybeSingle();
  if (!deal) return;

  const { data: payments } = await supabase
    .from('deal_payments').select('amount, status').eq('deal_id', dealId);

  const status = statutDeal(calculerCash(payments), deal.amount_total, deal.status);

  const transitionAnnulation = status === 'canceled' && status !== deal.status;
  const argentSurVenteTerminee = argentEntrant && (deal.status === 'ended' || deal.status === 'canceled');

  if (transitionAnnulation || argentSurVenteTerminee) {
    const res = await fetch(`${PLATFORM_URL}/api/stripe/deal-effects`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId, argentEntrant }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`deal-effects ${res.status} — transition non appliquée, rejouée au prochain passage`);
    }
    return; // La route a appliqué statut + effets.
  }

  if (status && status !== deal.status) {
    await supabase.from('deals').update({ status }).eq('id', dealId);
  }

  // ⚠️ ON NE TOUCHE PAS À L'APPEL ICI — un remboursement dit qu'un mouvement
  // d'argent a eu lieu, jamais pourquoi. Seul le geste explicite « Annuler la
  // vente » déclasse un appel. Même raisonnement, mêmes mots, dans
  // lib/dealStatus.ts.
}

/**
 * Même ordre de certitude que le webhook : metadata, puis subscription.
 *
 * `touchedDeals` collecte les deals impactés au lieu de recalculer leur statut
 * ici : refreshDealStatus relit TOUS les paiements du deal, donc l'appeler à
 * chaque paiement attaché le faisait tourner 3 fois pour un 3×, avec 3 lectures
 * complètes. Un seul passage par deal en fin de profil donne le même résultat.
 */
async function upsertPayment(profileId: string, p: {
  paymentId: string;
  amountMinor: number;
  currency: string;
  paidAt: string;
  metadata: Record<string, string> | null;
  subscriptionId: string | null;
  /** Lu sur charge.billing_details.email / invoice.customer_email — voir plus bas. */
  buyerEmail: string | null;
}, touchedDeals: Set<string>, dealsArgentEntrant: Set<string>): Promise<boolean> {
  // ── Résoudre AVANT d'écrire ──────────────────────────────────────────────────
  // L'ordre a changé : la trace brute porte désormais la CAUSE de l'orphelinat, et
  // cette cause est un produit de la résolution. L'écrire ensuite aurait demandé une
  // seconde écriture, donc un instant où la ligne existe sans sa cause.
  let dealId = p.metadata?.[MD_DEAL] ?? null;
  let matchMethod: 'metadata' | 'subscription' = 'metadata';
  let cause: OrphanCause = null;

  // Le deal des metadata a pu disparaître — voir dealExiste(). On retombe alors sur
  // la résolution par abonnement, puis sur « orphelin », au lieu de lever.
  if (dealId && !(await dealExiste(dealId))) { dealId = null; cause = 'deal_supprime'; }

  if (!dealId && p.subscriptionId) {
    const { data } = await supabase
      .from('deals').select('id')
      .eq('stripe_subscription_id', p.subscriptionId)
      .maybeSingle();
    if (data) { dealId = data.id; matchMethod = 'subscription'; cause = null; }
    // `deal_supprime` l'emporte s'il a déjà été posé : il est plus précis et plus
    // actionnable qu'« abonnement inconnu », qui n'en serait que la conséquence.
    else if (!cause) cause = 'abonnement_inconnu';
  }

  // Ni metadata exploitable, ni abonnement : l'objet Stripe ne portait simplement
  // rien qui nous désigne.
  if (!dealId && !cause) cause = 'metadata_absente';

  const { error: payErr } = await supabase.from('stripe_payments').upsert({
    profile_id: profileId,
    payment_id: p.paymentId,
    amount: p.amountMinor / 100,
    currency: p.currency,
    date: p.paidAt,
    status: 'succeeded',
    // ⚠️ SANS CET E-MAIL, L'ÉCRAN DE RATTACHEMENT NE SERT À RIEN.
    // Le niveau « Certain » l'exige — c'est le seul signal qui identifie une
    // personne. Sans lui, aucun candidat ne dépasse « Possible », et sur une
    // échéance (300 € sur une vente de 900 €) le montant ne correspond pas non
    // plus : l'écran affiche « Aucun deal ne correspond » avec « Ignorer » pour
    // seul bouton. Ce filet ramènerait l'argent et l'écran inviterait à l'écarter.
    buyer_email: p.buyerEmail,
    // ⚠️ TOUJOURS écrite, y compris à `null` quand le paiement EST rattaché.
    // C'est ce qui fait la remise à zéro : un passage qui trouve enfin le deal
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
    subscription_id: dealId ? null : p.subscriptionId,
  }, { onConflict: 'profile_id,payment_id' });
  if (payErr) throw payErr;

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
  if (error) {
    // 23505 = violation d'unicité sur deal_payments_deal_id_stripe_payment_id_key.
    // Le SELECT ci-dessus et cet INSERT ne sont pas atomiques : depuis que les
    // paiements sont traités en concurrence, une charge et sa facture d'abonnement
    // (même id de deal) peuvent franchir le check en même temps. L'index rattrape,
    // et ce cas signifie « déjà écrit », pas « échec » — le compter comme erreur
    // empêcherait à tort l'avance de la borne du profil.
    if ((error as { code?: string }).code === '23505') return false;
    throw error;
  }

  if (installmentId) {
    await supabase.from('deal_installments').update({ status: 'paid' }).eq('id', installmentId);
  }

  // Statut recalculé une seule fois par deal, en fin de profil. Ce chemin-ci a
  // écrit un paiement `succeeded` NOUVEAU : c'est le signal « argent entrant »
  // qu'attend la règle du drapeau `unexpected_payment_at` (lib/dealStatus.ts).
  touchedDeals.add(dealId);
  dealsArgentEntrant.add(dealId);
  return true;
}

/**
 * Enregistre le remboursement d'une charge, en ligne SÉPARÉE du paiement.
 *
 * ⚠️ L'IDENTIFIANT NE DOIT JAMAIS ÊTRE CELUI DU PAIEMENT ⚠️
 *
 * Le remboursement porte `ch_…` (l'id de la charge) et le paiement `in_…` ou `pi_…` —
 * exactement comme le webhook. Deux identifiants différents, donc deux lignes qui
 * coexistent, et lib/dealCash.ts soustrait la seconde de la première.
 *
 * Réutiliser le MÊME id pour les deux remplacerait la ligne du paiement au lieu d'en
 * ajouter une, et le net partirait EN NÉGATIF sans qu'aucune erreur ne le signale.
 *
 * Cette divergence d'identifiants a l'air d'une incohérence à corriger. Elle ne l'est
 * pas : c'est elle qui rend la soustraction juste. Voir le même avertissement dans
 * _shared/dealCash.ts.
 */
async function upsertRefund(
  profileId: string,
  charge: { id: string; created: number; amount_refunded: number; currency: string; metadata?: Record<string, string> | null; billing_details?: { email?: string | null } | null },
  touchedDeals: Set<string>,
): Promise<void> {
  // `charge.id` et non `refund_${charge.id}` : c'est ce qu'écrit le webhook sur son
  // cas `charge.refunded`. Un préfixe différent aurait fait coexister DEUX lignes de
  // remboursement pour le même argent dès que les deux chemins visent le même compte,
  // et un remboursement compté deux fois se SOUSTRAIT deux fois — pire que le défaut
  // qu'on ferme. L'identifiant reste distinct de celui du paiement (`pi_…` / `in_…`),
  // ce qui est voulu : la ligne de remboursement doit coexister avec celle du
  // paiement, jamais la remplacer.
  const refundId = charge.id;
  const montant = Number(charge.amount_refunded ?? 0) / 100;
  // ⚠️ La date est celle de la charge D'ORIGINE, comme au webhook — pas « maintenant ».
  //
  // Deux raisons, toutes deux constatées le 2026-09-02 :
  //   1. `new Date()` violait le point 3 bis du checklist (état actuel sur ligne
  //      datée) : la date du remboursement se réécrivait à chaque repassage de la
  //      fenêtre, donc elle ne voulait rien dire.
  //   2. Le webhook écrit `charge.created` (décision de Chris du 2026-08-30 : le
  //      remboursement se soustrait au mois où l'argent était entré). Deux chemins,
  //      deux dates pour la même ligne = la copie du cron écrasait la bonne valeur
  //      du webhook à chaque passage de 30 min.
  const quand = new Date(charge.created * 1000).toISOString();

  await supabase.from('stripe_payments').upsert({
    profile_id: profileId,
    payment_id: refundId,
    amount: montant,
    currency: charge.currency,
    date: quand,
    status: 'refunded',
    buyer_email: charge.billing_details?.email ?? null,
  }, { onConflict: 'profile_id,payment_id' });

  const dealId = charge.metadata?.[MD_DEAL] ?? null;
  // Même garde que pour les encaissements : un deal supprimé ne doit pas figer le
  // profil sur une violation de clé étrangère, passage après passage.
  if (!dealId || !(await dealExiste(dealId))) return;

  // Le montant remboursé grandit à chaque remboursement partiel : on remplace la
  // ligne plutôt que de sortir si elle existe déjà, contrairement aux paiements.
  // delete+insert et non upsert : index partiel + onConflict Supabase JS =
  // échec silencieux (cf. bug pipeline advance/reset).
  await supabase.from('deal_payments')
    .delete().eq('deal_id', dealId).eq('stripe_payment_id', refundId);

  const { error } = await supabase.from('deal_payments').insert({
    deal_id: dealId,
    stripe_payment_id: refundId,
    amount: montant,
    currency: charge.currency,
    // ⚠️ JAMAIS null. `paid_at` borne les périodes partout (`gte`/`lte`) : à NULL,
    // le remboursement était invisible de TOUTES les fenêtres, donc jamais déduit
    // nulle part — le bug exact que le webhook documente et corrige depuis le
    // 2026-08-30 (« 1 000 € encaissés et 200 € remboursés s'affichaient 1 000 € »).
    // Cette copie Deno ne l'avait jamais reçu, et comme elle fait delete+insert,
    // elle REMPLAÇAIT la ligne correcte du webhook par une ligne à NULL toutes les
    // 30 minutes. Motif « deux copies, une seule à jour », sur de l'argent.
    paid_at: quand,
    status: 'refunded',
    match_method: 'metadata',
  });
  if (error && (error as { code?: string }).code !== '23505') throw error;

  touchedDeals.add(dealId);
}

async function syncProfile(profileId: string, acces: AccesStripe, lastSyncedAt: string | null): Promise<SyncResult> {
  const errors: string[] = [];
  let seen = 0;
  let attached = 0;
  let tronque = false;

  // Fenêtre incrémentale : on repart du dernier passage réussi, moins un
  // recouvrement. Sans borne basse (première passe), on remonte 30 jours.
  const floor = Date.now() - MAX_LOOKBACK_DAYS * 86400_000;
  const from = lastSyncedAt
    ? Math.max(new Date(lastSyncedAt).getTime() - OVERLAP_MINUTES * 60_000, floor)
    : floor;
  const since = Math.floor(from / 1000);

  // Deals touchés pendant ce profil — leur statut est recalculé une seule fois,
  // en fin de fonction, plutôt qu'à chaque paiement attaché. Le second Set trace
  // ceux qui ont reçu un paiement `succeeded` NOUVEAU pendant cette passe : c'est
  // le signal `argentEntrant` de lib/dealStatus.ts (drapeau « paiement sur vente
  // terminée »), qu'un remboursement seul ne doit jamais déclencher.
  const touchedDeals = new Set<string>();
  const dealsArgentEntrant = new Set<string>();

  // Charges : les paiements comptant. Factures : les échéances d'abonnement.
  // Un paiement d'abonnement produit les deux — le dédoublonnage se fait en base.
  //
  // ⚠️ Les charges REMBOURSÉES étaient écartées ici (`&& !c.refunded`). Deux
  // conséquences, toutes deux fausses : un remboursement partiel faisait
  // disparaître le paiement entier au lieu d'en retrancher une part, et un
  // compte en clé restreinte n'avait jamais aucune ligne `refunded` en base —
  // donc le cash encaissé ne bougeait pas d'un remboursement.
  // On les garde, et le remboursement est enregistré à part (upsertRefund).
  const lotCharges = await stripeList(acces, 'charges', since);
  tronque = tronque || lotCharges.tronque;
  const charges = lotCharges.data.filter((c: any) => c.status === 'succeeded');
  seen += charges.length;

  // Concurrence bornée (4) au lieu d'un `for await` strictement séquentiel :
  // chaque upsertPayment enchaîne 2 à 4 requêtes Supabase, donc 100 paiements
  // faisaient jusqu'à 400 allers-retours en file d'attente. Borné, et non
  // `Promise.all`, pour ne pas ouvrir 100 connexions Postgres d'un coup.
  const chargeResults = await mapWithConcurrency(charges, 4, async (charge: any) => {
    // ⚠️ L'IDENTIFIANT DOIT ÊTRE CELUI DU WEBHOOK, sinon le même argent s'écrit deux
    // fois dès que les deux chemins visent le même compte — le cas depuis que ce filet
    // couvre aussi l'OAuth. Les trois familles du webhook :
    //
    //   invoice.paid      → inv.id                          → `in_…`
    //   charge.succeeded  → charge.payment_intent ?? id      → `pi_…`
    //   charge.refunded   → charge.id                        → `ch_…`
    //
    // Écrire `charge.id` ici doublait donc chaque paiement comptant, déjà écrit en
    // `pi_…` par le webhook. L'index unique porte sur (deal_id, stripe_payment_id) :
    // deux identifiants différents pour le même argent coexistent légalement, et
    // `calculerCash` les somme tous les deux.
    //
    // ⚠️ Ne PAS chercher à rattacher une charge à sa facture ici non plus : mesuré
    // contre l'API réelle le 2026-08-31, `charge.invoice` n'existe plus sur
    // `2026-04-22.dahlia`, et une charge d'abonnement porte `metadata: {}` — donc
    // elle ne se rattache à aucun deal et n'écrit rien. Voir le commentaire détaillé
    // dans app/api/webhooks/stripe/route.ts, case `charge.succeeded`.
    const refCharge = (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id)
      ?? charge.id;
    const attache = await upsertPayment(profileId, {
      paymentId: refCharge,
      amountMinor: charge.amount,
      currency: charge.currency,
      paidAt: new Date(charge.created * 1000).toISOString(),
      metadata: charge.metadata ?? null,
      subscriptionId: null,
      buyerEmail: charge.billing_details?.email ?? null,
    }, touchedDeals, dealsArgentEntrant);

    // `amount_refunded` est CUMULATIF : deux remboursements partiels de 200 puis
    // 100 donnent 200 puis 300. On réécrit donc la ligne à chaque passage plutôt
    // que de l'additionner.
    if (Number(charge.amount_refunded ?? 0) > 0) {
      await upsertRefund(profileId, charge, touchedDeals);
    }
    return attache;
  });
  chargeResults.forEach((r, i) => {
    if (r.status === 'fulfilled') { if (r.value) attached++; }
    else errors.push(`charge ${charges[i].id}: ${r.reason?.message || 'unknown'}`);
  });

  // ── Remboursements TARDIFS : la passe qui manquait ──────────────────────────
  //
  // La liste `charges` ci-dessus filtre sur `created[gte]` de la CHARGE. Or un
  // remboursement arrive typiquement des jours ou des semaines après
  // l'encaissement : sa charge d'origine est alors hors fenêtre, et son
  // `amount_refunded` n'était jamais relu. Conséquence, constatée à l'audit du
  // 2026-09-02 : pour un compte en clé restreinte (pas de webhook — cette
  // fonction est son seul chemin), quasiment AUCUN remboursement réel n'était
  // jamais enregistré. Le cash net restait faux, sans erreur, définitivement.
  //
  // `/v1/refunds` filtre sur la date DU REMBOURSEMENT : c'est la bonne clé de
  // fenêtre. On ne relit la charge d'origine que pour les remboursements dont la
  // charge est hors de la fenêtre courante (les autres sont déjà couverts par la
  // passe ci-dessus) — le surcoût est donc proportionnel aux remboursements
  // tardifs, c'est-à-dire quasi nul en régime établi.
  const lotRefunds = await stripeList(acces, 'refunds', since);
  tronque = tronque || lotRefunds.tronque;
  const chargesDejaVues = new Set(lotCharges.data.map((c: any) => c.id));
  const chargesARelire = [...new Set(
    lotRefunds.data
      .filter((r: any) => r.status === 'succeeded' && typeof r.charge === 'string' && !chargesDejaVues.has(r.charge))
      .map((r: any) => r.charge as string),
  )];
  const refundResults = await mapWithConcurrency(chargesARelire, 4, async (chargeId: string) => {
    // La charge relue porte `amount_refunded` CUMULATIF, metadata et e-mail —
    // exactement ce qu'attend upsertRefund, qui réécrit la ligne à chaque fois.
    const charge = await stripeGet(acces, `charges/${chargeId}`, {});
    if (Number(charge.amount_refunded ?? 0) > 0) {
      await upsertRefund(profileId, charge, touchedDeals);
    }
  });
  refundResults.forEach((r, i) => {
    if (r.status === 'rejected') errors.push(`refund charge ${chargesARelire[i]}: ${r.reason?.message || 'unknown'}`);
  });
  seen += chargesARelire.length;

  const lotFactures = await stripeList(acces, 'invoices', since, { status: 'paid' });
  tronque = tronque || lotFactures.tronque;
  const invoices = lotFactures.data.filter((inv: any) => !!inv.id);
  seen += invoices.length;

  const invoiceResults = await mapWithConcurrency(invoices, 4, (inv: any) => {
    // L'emplacement de la subscription dépend de la version d'API : à la racine
    // de l'Invoice jusqu'à Acacia (2025-02-24), sous parent.subscription_details
    // depuis Dahlia. On lit les deux — un compte peut être épinglé sur une version
    // antérieure à celle qu'on demande dans l'en-tête Stripe-Version.
    // Ces metadata sont un instantané figé à la finalisation : c'est ce qui fait
    // que les échéances 2 et 3 d'un 3× portent encore l'id du deal.
    const details = inv.parent?.subscription_details ?? inv.subscription_details ?? null;
    const sub = details?.subscription ?? inv.subscription ?? null;
    return upsertPayment(profileId, {
      paymentId: inv.id,
      amountMinor: inv.amount_paid ?? 0,
      currency: inv.currency ?? 'eur',
      paidAt: new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000).toISOString(),
      metadata: details?.metadata ?? inv.metadata ?? null,
      subscriptionId: typeof sub === 'string' ? sub : sub?.id ?? null,
      buyerEmail: inv.customer_email ?? null,
    }, touchedDeals, dealsArgentEntrant);
  });
  invoiceResults.forEach((r, i) => {
    if (r.status === 'fulfilled') { if (r.value) attached++; }
    else errors.push(`invoice ${invoices[i].id}: ${r.reason?.message || 'unknown'}`);
  });

  // Un seul recalcul par deal touché, après que tous ses paiements sont écrits —
  // sinon le statut serait calculé sur une vue partielle des échéances.
  for (const dealId of touchedDeals) {
    try {
      await refreshDealStatus(dealId, dealsArgentEntrant.has(dealId));
    } catch (e) {
      errors.push(`deal_status ${dealId}: ${(e as Error).message}`);
    }
  }

  return { seen, attached, errors, tronque };
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 });
  }

  // Filigrane de passage : la preuve que ce cron est encore INVOQUE.
  //
  // Pose AU PLUS TOT, juste apres l'authentification, et non a la fin. La question que
  // pose `crons_sante` est « le planificateur appelle-t-il encore cette URL ? » — c'est
  // la panne invisible de la plateforme : un cron qui ne tourne plus n'echoue pas, il
  // se tait, et un silence ne se distingue pas d'un succes.
  //
  // Un echec SURVENU PENDANT l'execution est deja couvert par `cron_runs`, et les deux
  // ne doivent pas se recouvrir. Marquer a la fin ferait en plus passer un simple
  // depassement de temps pour une mort du cron — une fausse alerte, c'est-a-dire le
  // debut d'une alerte qu'on n'ouvre plus.
  //
  // Le seuil de silence vit sur la LIGNE (`crons_passages.silence_max`), pas ici : la
  // RPC ne met a jour que l'horodatage, donc changer la cadence de ce cron se repercute
  // en base sans toucher au code.
  //
  // Strictement non bloquant : un filigrane muet vaut mieux qu'un cron qui tombe.
  try {
    const { error: filigraneErr } = await supabase.rpc('marquer_passage_cron', { p_nom: 'sync-stripe-payments' });
    if (filigraneErr) console.error('[sync-stripe-payments] filigrane de passage:', filigraneErr.message);
  } catch (e) { console.error('[sync-stripe-payments] filigrane de passage:', e); }

  // ⚠️ Les comptes OAuth ne sont PLUS exclus.
  //
  // Ils l'étaient au motif que « leur webhook fait déjà le travail en temps réel ».
  // C'était vrai du temps réel, faux du rattrapage : pour eux le webhook était
  // l'UNIQUE chemin d'écriture du cash. Un événement non délivré, et le paiement
  // n'existait nulle part — ni dans le cash, ni dans « À rattacher » (qui lit ce que
  // le webhook a écrit), ni dans aucune vue de santé. Aucun signal, définitivement.
  // Constaté le 2026-08-30 : trois charges du compte de test absentes de
  // `stripe_payments`, postérieures au branchement du webhook.
  //
  // Le webhook reste le chemin nominal et temps réel. Ceci est un filet quotidien :
  // il ne rattrape que ce que le webhook a manqué, et l'index unique
  // (deal_id, stripe_payment_id) fait le reste — à condition que les identifiants
  // soient les mêmes des deux côtés, voir `refCharge` et `refundId`.
  const { data: integrations, error } = await supabase
    .from('integrations')
    .select('profile_id, api_key, access_token, account_label, metadata')
    .eq('provider', 'stripe')
    .or('api_key.not.is.null,access_token.not.is.null');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!integrations?.length) {
    return new Response(JSON.stringify({ ok: true, profiles: 0, attached: 0 }), { status: 200 });
  }

  // Borne figée AVANT traitement : un paiement arrivant pendant l'exécution sera
  // repris au cycle suivant, que le recouvrement de 30 min garantit de couvrir.
  const runStartedAt = new Date().toISOString();

  // Concurrence BORNÉE à 5 profils. Le budget de 150 s n'est pas la contrainte —
  // la cadence l'est : Stripe plafonne à 25 req/s en live, et à 30 élèves un
  // Promise.all non borné lancerait ~300 appels d'un coup. Le limiteur régule
  // ensuite le débit fin, ce plafond évite d'empiler 30 files d'attente.
  // last_synced_at est déjà utilisée par sync-calendly : on isole la borne Stripe
  // dans metadata pour que les deux crons ne se marchent jamais dessus.
  // Même ordre de préférence que lib/stripe-account.ts : OAuth d'abord (le callback
  // efface api_key en s'installant), clé restreinte ensuite.
  //
  // ⚠️ La clé PLATEFORME doit exister dans l'environnement de la FONCTION — celle de
  // Vercel ne la lui donne pas. Sans elle, Stripe répond « Invalid API Key provided:
  // undefined », un message qui ne dit pas où chercher. On nomme donc la cause :
  //   npx supabase secrets set STRIPE_SECRET_KEY=sk_… --project-ref <ref>
  const acces = (integ: any): AccesStripe | null =>
    integ.access_token && integ.account_label?.startsWith('acct_')
      ? (STRIPE_SECRET_KEY ? { cle: STRIPE_SECRET_KEY, compte: integ.account_label } : null)
      : integ.api_key ? { cle: integ.api_key, compte: null }
      : null;

  // La borne de chaque profil est avancée ICI, dès que SON traitement se termine
  // sans erreur ni troncature — et non plus dans une boucle après le règlement de
  // TOUS les profils. La version précédente perdait tout au mur des 150 s : si la
  // fonction mourait sur le 38ᵉ profil d'une passe massive (onboarding groupé,
  // reprise après panne longue), les 37 profils déjà terminés ne gardaient rien,
  // rejouaient leur fenêtre complète au passage suivant, et le même mur pouvait
  // retomber — un blocage qui ne converge jamais. Le retraitement reste idempotent
  // dans les deux sens ; avancer par profil fait simplement converger la reprise.
  const settled = await mapWithConcurrency(integrations as any[], 5, (integ) => {
    const a = acces(integ);
    if (!a) {
      const cause = integ.access_token && !STRIPE_SECRET_KEY
        ? "compte OAuth mais STRIPE_SECRET_KEY absente de l'environnement de la fonction "
          + "(supabase secrets set STRIPE_SECRET_KEY=…)"
        : 'aucune clé exploitable';
      return Promise.resolve({ profile_id: integ.profile_id, seen: 0, attached: 0, errors: [cause], tronque: false });
    }
    return syncProfile(integ.profile_id, a, integ.metadata?.stripe_synced_at ?? null)
      .then(async (r) => {
        if (!r.errors.length && !r.tronque) {
          const { error: stampErr } = await supabase.rpc('set_integration_metadata_key', {
            p_profile_id: integ.profile_id,
            p_provider: 'stripe',
            p_key: 'stripe_synced_at',
            p_value: runStartedAt,
          });
          if (stampErr) console.error('[sync-stripe-payments] stripe_synced_at:', stampErr.message);
        }
        return { profile_id: integ.profile_id, ...r };
      });
  });

  const results = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          profile_id: (integrations as any[])[i].profile_id,
          seen: 0, attached: 0,
          errors: [r.reason?.message || 'unknown'],
          tronque: false,
        }
  );

  // La borne n'est avancée QUE pour les profils sans erreur (un profil en échec
  // rejouera sa fenêtre complète — en cas de doute on retraite trop, jamais trop
  // peu, même règle que sync-calendly), NI pour les profils TRONQUÉS (Stripe liste
  // du plus récent au plus ancien : ce qui manque est le plus ANCIEN de la fenêtre,
  // avancer la borne le perdrait pour toujours). L'avance elle-même est faite
  // profil par profil, dans la boucle ci-dessus — voir son commentaire.
  //
  // RPC plutôt qu'un update de l'objet metadata entier : sync-calendly écrit AUSSI
  // dans integrations.metadata (user_uri, resource). Relire l'objet puis le
  // réécrire écrasait toute clé posée entre-temps par l'autre cron. jsonb_set côté
  // serveur ne touche que la clé visée, sous verrou de ligne.
  const allErrors: Record<string, string[]> = {};
  for (const r of results) if (r.errors.length) allErrors[r.profile_id] = r.errors;

  // ── Journal en base, pas dans la réponse HTTP ──────────────────────────────
  // Un filet dont les échecs partent dans un corps de réponse que personne ne lit
  // n'est pas un filet. Convention du projet (AGENTS.md) : n'écrire QUE les passages
  // en échec — un cron quotidien qui va bien ne doit rien laisser derrière lui — et
  // laisser la purge automatique faire le ménage.
  //
  // La troncature compte comme un incident : elle signifie qu'une partie de la
  // fenêtre n'a PAS été lue, et c'est le seul endroit où ça se voit.
  const tronques = results.filter(r => r.tronque).map(r => r.profile_id);
  const enErreur = Object.keys(allErrors);
  if (enErreur.length || tronques.length) {
    const { error: journalErr } = await supabase.from('cron_runs').insert({
      fonction: 'sync-stripe-payments',
      profils_en_erreur: enErreur.length + tronques.length,
      erreurs: {
        ...(enErreur.length ? { echecs: allErrors } : {}),
        ...(tronques.length ? {
          tronques,
          note: "borne de 10 pages atteinte : la fenêtre n'a pas été lue en entier, "
              + "stripe_synced_at n'a PAS été avancé, la passe suivante la rejouera.",
        } : {}),
      },
    });
    if (journalErr) console.error('[sync-stripe-payments] cron_runs:', journalErr.message);
  }

  return new Response(JSON.stringify({
    ok: true,
    profiles: integrations.length,
    seen: results.reduce((a, r) => a + r.seen, 0),
    attached: results.reduce((a, r) => a + r.attached, 0),
    errors: allErrors,
  }), { status: 200 });
});
