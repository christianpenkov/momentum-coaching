import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { refreshDealStatus } from '@/lib/dealStatus';

/**
 * Point d'entrée de l'Edge Function sync-stripe-payments vers la VRAIE règle de
 * statut d'un deal (lib/dealStatus.ts) — celle qui désactive les liens de
 * paiement à l'annulation et pose le drapeau + la push « paiement sur vente
 * terminée ».
 *
 * Pourquoi une route et pas une copie Deno : la règle importe
 * `desactiverLiensDuDeal` (SDK Stripe + getStripeAccess) et `sendPushToProfile`
 * (web-push + clés VAPID de Vercel). En figer une copie Deno recréerait le mode
 * de panne dominant du projet — « deux copies, une seule à jour » — sur le
 * chemin de l'argent. Même architecture que cron-refresh-tokens et cron-health :
 * le code partagé reste côté Node, l'Edge Function le joint par HTTP.
 *
 * Auth : Bearer CRON_SECRET — appel machine à machine uniquement.
 * Idempotent : recalculer un statut déjà juste ne change rien, redésactiver un
 * lien inactif est un no-op, le drapeau unexpected_payment_at n'est posé qu'une
 * fois. Rejouer l'appel est toujours sans danger.
 */

const serviceSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: { dealId?: unknown; argentEntrant?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });
  }

  const dealId = typeof body.dealId === 'string' ? body.dealId : null;
  if (!dealId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId)) {
    return NextResponse.json({ error: 'dealId manquant ou invalide' }, { status: 400 });
  }

  try {
    await refreshDealStatus(serviceSupabase(), dealId, {
      argentEntrant: body.argentEntrant === true,
    });
  } catch (err) {
    // L'appelant (le cron) journalise ce 500 dans cron_runs — c'est lui qui
    // porte la visibilité de l'échec, pas cette route.
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
