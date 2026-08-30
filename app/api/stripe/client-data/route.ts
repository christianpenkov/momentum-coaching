import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getStripeAccess, appelStripe } from '@/lib/stripe-account';

const serviceSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  // Si profileId fourni (coach qui consulte un client) — vérifier que le coach possède ce client
  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  try {
    // getStripeAccess résout les DEUX chemins de connexion : OAuth Connect
    // (access_token + acct_xxx) et clé API restreinte. Cette route ne lisait que
    // `api_key` et renvoyait no_key à tout compte branché en OAuth, alors que
    // c'est le chemin nominal depuis l'ajout de Connect.
    //
    // ⚠️ L'appel était AVANT le try. `new Stripe(process.env.STRIPE_SECRET_KEY!)` lève
    // quand la variable est absente, et l'exception remontait donc en 500 sans corps,
    // indiscernable pour l'appelant d'un « compte non connecté ». Reproduit le
    // 2026-08-30 sur un environnement où la clé était vide.
    const access = await getStripeAccess(targetProfileId);
    if (!access) {
      return NextResponse.json({ error: 'no_key' }, { status: 404 });
    }

    const { stripe, opts } = access;

    // `opts` porte le Stripe-Account en mode OAuth : sans lui, ces appels
    // interrogeraient le compte de la plateforme au lieu de celui de l'élève.
    //
    // appelStripe : passage obligé qui déclare la panne dans `integrations` (voir
    // lib/stripe-account.ts, « tout appel Stripe passe par ici »). Cette route était la
    // seule à l'ignorer, donc ses pannes ne marquaient jamais l'intégration.
    const [subscriptions, charges, balance] = await appelStripe(access, () => Promise.all([
      stripe.subscriptions.list({ limit: 100, status: 'active', expand: ['data.items.data.price'] }, opts),
      stripe.charges.list({ limit: 50 }, opts),
      stripe.balance.retrieve({}, opts),
    ]));

    let mrr = 0;
    for (const sub of subscriptions.data) {
      for (const item of sub.items.data) {
        const price = item.price;
        const amount = (price.unit_amount || 0) / 100;
        if (price.recurring?.interval === 'year') mrr += amount / 12;
        else if (price.recurring?.interval === 'week') mrr += amount * 4.33;
        else mrr += amount;
      }
    }

    const recentPayments = charges.data
      .filter(c => c.paid && !c.refunded)
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        amount: c.amount / 100,
        currency: c.currency,
        description: c.description || c.billing_details?.name || 'Paiement',
        date: new Date(c.created * 1000).toISOString(),
        status: c.status,
      }));

    const startOfMonth = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
    const monthlyCharges = charges.data.filter(c => c.paid && !c.refunded && c.created >= startOfMonth);
    const monthlyRevenue = monthlyCharges.reduce((sum, c) => sum + c.amount / 100, 0);
    const availableBalance = balance.available.reduce((sum, b) => sum + b.amount / 100, 0);

    return NextResponse.json({
      mrr: Math.round(mrr * 100) / 100,
      monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
      activeSubscriptions: subscriptions.data.length,
      availableBalance: Math.round(availableBalance * 100) / 100,
      recentPayments,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur Stripe';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
