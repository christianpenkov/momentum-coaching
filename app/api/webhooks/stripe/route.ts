import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Webhook secret à configurer dans Stripe Dashboard → Webhooks
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || 'https://momentum.quennel.com';

// Client Supabase service-role (bypass RLS) pour les opérations backend
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

async function sendInviteEmail(to: string, inviteUrl: string, customerName: string) {
  // Utilise Resend (ou un autre provider) pour envoyer l'email
  // La clé API est récupérée depuis Supabase integrations
  const supabase = getServiceSupabase();

  // Récupérer la clé Resend stockée dans les intégrations du coach
  // (pour l'instant on envoie via Supabase Auth invite si pas de clé Resend)
  const resendKey = process.env.RESEND_API_KEY;

  if (resendKey) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Momentum <noreply@momentum.quennel.com>',
        to,
        subject: '🎯 Ton accès Momentum est prêt',
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <img src="${PLATFORM_URL}/logo-momentum.png" alt="Momentum" width="48" style="margin-bottom: 24px;" />
            <h1 style="font-size: 24px; font-weight: 800; color: #1a1815; margin: 0 0 12px;">
              Bienvenue ${customerName} 👋
            </h1>
            <p style="font-size: 14px; color: #797569; line-height: 1.7; margin: 0 0 24px;">
              Ton paiement a été confirmé. Ton espace Momentum est prêt — c'est là que tu vas suivre
              ta progression, tes tâches, et les ressources de coaching.
            </p>
            <a href="${inviteUrl}" style="display: inline-block; background: #0057FF; color: white; padding: 14px 28px; border-radius: 10px; font-weight: 700; font-size: 15px; text-decoration: none;">
              Créer mon accès →
            </a>
            <p style="font-size: 12px; color: #aaa; margin-top: 32px;">
              Ce lien est valable 7 jours. Si tu as des questions, réponds directement à cet email.
            </p>
          </div>
        `,
      }),
    });
  } else {
    // Fallback : invite Supabase Auth (envoie un email de confirmation)
    await supabase.auth.admin.inviteUserByEmail(to, {
      redirectTo: inviteUrl,
    });
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') || '';

  // Vérifier la signature Stripe
  if (STRIPE_WEBHOOK_SECRET && !verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // On écoute uniquement checkout.session.completed et payment_intent.succeeded
  if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') {
    return NextResponse.json({ received: true });
  }

  const supabase = getServiceSupabase();

  const session = event.data.object;
  const customerEmail = session.customer_email || session.customer_details?.email;
  const customerName = session.customer_details?.name || 'toi';
  const amount = session.amount_total; // en centimes
  const stripeCustomerId = session.customer;

  if (!customerEmail) {
    return NextResponse.json({ error: 'No customer email' }, { status: 400 });
  }

  // Générer un token d'invitation unique
  const inviteToken = crypto.randomUUID();

  // Créer le client dans Supabase (sans profile_id pour l'instant)
  // On cherche d'abord si un client existe déjà avec cet email
  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  let clientId: string;

  if (existingClient) {
    clientId = existingClient.id;
    // Renouvellement — mettre à jour le token
    await supabase.from('clients').update({
      invite_token: inviteToken,
      stripe_customer_id: stripeCustomerId,
    }).eq('id', clientId);
  } else {
    // Récupérer le coach (il n'y en a qu'un pour Momentum)
    const { data: coachProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'coach')
      .single();

    if (!coachProfile) {
      return NextResponse.json({ error: 'No coach found' }, { status: 500 });
    }

    // Créer le nouveau client
    const { data: newClient } = await supabase.from('clients').insert({
      coach_id: coachProfile.id,
      name: customerName,
      initials: customerName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2),
      week: 1,
      status: 'green',
      status_text: 'Nouveau client',
      momentum_score: 50,
      client_since: 1,
      iclosed_rate: 0,
      calendly_monthly: 0,
      invite_token: inviteToken,
      stripe_customer_id: stripeCustomerId,
      stripe_email: customerEmail,
    }).select().single();

    if (!newClient) {
      return NextResponse.json({ error: 'Failed to create client' }, { status: 500 });
    }
    clientId = newClient.id;
  }

  // Construire l'URL d'invitation
  const inviteUrl = `${PLATFORM_URL}/signup?email=${encodeURIComponent(customerEmail)}&token=${inviteToken}`;

  // Envoyer l'email
  await sendInviteEmail(customerEmail, inviteUrl, customerName);

  return NextResponse.json({ received: true, clientId });
}
