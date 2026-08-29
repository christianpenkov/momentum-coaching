import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeAccess, appelStripe, resolveTargetProfile } from '@/lib/stripe-account';

/**
 * Échéancier réel d'un deal en prélèvement automatique, lu chez Stripe.
 *
 * En mode automatique, Momentum ne détient PAS l'échéancier : c'est Stripe qui
 * porte les dates et le bornage (voir deal_installments, qui n'existe que pour
 * le mode manuel). Les dupliquer en base créerait deux sources de vérité qui
 * divergent dès qu'un client paie en avance ou renégocie.
 *
 * D'où cette lecture à la demande, uniquement quand le panneau d'un deal
 * automatique est ouvert.
 *
 * Vocabulaire : jamais « abonnement » côté élève. Techniquement c'en est un,
 * mais ce que vend le coach est un accompagnement payé en plusieurs fois —
 * appeler ça un abonnement laisserait croire à un renouvellement sans fin,
 * exactement ce que le bornage empêche.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const dealId = new URL(request.url).searchParams.get('dealId');
  if (!dealId) return NextResponse.json({ error: 'dealId requis' }, { status: 400 });

  const { data: deal } = await supa
    .from('deals')
    .select('id, profile_id, stripe_subscription_id, installments_count, amount_total')
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Deal introuvable' }, { status: 404 });

  const allowed = await resolveTargetProfile(user.id, deal.profile_id);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  if (!deal.stripe_subscription_id) {
    return NextResponse.json({ schedule: null });
  }

  const access = await getStripeAccess(deal.profile_id);
  if (!access) return NextResponse.json({ schedule: null });

  try {
    const sub = await appelStripe(access, () => access.stripe.subscriptions.retrieve(
      deal.stripe_subscription_id,
      undefined,
      access.opts,
    ));

    // `cancel_at` porte la fin du bornage posé par ensureInstallmentSchedule.
    // Son absence signifie que le bornage n'a pas pris — l'information doit
    // remonter telle quelle plutôt que d'être masquée : un prélèvement sans
    // fin est précisément ce qu'on veut pouvoir repérer.
    const item = sub.items?.data?.[0];

    // ── Où vit la date du prochain prélèvement ──────────────────────────────
    // Stripe l'a DÉPLACÉE de la subscription vers ses items. Le SDK est épinglé
    // sur `2026-04-22.dahlia`, où `sub.current_period_end` n'existe tout
    // simplement plus : la lecture renvoyait `undefined` sans lever d'erreur, et
    // l'écran affichait « date à confirmer » sur des prélèvements dont Stripe
    // connaît parfaitement la date.
    //
    // Vérifié sur le compte connecté : en `2025-02-24.acacia` les deux champs
    // existent, en `dahlia` seul celui de l'item. On lit donc l'item d'abord, la
    // subscription en repli — ce qui tient dans les deux sens si la version
    // épinglée redescend un jour.
    const prochain = (item as { current_period_end?: number } | undefined)?.current_period_end
      ?? (sub as { current_period_end?: number }).current_period_end
      ?? null;

    return NextResponse.json({
      schedule: {
        status: sub.status,
        perPayment: item ? (item.price.unit_amount ?? 0) / 100 : null,
        interval: item?.price.recurring?.interval ?? null,
        nextPaymentAt: prochain ? new Date(prochain * 1000).toISOString() : null,
        endsAt: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
        bounded: !!sub.cancel_at,
        totalCount: deal.installments_count,
      },
    });
  } catch {
    // Stripe indisponible : le panneau affiche simplement le bloc sans détail,
    // plutôt que de faire échouer l'ouverture du deal.
    return NextResponse.json({ schedule: null });
  }
}
