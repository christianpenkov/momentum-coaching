import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  // Récupère la clé Stripe du client
  const { data: integration } = await supabase
    .from('integrations')
    .select('api_key')
    .eq('profile_id', user.id)
    .eq('provider', 'stripe')
    .single();

  if (!integration?.api_key) {
    return NextResponse.json({ error: 'no_key' }, { status: 404 });
  }

  try {
    const stripe = new Stripe(integration.api_key, { apiVersion: '2026-04-22.dahlia' });

    // Récupère les données en parallèle
    const [subscriptions, charges, balance] = await Promise.all([
      stripe.subscriptions.list({ limit: 100, status: 'active', expand: ['data.items.data.price'] }),
      stripe.charges.list({ limit: 50 }),
      stripe.balance.retrieve(),
    ]);

    // Calcule le MRR
    let mrr = 0;
    for (const sub of subscriptions.data) {
      for (const item of sub.items.data) {
        const price = item.price;
        const amount = (price.unit_amount || 0) / 100;
        if (price.recurring?.interval === 'year') mrr += amount / 12;
        else if (price.recurring?.interval === 'week') mrr += amount * 4.33;
        else mrr += amount; // month
      }
    }

    // Derniers paiements
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

    // Revenus total du mois en cours
    const startOfMonth = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
    const monthlyCharges = charges.data.filter(c => c.paid && !c.refunded && c.created >= startOfMonth);
    const monthlyRevenue = monthlyCharges.reduce((sum, c) => sum + c.amount / 100, 0);

    // Solde disponible
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
