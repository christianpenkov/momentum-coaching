import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeAccess, resolveTargetProfile } from '@/lib/stripe-account';
import { createDealPaymentLink } from '@/lib/stripe-payment-links';
import { calculerCash, resteAEncaisser, type LignePaiement } from '@/lib/dealCash';

/**
 * Réclamer un remboursement qui était une erreur.
 *
 * ── Le trou que ça bouche ──────────────────────────────────────────────────
 * Une vente soldée puis remboursée en partie RESTE soldée : un remboursement dit
 * qu'un mouvement d'argent a eu lieu, jamais pourquoi. Geste commercial,
 * rétractation, erreur de saisie — trois raisons courantes, deux conclusions
 * opposées, et Momentum ne peut pas trancher. Le défaut prudent est donc de ne
 * rien réclamer : relancer quelqu'un sur l'argent qu'on vient de lui rendre est
 * la pire chose que la plateforme puisse faire à la place de l'élève.
 *
 * Mais le troisième cas — le remboursement parti par erreur — n'avait AUCUN
 * chemin, et les trois contournements faussaient chacun un chiffre :
 *
 *   · rouvrir « Montant » et retaper le même montant → bouton inactif, rien ne
 *     change (la modification exige un montant différent) ;
 *   · monter le montant de la vente → gonfle le cash contracté d'une somme qui
 *     n'a jamais été vendue ;
 *   · créer un lien à part → fabrique une SECONDE vente, et le contracté double.
 *
 * D'où cette route : elle ne touche NI au montant de la vente, NI à l'encaissé.
 * Elle dit seulement « cet argent est toujours dû », ce que seul l'élève sait.
 *
 * ── Ce qu'elle change vraiment ─────────────────────────────────────────────
 * Le statut repasse `open`, donc la vente rentre dans les relances — c'est le
 * point qui engage, et l'écran le dit avant de valider. Et elle crée de quoi
 * encaisser : un lien, ou une échéance à déclarer si c'est hors Stripe.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const CENTIME = 0.01;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: dealId } = await params;
  const body = await request.json().catch(() => null);
  const parLien = body?.encaissement !== 'offline';

  const { data: deal } = await supa
    .from('deals')
    .select(`id, profile_id, status, amount_total, buyer_name, currency,
             ig_lead_id, first_touch_content_id,
             deal_payments(amount, status),
             deal_installments(id, rank, status)`)
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });

  const allowed = await resolveTargetProfile(user.id, deal.profile_id);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const cash = calculerCash((deal.deal_payments ?? []) as LignePaiement[]);
  const reste = resteAEncaisser(cash, deal.amount_total);

  // ── Les deux refus ────────────────────────────────────────────────────────
  // Ils ne sont pas décoratifs : sans eux, un double clic ou un onglet resté
  // ouvert créerait un second lien pour le même argent.
  // ⚠️ L'invariant qui empêche le doublon, c'est le STATUT, pas le reste dû.
  // Réclamer ne fait entrer aucun argent : après un premier appel, le reste vaut
  // toujours 200 €, et un second passage créerait une deuxième échéance pour la
  // même somme. Seule une vente SOLDÉE peut être réclamée — et la réclamation la
  // fait sortir de cet état, donc elle ne peut jouer qu'une fois. Deux onglets
  // ouverts sur la même vente ne peuvent plus doubler la dette.
  if (deal.status !== 'paid') {
    return NextResponse.json({
      error: 'Cette vente n’est pas soldée : le remboursement a déjà été réclamé, ou la vente a changé depuis.',
      code: 'deja_reclame',
    }, { status: 409 });
  }
  if (cash.rembourse <= CENTIME) {
    return NextResponse.json({
      error: 'Aucun remboursement sur cette vente : il n’y a rien à réclamer.',
      code: 'pas_de_remboursement',
    }, { status: 409 });
  }
  if (reste <= CENTIME) {
    return NextResponse.json({
      error: 'Cette vente n’attend plus d’argent. Le remboursement a déjà été réclamé, ou le montant a été ajusté depuis.',
      code: 'rien_a_reclamer',
    }, { status: 409 });
  }

  const access = await getStripeAccess(deal.profile_id);
  if (parLien && !access) {
    return NextResponse.json({
      error: 'Stripe n’est pas connecté : aucun lien ne peut être créé. Choisis « hors Stripe » pour encaisser toi-même.',
      code: 'stripe_absent',
    }, { status: 502 });
  }

  // ── Stripe d'abord, la base ensuite ──────────────────────────────────────
  // Même ordre que partout ailleurs dans ce chantier : si la création du lien
  // échoue, la vente ne doit surtout pas être repassée « en cours » avec de quoi
  // relancer un client sans qu'aucun moyen de payer n'existe.
  let lien: { url: string } | null = null;
  const echeances = (deal.deal_installments ?? []) as { rank: number }[];
  const rang = echeances.reduce((m, e) => Math.max(m, e.rank), 0) + 1;

  if (parLien) {
    const cree = await createDealPaymentLink({
      profileId: deal.profile_id,
      dealId,
      amount: reste,
      productName: `Complément — ${deal.buyer_name}`,
      leadId: deal.ig_lead_id,
      contentId: deal.first_touch_content_id,
    }, access!);
    lien = { url: cree.url };

    // Le lien vit sur l'ÉCHÉANCE et non sur la vente : celle de la vente porte
    // encore le lien d'origine, déjà payé, qu'on ne veut pas écraser — c'est la
    // trace de l'encaissement initial.
    await supa.from('deal_installments').insert({
      deal_id: dealId,
      rank: rang,
      amount: reste,
      due_on: new Date().toISOString().slice(0, 10),
      status: 'pending',
      stripe_payment_link_id: cree.paymentLinkId,
      short_url: cree.url,
      stripe_url: cree.stripeUrl,
      shortio_link_id: cree.shortioId,
    });
  } else {
    // Hors Stripe : une ligne quand même, sinon le virement à venir n'aurait nulle
    // part où être déclaré et la somme resterait invisible.
    await supa.from('deal_installments').insert({
      deal_id: dealId,
      rank: rang,
      amount: reste,
      due_on: new Date().toISOString().slice(0, 10),
      status: 'pending',
    });
  }

  // Le statut EN DERNIER : tout ce qui pouvait échouer est passé.
  //
  // `open` et non un recalcul par `statutDeal` : celle-ci renverrait `paid`, à
  // cause de la règle même qu'on est en train de contredire volontairement
  // (« déjà soldé + net > 0 → reste soldé »). Une fois `open` posé, les recalculs
  // suivants la laissent en place — la règle ne s'applique qu'à un deal `paid`.
  await supa.from('deals').update({ status: 'open' }).eq('id', dealId);

  await supa.from('deal_events').insert({
    deal_id: dealId,
    kind: 'terms_changed',
    label: `Remboursement réclamé · ${fmt(reste)} de nouveau à encaisser`,
    actor_id: user.id,
    meta: { rembourse: cash.rembourse, reste, encaissement: parLien ? 'lien' : 'offline' },
  });

  return NextResponse.json({ ok: true, reste, lien });
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
