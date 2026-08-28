import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeAccess, resolveTargetProfile } from '@/lib/stripe-account';
import { desactiverLiensDuDeal } from '@/lib/stripe-payment-links';
import { calculerCash, type LignePaiement } from '@/lib/dealCash';

/**
 * Clôturer une vente, ou la rouvrir.
 *
 * POST   /api/payments/deals/[id]/end   { reason?: string }
 * DELETE /api/payments/deals/[id]/end   → réouverture
 *
 * ── Ce que « clôturer » veut dire ──────────────────────────────────────────
 * « Je n'attends plus rien sur cette vente. » C'est le cas quand
 * l'accompagnement s'arrête en cours de route et que le client ne paiera pas la
 * suite. L'argent déjà versé reste acquis et reste compté ; ce qui manque ne sera
 * jamais réclamé ; la vente sort des relances.
 *
 * À ne pas confondre avec ANNULER, qui efface la vente des chiffres et suppose
 * un remboursement.
 *
 * ── Pourquoi c'est réversible et sans case à cocher ────────────────────────
 * Clôturer ne touche à aucun argent et à rien chez Stripe, hormis la
 * désactivation d'un lien — elle-même réversible. C'est une étiquette, pas une
 * opération. La rendre solennelle banaliserait les cases qui protègent, elles,
 * de l'irréversible.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function chargerVente(userId: string, dealId: string) {
  const { data: deal } = await supa
    .from('deals')
    .select(`id, profile_id, status, amount_total, buyer_name, stripe_subscription_id,
             ended_by, deal_payments(amount, status),
             deal_installments(id, status)`)
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return { erreur: NextResponse.json({ error: 'Vente introuvable' }, { status: 404 }) };

  const allowed = await resolveTargetProfile(userId, deal.profile_id);
  if (!allowed) return { erreur: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) };

  return { deal };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: dealId } = await params;
  const { deal, erreur } = await chargerVente(user.id, dealId);
  if (erreur) return erreur;

  const body = await request.json().catch(() => ({}));
  const raison = typeof body?.reason === 'string' ? body.reason.slice(0, 500).trim() : null;

  // ── Des prélèvements tournent encore ────────────────────────────────────────
  // Clôturer ici afficherait une vente « terminée » que Stripe continue de
  // prélever tous les mois. Seul l'élève peut les arrêter — et une fois qu'il
  // l'a fait, Momentum clôture tout seul en recevant l'événement.
  //
  // Les deux boutons se rejoignent donc sur ce mode, et l'écran le dit plutôt que
  // de faire semblant d'agir.
  if (deal!.stripe_subscription_id && deal!.status !== 'ended') {
    const access = await getStripeAccess(deal!.profile_id);
    let actif = true;
    if (access) {
      try {
        const sub = await access.stripe.subscriptions.retrieve(
          deal!.stripe_subscription_id, undefined, access.opts);
        actif = sub.status !== 'canceled';
      } catch {
        // Stripe injoignable : on suppose actif, plutôt que de clôturer une vente
        // qui prélèverait encore.
        actif = true;
      }
    }
    if (actif) {
      return NextResponse.json({
        error: 'Cette vente a des prélèvements en cours. Arrête-les d’abord dans Stripe — le bouton s’y appelle « Annuler l’abonnement ». Momentum clôturera la vente automatiquement dès qu’il l’aura constaté.',
        code: 'prelevement_actif',
        subscriptionId: deal!.stripe_subscription_id,
      }, { status: 409 });
    }
  }

  const cash = calculerCash(deal!.deal_payments as LignePaiement[]);

  await supa.from('deals').update({
    status: 'ended',
    ended_by: 'user',
    ended_at: new Date().toISOString(),
    ended_reason: raison,
  }).eq('id', dealId);

  // Le lien d'une échéance qui ne sera jamais réclamée n'a plus lieu d'être
  // payable : sans ça, un client qui le retrouve dans sa conversation paierait
  // une vente que l'élève considère close.
  const { desactives } = await desactiverLiensDuDeal(supa, dealId, deal!.profile_id);

  await supa.from('deal_events').insert({
    deal_id: dealId,
    kind: 'ended',
    label: raison
      ? `Vente clôturée — ${raison}`
      : 'Vente clôturée',
    actor_id: user.id,
    meta: { encaisse: cash.net, prevu: Number(deal!.amount_total), liens_desactives: desactives },
  });

  return NextResponse.json({
    ok: true,
    encaisse: cash.net,
    prevu: Number(deal!.amount_total),
    liensDesactives: desactives,
  });
}

/**
 * Réouvrir une vente clôturée.
 *
 * Un clic, sans confirmation : rien n'a bougé chez Stripe à la clôture, hormis
 * des liens désactivés. Les échéances non payées reviennent dans les relances.
 *
 * ⚠️ Les liens NE sont PAS réactivés automatiquement. Un lien remis en service à
 * l'insu de l'élève rendrait payable une somme qu'il n'attend peut-être plus au
 * même montant — c'est à lui de renvoyer un lien s'il en veut un.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id: dealId } = await params;
  const { deal, erreur } = await chargerVente(user.id, dealId);
  if (erreur) return erreur;

  if (deal!.status !== 'ended') {
    return NextResponse.json({
      error: "Cette vente n'est pas clôturée.",
      code: 'pas_cloturee',
    }, { status: 409 });
  }

  // Une vente arrêtée par Stripe ne se rouvre pas d'un clic : les prélèvements
  // sont annulés chez lui, et un abonnement annulé ne se réactive jamais. La
  // rouvrir ici afficherait une vente en attente d'un argent qui ne viendra pas.
  if (deal!.ended_by === 'stripe') {
    return NextResponse.json({
      error: "Les prélèvements de cette vente ont été arrêtés chez Stripe, et un prélèvement annulé ne se réactive pas. Pour reprendre les paiements, crée une nouvelle vente.",
      code: 'arret_stripe',
    }, { status: 409 });
  }

  const cash = calculerCash(deal!.deal_payments as LignePaiement[]);

  await supa.from('deals').update({
    status: cash.net >= Number(deal!.amount_total) - 0.01 ? 'paid' : 'open',
    ended_by: null,
    ended_at: null,
    ended_reason: null,
    unexpected_payment_at: null,
  }).eq('id', dealId);

  await supa.from('deal_events').insert({
    deal_id: dealId,
    kind: 'reopened',
    label: 'Vente rouverte',
    actor_id: user.id,
    meta: { encaisse: cash.net },
  });

  return NextResponse.json({ ok: true });
}
