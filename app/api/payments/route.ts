import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';
import { calculerCash, encaisseRetenu, aRembourser } from '@/lib/dealCash';

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
  /** Ce que la personne a VERSÉ, net des remboursements. Peut dépasser amountTotal. */
  collected: number;
  /** Ce qui compte comme RECOUVREMENT de cette vente : `collected` plafonné à
   *  amountTotal. Voir encaisseRetenu() dans lib/dealCash.ts. */
  collectedRetenu: number;
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
  /** Le deal a-t-il au moins un lien de paiement Stripe ? Faux = hors Stripe. */
  hasLinks: boolean;
  /**
   * Un échéancier existe-t-il en base ?
   *
   * C'est ce qui distingue un « hors Stripe » CHOISI — l'élève a posé des
   * échéances qu'il cochera à la main — d'une vente où personne n'a jamais rien
   * mis en place. Les deux se ressemblent (ni lien, ni prélèvement) et
   * n'appellent pourtant pas du tout le même geste.
   */
  hasSchedule: boolean;

  // ── Fin de vie et incidents ──────────────────────────────────────────────
  /** Qui a arrêté la vente : `stripe` (constaté) ou `user` (déclaré). */
  endedBy: 'stripe' | 'user' | null;
  endedAt: string | null;
  endedReason: string | null;
  /** Prélèvements qui s'arrêtent après cette date, sans être encore arrêtés. */
  stopsAt: string | null;
  /** Date limite pour répondre à un litige dans Stripe. */
  disputeDueBy: string | null;
  /** Argent arrivé sur une vente terminée — attend une décision. */
  unexpectedPaymentAt: string | null;
  /** Somme rendue au client. Séparée du net pour pouvoir l'afficher. */
  refunded: number;
  /** Somme reprise par Stripe le temps d'un litige. */
  disputed: number;
  /**
   * Argent qu'on attendait DÉJÀ et qui n'est pas arrivé.
   *
   * Une échéance dont la date est passée sans être payée est un impayé, au même
   * titre qu'un prélèvement refusé — l'écran de la vente le dit déjà en rouge,
   * mais le ruban et le filtre l'ignoraient : ils ne comptaient que les échecs
   * Stripe. Un client qui ne clique simplement jamais son lien n'apparaissait
   * donc nulle part.
   *
   * Une échéance À VENIR n'en fait jamais partie : elle n'est pas due.
   */
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
  /** L'état à afficher sur la ligne : le plus urgent de toutes ses ventes. */
  status: string;
  since: string;
}

/**
 * Ordre d'urgence des états. La ligne d'un client porte l'état le plus haut de
 * ses ventes : une vente contestée ne doit pas disparaître derrière une vente
 * soldée, même si la soldée est plus récente.
 */
const URGENCE = ['disputed', 'unexpected', 'past_due', 'open', 'ended', 'paid', 'canceled'];

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
      first_touch_content_id, attribution_source, shortio_link_id,
      ended_by, ended_at, ended_reason, stops_at, dispute_due_by, unexpected_payment_at,
      deal_payments ( id, installment_id, amount, status, paid_at, stripe_payment_id, failure_reason, refund_reason, refund_reason_note ),
      deal_installments ( id, rank, amount, due_on, status, short_url, sent_at, shortio_link_id )
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

  // ── Clics humains, lien par lien ───────────────────────────────────────────
  // C'est ce qui permet d'écrire « Marc a ouvert le lien sans payer » plutôt que
  // de le supposer. Les snapshots sont quotidiens : on somme sur toute la durée
  // de vie du lien, un lien ouvert il y a trois semaines compte toujours.
  //
  // Un lien sans `shortio_link_id` n'est pas une erreur — la colonne peut être
  // nulle sur un lien parfaitement valide. Il ressort simplement sans clic
  // connu, et l'écran n'affiche rien, ce qui est exact : on ne sait pas.
  const linkIds = new Set<string>();
  for (const d of (deals ?? []) as any[]) {
    if (d.shortio_link_id) linkIds.add(d.shortio_link_id);
    for (const i of d.deal_installments ?? []) {
      if (i.shortio_link_id) linkIds.add(i.shortio_link_id);
    }
  }
  const clicsParLien = new Map<string, number>();
  // Le JOUR de la première ouverture, et pas seulement le compte : « il a ouvert
  // sans payer » se discute, « il a ouvert le 26 août sans payer » se relance.
  const premierClicParLien = new Map<string, string>();
  if (linkIds.size) {
    const { data: snaps } = await supa
      .from('shortio_link_daily_snapshots')
      .select('link_id, human_clicks, date')
      .eq('profile_id', profileId)
      .in('link_id', [...linkIds]);
    for (const s of snaps ?? []) {
      clicsParLien.set(s.link_id, (clicsParLien.get(s.link_id) ?? 0) + (s.human_clicks ?? 0));
      if ((s.human_clicks ?? 0) > 0 && s.date) {
        const connu = premierClicParLien.get(s.link_id);
        if (!connu || s.date < connu) premierClicParLien.set(s.link_id, s.date);
      }
    }
  }

  const rows: DealRow[] = (deals ?? []).map((d: any) => {
    const payments = d.deal_payments ?? [];
    // Le collecté déduit les remboursements — même règle que le webhook et que
    // l'Edge Function, tenue par lib/dealCash.ts. Avant ce module, les trois
    // ignoraient les remboursements : un deal remboursé restait « payé » et son
    // montant restait dans le cash collecté du ruban.
    const cash = calculerCash(payments);
    // DEUX notions, volontairement distinctes — voir encaisseRetenu() dans
    // lib/dealCash.ts pour laquelle sert à quoi.
    const collected = cash.net;
    const collectedRetenu = encaisseRetenu(cash, d.amount_total);
    // Compte les paiements ENTRÉS, remboursements non déduits : c'est ce que
    // l'écran affiche (« 2 échéances payées »), et une échéance remboursée a
    // bien été payée.
    const succeeded = payments.filter((p: any) => p.status === 'succeeded');

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
      collectedRetenu,
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
      hasFailure: cash.aEchoue,
      // Un deal encaissé hors Stripe n'a aucun lien : le statut ne peut pas
      // dire « À envoyer », il n'y a rien à envoyer. Se calcule ici parce que
      // seule la route voit les échéances et leurs liens.
      hasLinks: (d.deal_installments ?? []).length > 0
        ? (d.deal_installments ?? []).some((i: any) => !!i.short_url)
        : !!d.short_url,
      hasSchedule: (d.deal_installments ?? []).length > 0,

      endedBy: d.ended_by ?? null,
      endedAt: d.ended_at ?? null,
      endedReason: d.ended_reason ?? null,
      stopsAt: d.stops_at ?? null,
      disputeDueBy: d.dispute_due_by ?? null,
      unexpectedPaymentAt: d.unexpected_payment_at ?? null,
      refunded: cash.rembourse,
      disputed: cash.conteste,
      // Versé AU-DELÀ du montant de la vente. Le ruban plafonne (`collectedRetenu`),
      // donc sans ce chiffre affiché sur la vente, l'argent en trop disparaîtrait de
      // l'écran : le total ne le compterait plus et rien ne dirait où il est passé.
      aRendre: aRembourser(cash, d.amount_total),
      overdue: enRetard(d, cash.net, cash.aEchoue),
    };
  });

  // ── Une ligne par personne ─────────────────────────────────────────────────
  // Un même client peut avoir plusieurs ventes ; les empiler dans la liste
  // faisait croire à plusieurs clients, et empêchait de voir d'un coup d'œil
  // combien Marc doit encore au total.
  //
  // L'identité se prend dans cet ordre : compte élève, puis lead Instagram, puis
  // à défaut le nom normalisé. Le nom en dernier parce qu'il se ressaisit à la
  // main d'une vente à l'autre — deux orthographes feraient deux personnes.
  const parPersonne = new Map<string, PersonRow>();
  for (const [i, r] of rows.entries()) {
    const source = (deals ?? [])[i] as any;
    const cle = r.clientId ? `c:${r.clientId}`
      : r.igLeadId ? `l:${r.igLeadId}`
      : `n:${(r.buyerName ?? '').trim().toLowerCase()}`;

    const etat = etatAffiche(r);
    const existant = parPersonne.get(cle);

    if (!existant) {
      parPersonne.set(cle, {
        key: cle,
        name: r.buyerName,
        subtitle: r.buyerSubtitle,
        subtitleCoach: r.buyerSubtitleCoach,
        avatarUrl: r.avatarUrl,
        dealIds: [r.id],
        // Une vente annulée est sortie des chiffres : elle reste consultable
        // dans la fiche, mais ne compte plus dans les totaux de la ligne.
        contracted: r.status === 'canceled' ? 0 : r.amountTotal,
        collected: r.status === 'canceled' ? 0 : r.collected,
        status: etat,
        since: source?.signed_at ?? r.signedAt,
      });
      continue;
    }

    existant.dealIds.push(r.id);
    if (r.status !== 'canceled') {
      existant.contracted += r.amountTotal;
      existant.collected += r.collected;
    }
    existant.avatarUrl ??= r.avatarUrl;
    if (URGENCE.indexOf(etat) < URGENCE.indexOf(existant.status)) existant.status = etat;
    // « Client depuis » : la première vente, pas la dernière. Les deals arrivent
    // du plus récent au plus ancien, donc chaque nouveau croisé est plus vieux.
    const quand = source?.signed_at ?? r.signedAt;
    if (quand && quand < existant.since) existant.since = quand;
  }

  const people = [...parPersonne.values()]
    .sort((a, b) => URGENCE.indexOf(a.status) - URGENCE.indexOf(b.status)
      || (b.since ?? '').localeCompare(a.since ?? ''));

  // ── KPI du ruban ───────────────────────────────────────────────────────────
  // Contracté = tout ce qui a été signé. Collecté = ce qui est réellement encaissé.
  // Impayés = ce qu'un échec de prélèvement a laissé en suspens, pas le reste dû :
  // une échéance à venir n'est pas un impayé.
  //
  // ⚠️ DEUX corrections ici, toutes deux invisibles sur les données du jour.
  //
  // 1. LES VENTES ANNULÉES SORTENT DU RUBAN. Elles sortaient déjà de la liste par
  //    personne juste au-dessus (`contracted: r.status === 'canceled' ? 0 : …`),
  //    mais pas d'ici : le total du haut et la somme des lignes du bas
  //    divergeaient donc dès la première annulation, sur la même page. Même règle
  //    que l'onglet Revenus et que lib/dealCash.ts — « une vente annulée n'a pas
  //    été signée ».
  //
  // 2. LE COLLECTÉ EST PLAFONNÉ VENTE PAR VENTE (`collectedRetenu`). Sommer les
  //    nets bruts laissait le trop-perçu d'un client soustraire la dette d'un
  //    autre : deux ventes de 1 000 €, l'une payée 1 200 €, l'autre rien, et
  //    « Reste à encaisser » affichait 800 € au lieu de 1 000 € — sur l'écran qui
  //    sert à savoir qui relancer. Le taux pouvait aussi dépasser 100 %.
  //    La LIGNE d'un client, elle, continue d'afficher `collected`, ce qu'il a
  //    vraiment versé : c'est là qu'on va le rembourser.
  const actifs = rows.filter(r => r.status !== 'canceled');
  const contracted = actifs.reduce((s, r) => s + r.amountTotal, 0);
  const collected = actifs.reduce((s, r) => s + r.collectedRetenu, 0);
  const unpaid = actifs.reduce((s, r) => s + r.overdue, 0);

  const kpis = {
    contracted,
    collected,
    remaining: contracted - collected - unpaid,
    unpaid,
    dealsCount: actifs.length,
    collectedRate: contracted > 0 ? Math.round((collected / contracted) * 100) : 0,
    failedCount: actifs.filter(r => r.overdue > 0).length,
  };

  // ── Onglet « À rattacher » ─────────────────────────────────────────────────
  // Un paiement Stripe qu'aucun deal ne revendique : virement encaissé à la main,
  // lien créé dans le dashboard, deal antérieur à la fonctionnalité.
  const since = new Date(Date.now() - ORPHAN_LOOKBACK_DAYS * 86400_000).toISOString();

  const { data: allPayments } = await supa
    .from('stripe_payments')
    .select('payment_id, amount, currency, date, description, status, orphan_cause, subscription_id')
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

  // ── Les jumeaux ne font qu'une ligne ──────────────────────────────────────
  // Une transaction d'abonnement existe DEUX fois dans stripe_payments, sous son
  // id de facture (`in_…`) et sous celui de son PaymentIntent (`pi_…`), au même
  // montant et à la même seconde. Le filtre ci-dessus écarte déjà le jumeau d'un
  // paiement DÉJÀ rattaché — mais tant qu'aucun des deux ne l'est, les deux
  // s'affichent, et rien n'empêche de cliquer « Rattacher » sur l'un puis sur
  // l'autre avant que la liste se recharge. Le cash doublerait.
  //
  // S'appuyer sur le rechargement, c'est faire dépendre la justesse d'un chiffre
  // de la vitesse d'un aller-retour réseau. On regroupe donc à la source : une
  // seule carte par transaction, le double clic devient impossible plutôt que
  // rattrapé.
  //
  // La facture prime comme représentant : c'est l'objet que Stripe considère
  // comme le paiement de l'échéance, le PaymentIntent n'en étant que l'exécution.
  const parEmpreinte = new Map<string, typeof orphans>();
  for (const o of orphans) {
    const cle = o.date
      ? `${Number(o.amount)}@${new Date(o.date).toISOString().slice(0, 19)}`
      : o.payment_id;
    const liste = parEmpreinte.get(cle);
    if (liste) liste.push(o); else parEmpreinte.set(cle, [o]);
  }
  const orphansUniques = [...parEmpreinte.values()].map(groupe => {
    const principal = groupe.find(o => o.payment_id.startsWith('in_')) ?? groupe[0];
    return {
      ...principal,
      autresIdentifiants: groupe.filter(o => o.payment_id !== principal.payment_id)
        .map(o => o.payment_id),
    };
  });

  // ── Journal, une entrée par vente ──────────────────────────────────────────
  // Il vit DANS le bloc de sa vente sur la fiche : c'est de cette vente-là qu'il
  // parle. Chargé ici plutôt qu'à l'ouverture du panneau, pour que déplier une
  // section n'attende jamais le réseau.
  const dealIds = (deals ?? []).map((d: any) => d.id);
  const journalParDeal = new Map<string, any[]>();
  if (dealIds.length) {
    const { data: events } = await supa
      .from('deal_events')
      .select('id, deal_id, kind, label, created_at, meta')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false });
    for (const e of events ?? []) {
      const liste = journalParDeal.get(e.deal_id);
      if (liste) liste.push(e); else journalParDeal.set(e.deal_id, [e]);
    }
  }

  return NextResponse.json({
    profileId,
    stripeConnected,
    kpis,
    deals: rows,
    people,
    orphans: orphansUniques.map(o => ({
      paymentId: o.payment_id,
      // Le même encaissement vu sous un autre identifiant Stripe. Affiché, jamais
      // masqué : un élève qui retrouve `pi_…` dans son dashboard doit comprendre
      // pourquoi il n'a qu'une seule ligne ici.
      autresIdentifiants: o.autresIdentifiants,
      amount: Number(o.amount),
      currency: o.currency,
      date: o.date,
      description: o.description,
      // null n'est pas « aucune cause » : c'est « on ne sait pas ». Un orphelin
      // trop ancien pour que Stripe le serve encore n'en portera jamais.
      cause: o.orphan_cause ?? null,
      // L'abonnement d'où vient ce prélèvement, quand le filet a su le nommer.
      // ⚠️ Écrit dès qu'un abonnement a été vu sans permettre le rattachement —
      // PAS seulement sur la cause `abonnement_inconnu`. C'est donc lui, et non
      // la cause, qui décide si l'on peut proposer de relier l'abonnement : les
      // seules lignes qui en portent un aujourd'hui sont en `deal_supprime`.
      subscriptionId: o.subscription_id ?? null,
    })),
    // Détail par deal, pour le panneau latéral et l'échéancier déplié.
    details: Object.fromEntries((deals ?? []).map((d: any) => [d.id, {
      payments: (d.deal_payments ?? [])
        .sort((a: any, b: any) => (a.paid_at ?? '').localeCompare(b.paid_at ?? '')),
      installments: (d.deal_installments ?? [])
        .sort((a: any, b: any) => a.rank - b.rank)
        .map((i: any) => ({
          ...i,
          // Trois états d'étiquette sur la ligne : rien · envoyé · ouvert sans
          // payer. Le troisième vaut le deuxième : s'il l'a ouvert, il l'a reçu.
          clicks: i.shortio_link_id ? (clicsParLien.get(i.shortio_link_id) ?? 0) : 0,
          firstClickAt: i.shortio_link_id ? (premierClicParLien.get(i.shortio_link_id) ?? null) : null,
          // ⚠️ `shortio_link_id` NUL sur un lien qui existe n'est pas une erreur :
          // sans Short.io joignable, l'URL Stripe brute part telle quelle — on
          // encaisse, on perd seulement le suivi. L'écran doit alors dire qu'il
          // ne sait pas, et surtout pas « jamais ouvert » : un zéro affirmerait
          // quelque chose de faux.
          tracked: !!i.shortio_link_id,
        })),
      // Un comptant n'a pas d'échéance : son lien est porté par la vente.
      clicks: d.shortio_link_id ? (clicsParLien.get(d.shortio_link_id) ?? 0) : 0,
      firstClickAt: d.shortio_link_id ? (premierClicParLien.get(d.shortio_link_id) ?? null) : null,
      tracked: !!d.shortio_link_id,
      events: journalParDeal.get(d.id) ?? [],
    }])),
  });
}

/**
 * L'état à afficher, qui n'est pas toujours celui stocké : un paiement inattendu
 * et un litige se lisent sur d'autres colonnes, et priment sur le statut.
 */
function etatAffiche(r: DealRow): string {
  if (r.status === 'disputed') return 'disputed';
  if (r.unexpectedPaymentAt) return 'unexpected';
  if (r.status === 'open' && r.overdue > 0) return 'past_due';
  return r.status;
}

/**
 * Ce qui est dû à ce jour et n'est pas rentré.
 *
 * Deux sources, jamais additionnées : les échéances dont la date est passée
 * quand la vente en a, le reste à encaisser quand un prélèvement a échoué sans
 * qu'aucune échéance ne vive en base (comptant, prélèvement automatique).
 * Les cumuler compterait deux fois le même argent.
 */
function enRetard(d: {
  status: string; amount_total: number | string;
  deal_installments?: Array<{ amount: number | string; status: string; due_on: string | null }> | null;
}, encaisse: number, aEchoue: boolean): number {
  if (d.status !== 'open' && d.status !== 'past_due') return 0;

  // Une journée de marge : une échéance due aujourd'hui n'est pas en retard.
  const limite = Date.now() - 86400_000;
  const echeances = d.deal_installments ?? [];

  if (echeances.length > 0) {
    const somme = echeances
      .filter(i => i.status !== 'paid' && i.due_on && new Date(i.due_on).getTime() < limite)
      .reduce((s, i) => s + Number(i.amount), 0);
    return Math.round(somme * 100) / 100;
  }

  // Pas d'échéance en base : le comptant et le prélèvement automatique, dont
  // l'échéancier vit chez Stripe. Là, seul un prélèvement REFUSÉ dit qu'on
  // attendait de l'argent qui n'est pas venu — une date à venir ne se lit pas
  // d'ici, et supposer un retard sur une vente qui suit son cours en
  // inventerait un.
  if (!aEchoue) return 0;
  return Math.max(0, Math.round((Number(d.amount_total) - encaisse) * 100) / 100);
}
