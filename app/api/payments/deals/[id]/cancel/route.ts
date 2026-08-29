import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeAccess, appelStripe, resolveTargetProfile } from '@/lib/stripe-account';
import { desactiverLiensDuDeal } from '@/lib/stripe-payment-links';
import { calculerCash, type LignePaiement } from '@/lib/dealCash';

/**
 * Annuler une vente.
 *
 * POST /api/payments/deals/[id]/cancel   { confirmed: true, refundDeclared?: number }
 *
 * ── Ce que ça fait aux chiffres ────────────────────────────────────────────
 * Annuler EFFACE la vente : elle sort du cash contracté ET du cash encaissé, et
 * l'appel cesse de compter comme une vente conclue. C'est la seule action qui
 * retire du contracté — clôturer, elle, garde tout et arrête simplement d'attendre.
 *
 * ── Pourquoi de l'argent encaissé bloque ───────────────────────────────────
 * Faire disparaître des chiffres une vente dont l'argent est encore sur le compte
 * de l'élève rendrait le cash faux dans l'autre sens. Tant que le remboursement
 * n'est pas constaté — ou déclaré, hors Stripe — la vente reste en attente
 * d'annulation, et l'élève peut fermer l'écran et revenir.
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
  const body = await request.json().catch(() => ({}));

  // La case à cocher n'est pas décorative : elle est la trace, dans le journal,
  // que l'élève a lu ce qu'il engageait. Une annulation retire de l'argent des
  // statistiques — c'est l'une des rares actions vraiment irréversibles.
  if (body?.confirmed !== true) {
    return NextResponse.json({
      error: 'Cette action doit être confirmée.',
      code: 'confirmation_requise',
    }, { status: 400 });
  }

  const { data: deal } = await supa
    .from('deals')
    .select(`id, profile_id, status, amount_total, buyer_name, call_id,
             stripe_subscription_id, deal_payments(amount, status)`)
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });

  const allowed = await resolveTargetProfile(user.id, deal.profile_id);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  if (deal.status === 'canceled') {
    return NextResponse.json({ ok: true, deja: true });
  }

  const cash = calculerCash(deal.deal_payments as LignePaiement[]);

  // ── Les liens meurent tout de suite, quoi qu'il arrive ─────────────────────
  // Même si le remboursement reste à faire : un lien encore payable pendant
  // qu'on annule est précisément ce qui crée le paiement inattendu de demain.
  const { desactives } = await desactiverLiensDuDeal(supa, dealId, deal.profile_id);

  // ── De l'argent est encore là ──────────────────────────────────────────────
  if (cash.net > CENTIME) {
    const prelevementActif = await prelevementEnCours(deal.profile_id, deal.stripe_subscription_id);

    await supa.from('deal_events').insert({
      deal_id: dealId,
      kind: 'canceled',
      label: `Annulation demandée — ${fmt(cash.net)} à rembourser`,
      actor_id: user.id,
      meta: { aRembourser: cash.net, liens_desactives: desactives, prelevementActif },
    });

    return NextResponse.json({
      ok: false,
      enAttenteRemboursement: true,
      aRembourser: cash.net,
      arretRequis: prelevementActif,
      liensDesactives: desactives,
      message: prelevementActif
        ? `Arrête d’abord les prélèvements dans Stripe, puis rembourse ${fmt(cash.net)} à ${deal.buyer_name}. La vente sera annulée dès que Momentum l’aura constaté.`
        : `Rembourse ${fmt(cash.net)} à ${deal.buyer_name}. La vente sera annulée dès que Momentum l’aura constaté.`,
    }, { status: 409 });
  }

  // ── Rien à rembourser : l'annulation est immédiate ─────────────────────────
  await supa.from('deals').update({
    status: 'canceled',
    ended_at: new Date().toISOString(),
  }).eq('id', dealId);

  // Les échéances à venir n'ont plus d'objet. Celles déjà payées restent, pour
  // que l'historique reste lisible.
  await supa.from('deal_installments').delete().eq('deal_id', dealId).neq('status', 'paid');

  // ── L'appel cesse de compter comme une vente conclue ───────────────────────
  // C'est ici, et seulement ici, qu'un appel est déclassé : sur un geste
  // explicite. Un remboursement fait dans Stripe n'y touche jamais — il dit
  // qu'un mouvement d'argent a eu lieu, pas que la vente n'a pas eu lieu.
  //
  // `outcome` passe en « perdu » sans objection : le kanban lit ce champ pour
  // décider de la colonne, et une vente annulée après coup n'a pas d'objection
  // à consigner.
  if (deal.call_id) {
    await supa.from('calls').update({
      deal_closed: false,
      revenue: 0,
      outcome: 'lost',
    }).eq('id', deal.call_id);
  }

  await supa.from('deal_events').insert({
    deal_id: dealId,
    kind: 'canceled',
    label: 'Vente annulée',
    actor_id: user.id,
    meta: { contracte: Number(deal.amount_total), liens_desactives: desactives },
  });

  return NextResponse.json({
    ok: true,
    liensDesactives: desactives,
    contracteRetire: Number(deal.amount_total),
    appelDeclasse: !!deal.call_id,
  });
}

/**
 * Un prélèvement tourne-t-il encore ? Renvoie `true` par prudence si Stripe est
 * injoignable : annoncer « rien à arrêter » à tort laisserait le client prélevé.
 */
async function prelevementEnCours(profileId: string, subscriptionId: string | null): Promise<boolean> {
  if (!subscriptionId) return false;
  const access = await getStripeAccess(profileId);
  if (!access) return true;
  try {
    const sub = await appelStripe(access, () =>
      access.stripe.subscriptions.retrieve(subscriptionId, undefined, access.opts));
    return sub.status !== 'canceled';
  } catch {
    return true;
  }
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
