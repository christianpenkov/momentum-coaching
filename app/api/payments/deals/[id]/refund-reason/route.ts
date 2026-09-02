import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeAccess, resolveTargetProfile } from '@/lib/stripe-account';
import { createDealPaymentLink } from '@/lib/stripe-payment-links';
import { calculerCash, statutDeal, type LignePaiement } from '@/lib/dealCash';

/**
 * Pourquoi un remboursement a eu lieu — et ce que ça change.
 *
 * ── Le problème ────────────────────────────────────────────────────────────
 * Momentum ne rembourse jamais : l'élève le fait dans Stripe, le webhook le
 * constate. Il enregistre donc un mouvement d'argent sans jamais savoir POURQUOI
 * il a eu lieu — alors que c'est cette raison, et elle seule, qui décide si le
 * client doit encore quelque chose.
 *
 *   geste commercial · rétractation → l'argent n'est plus dû
 *   erreur de saisie                → l'argent est toujours dû
 *
 * Faute de le demander, la vente affichait « Soldée » à côté de « 80 % encaissé »
 * sans que rien ne relie les deux, et on lisait « il me manque 200 € ».
 *
 * ── Ce que chaque réponse fait ─────────────────────────────────────────────
 * **L'argent n'est plus dû** → le montant de la vente BAISSE d'autant. Une remise
 * accordée après coup est un prix plus bas : la vente valait 1 000 €, elle en vaut
 * 800, et elle est soldée à 100 %. C'est la seule lecture où chaque chiffre
 * affiché est vrai sans note de bas de page — le ratio encaissé/contracté reste
 * un vrai ratio, et le panier moyen reflète ce qui est réellement rentré.
 * Les 1 000 € d'origine ne sont pas perdus : ils vivent au journal de la vente.
 *
 * **L'argent est toujours dû** → le montant ne bouge pas, la vente repasse en
 * cours, et de quoi encaisser est créé (lien, ou échéance à déclarer hors Stripe).
 * C'est le seul cas qui relance le client, et l'écran le dit avant de valider.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const CENTIME = 0.01;

/** Les raisons qui laissent l'argent dû. Une seule aujourd'hui, mais nommée. */
const ENCORE_DU = new Set(['erreur']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: dealId } = await params;
  const body = await request.json().catch(() => null);

  const raison = String(body?.raison ?? '');
  if (!['geste_commercial', 'retractation', 'erreur', 'autre'].includes(raison)) {
    return NextResponse.json({ error: 'Raison inconnue' }, { status: 400 });
  }

  // « Autre » ne dit rien du sort de l'argent : c'est l'écran qui a posé la
  // question, et la réponse arrive ici. Les autres raisons portent le sort
  // en elles, on ne se fie donc pas au client pour ce qu'on sait déjà.
  const encoreDu = raison === 'autre' ? body?.encoreDu === true : ENCORE_DU.has(raison);
  const parLien = body?.encaissement !== 'offline';

  const { data: deal } = await supa
    .from('deals')
    .select(`id, profile_id, status, amount_total, buyer_name, currency, refund_explique,
             ig_lead_id, first_touch_content_id,
             deal_payments(id, stripe_payment_id, amount, status, refund_reason),
             deal_installments(rank)`)
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });

  const allowed = await resolveTargetProfile(user.id, deal.profile_id);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  type Ligne = { id: string; stripe_payment_id: string; amount: number | string; status: string; refund_reason: string | null };
  const lignes = (deal.deal_payments ?? []) as Ligne[];
  const cash = calculerCash(lignes as unknown as LignePaiement[]);

  // ── Ce qu'on explique, c'est l'ÉCART, pas une transaction ────────────────
  // Une première version demandait la raison d'UNE ligne de remboursement. Deux
  // situations la mettaient en défaut :
  //
  //  · un remboursement de trop-perçu porte bien une ligne `refunded`, mais
  //    n'appelle aucune explication — il ramène l'encaissé au montant de la
  //    vente, sans créer le moindre écart. On demandait donc une raison pour un
  //    fait déjà expliqué, et répondre « geste commercial » aurait baissé le
  //    montant une SECONDE fois ;
  //  · après un trop-perçu remboursé PUIS un geste commercial, deux lignes sont
  //    sans raison. Prendre « la première » désignait la mauvaise.
  //
  // Le cumul déjà expliqué règle les deux : l'écart vaut « tout ce qui a été
  // remboursé » moins « ce qui a déjà été justifié ».
  const dejaExplique = Number(deal.refund_explique ?? 0);
  const montantRembourse = Math.round((cash.rembourse - dejaExplique) * 100) / 100;

  if (montantRembourse <= CENTIME) {
    return NextResponse.json({
      error: 'Tous les remboursements de cette vente sont déjà expliqués.',
      code: 'deja_explique',
    }, { status: 409 });
  }

  // La raison va sur TOUTES les lignes encore muettes : c'est ce bloc-là qu'on
  // vient de justifier, et le badge de la fiche les lit toutes.
  const note = raison === 'autre' ? String(body?.note ?? '').slice(0, 300) || null : null;
  for (const l of lignes.filter(p => p.status === 'refunded' && !p.refund_reason)) {
    await supa.from('deal_payments')
      .update({ refund_reason: raison, refund_reason_note: note })
      .eq('id', l.id);
  }

  // ── L'argent n'est plus dû : la vente vaut moins ──────────────────────────
  if (!encoreDu) {
    const avant = Number(deal.amount_total);
    const apres = Math.max(0, Math.round((avant - montantRembourse) * 100) / 100);

    // ⚠️ Le statut se RECALCULE, il ne se décrète pas. Le forcer à `paid` était
    // juste sur une vente déjà soldée et faux partout ailleurs : sur une vente
    // en cours remboursée en partie (1 000 € vendus, 300 € encaissés, 100 €
    // rendus), baisser le montant à 900 € ne la solde évidemment pas — elle
    // aurait été affichée « Soldée » avec 200 € encaissés sur 900.
    const statut = statutDeal(cash, apres, deal.status) ?? deal.status;

    // ── Baisser le montant ne dit RIEN du reste ──────────────────────────
    // Sur une vente encore en cours, rendre 100 € ne répond pas à « est-ce que
    // j'attends encore les 700 qui restent ? ». Une rétractation partielle en
    // pleine série d'échéances peut vouloir dire deux choses opposées : le
    // plan continue à un montant plus bas, ou l'accompagnement s'arrête là.
    //
    // Sans la question, le second cas laissait la vente en cours et relançait le
    // client pour un accompagnement auquel il venait de renoncer.
    //
    // La question ne se pose PAS sur une vente soldée : il n'y a plus rien à ne
    // plus attendre — c'est déjà pourquoi « Clôturer » y est masqué.
    const resteApres = Math.round((apres - cash.net) * 100) / 100;
    const cloture = body?.cloturer === true && resteApres > CENTIME;

    await supa.from('deals').update({
      amount_total: apres,
      status: cloture ? 'ended' : statut,
      refund_explique: cash.rembourse,
      ...(cloture ? {
        ended_by: 'user',
        ended_at: new Date().toISOString(),
        ended_reason: libelle(raison),
      } : {}),
    }).eq('id', dealId);

    await supa.from('deal_events').insert({
      deal_id: dealId,
      kind: 'amount_changed',
      label: `${libelle(raison)} · ${fmt(avant)} → ${fmt(apres)}`,
      actor_id: user.id,
      meta: { avant, apres, rembourse: montantRembourse, raison },
    });

    return NextResponse.json({ ok: true, encoreDu: false, avant, apres, cloture, lien: null });
  }

  // ── L'argent est toujours dû : la vente repart ────────────────────────────
  const access = await getStripeAccess(deal.profile_id);
  if (parLien && !access) {
    return NextResponse.json({
      error: 'Stripe n’est pas connecté : aucun lien ne peut être créé. Choisis « hors Stripe » pour encaisser toi-même.',
      code: 'stripe_absent',
    }, { status: 502 });
  }

  const rang = ((deal.deal_installments ?? []) as { rank: number }[])
    .reduce((m, e) => Math.max(m, e.rank), 0) + 1;

  // Stripe d'abord : si le lien échoue, la vente ne doit pas repasser en cours
  // avec de quoi relancer un client sans aucun moyen de payer.
  let lien: { url: string } | null = null;
  const ligneEcheance: Record<string, unknown> = {
    deal_id: dealId,
    rank: rang,
    amount: montantRembourse,
    due_on: new Date().toISOString().slice(0, 10),
    status: 'pending',
  };

  if (parLien) {
    const cree = await createDealPaymentLink({
      profileId: deal.profile_id,
      dealId,
      amount: montantRembourse,
      productName: `Complément — ${deal.buyer_name}`,
      leadId: deal.ig_lead_id,
      contentId: deal.first_touch_content_id,
    }, access!);
    lien = { url: cree.url };
    // Le lien vit sur l'ÉCHÉANCE : celui de la vente porte encore le paiement
    // d'origine, déjà encaissé, qu'on ne veut pas écraser.
    ligneEcheance.stripe_payment_link_id = cree.paymentLinkId;
    ligneEcheance.short_url = cree.url;
    ligneEcheance.stripe_url = cree.stripeUrl;
    ligneEcheance.shortio_link_id = cree.shortioId;
  }

  await supa.from('deal_installments').insert(ligneEcheance);

  // `open` posé à la main, et non recalculé : `statutDeal` renverrait `paid` à
  // cause de la règle qu'on contredit ici volontairement (« déjà soldé + net > 0
  // → reste soldé »). Une fois `open` posé, elle ne s'applique plus.
  await supa.from('deals').update({
    status: 'open', refund_explique: cash.rembourse,
  }).eq('id', dealId);

  await supa.from('deal_events').insert({
    deal_id: dealId,
    kind: 'terms_changed',
    label: `Remboursement déclaré par erreur · ${fmt(montantRembourse)} de nouveau à encaisser`,
    actor_id: user.id,
    meta: { rembourse: montantRembourse, raison, encaissement: parLien ? 'lien' : 'offline' },
  });

  return NextResponse.json({ ok: true, encoreDu: true, montant: montantRembourse, lien });
}

function libelle(raison: string): string {
  return raison === 'geste_commercial' ? 'Geste commercial'
    : raison === 'retractation' ? 'Rétractation partielle'
    : 'Montant revu';
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
