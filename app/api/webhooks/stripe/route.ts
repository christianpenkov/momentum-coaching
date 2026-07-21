import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const STRIPE_CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET!;

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  const parts = signature.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
  const v1 = parts.find(p => p.startsWith('v1='))?.split('=')[1];
  if (!timestamp || !v1) return false;
  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}

async function handleConnectEvent(event: any) {
  const supabase = getServiceSupabase();
  const connectedAccountId = event.account as string;

  const { data: integration } = await supabase
    .from('integrations')
    .select('profile_id')
    .eq('provider', 'stripe')
    .eq('account_label', connectedAccountId)
    .single();

  if (!integration?.profile_id) {
    console.warn(`Stripe Connect event ignoré — compte inconnu: ${connectedAccountId}`);
    return;
  }

  const profileId = integration.profile_id;

  if (event.type === 'charge.succeeded' || event.type === 'payment_intent.succeeded') {
    const obj = event.data.object;
    if (obj.refunded || (obj.status && obj.status !== 'succeeded')) return;

    const { error } = await supabase.from('stripe_payments').upsert({
      profile_id: profileId,
      payment_id: obj.id,
      amount: (obj.amount ?? obj.amount_received ?? 0) / 100,
      currency: obj.currency ?? 'eur',
      description: obj.description || obj.statement_descriptor || null,
      date: new Date((obj.created ?? Date.now() / 1000) * 1000).toISOString(),
      status: obj.status ?? 'succeeded',
    }, { onConflict: 'profile_id,payment_id' });
    if (error) {
      console.error(`stripe_payments upsert échoué (${event.type}, payment_id=${obj.id}):`, error.message);
      throw error;
    }
  }

  if (event.type === 'invoice.paid') {
    const inv = event.data.object;
    const { error } = await supabase.from('stripe_payments').upsert({
      profile_id: profileId,
      payment_id: inv.id,
      amount: (inv.amount_paid ?? 0) / 100,
      currency: inv.currency ?? 'eur',
      description: inv.description || `Facture ${inv.number}` || null,
      date: new Date((inv.status_transitions?.paid_at ?? inv.created ?? Date.now() / 1000) * 1000).toISOString(),
      status: 'succeeded',
    }, { onConflict: 'profile_id,payment_id' });
    if (error) {
      console.error(`stripe_payments upsert échoué (invoice.paid, payment_id=${inv.id}):`, error.message);
      throw error;
    }
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') || '';

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!STRIPE_CONNECT_WEBHOOK_SECRET) {
    console.error('STRIPE_CONNECT_WEBHOOK_SECRET non configuré');
    return NextResponse.json({ error: 'Webhook non configuré' }, { status: 500 });
  }

  if (!verifyStripeSignature(payload, signature, STRIPE_CONNECT_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    await handleConnectEvent(event);
  } catch (err) {
    console.error('Stripe webhook: échec traitement événement', event?.type, err);
    return NextResponse.json({ error: 'Échec traitement' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
