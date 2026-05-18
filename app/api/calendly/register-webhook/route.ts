import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  // Récupère le token Calendly de l'utilisateur
  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integration } = await serviceSupabase
    .from('integrations')
    .select('access_token')
    .eq('profile_id', user.id)
    .eq('provider', 'calendly')
    .single();

  if (!integration?.access_token) {
    return NextResponse.json({ error: 'Calendly non connecté' }, { status: 404 });
  }

  // Récupère l'organisation de l'utilisateur
  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${integration.access_token}` },
  });
  const meData = await meRes.json();
  const orgUri = meData?.resource?.current_organization;
  const userUri = meData?.resource?.uri;

  if (!orgUri || !userUri) {
    return NextResponse.json({ error: 'Impossible de récupérer l\'organisation Calendly' }, { status: 400 });
  }

  const webhookUrl = `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/webhooks/calendly`;

  // Vérifie si un webhook existe déjà pour éviter les doublons
  const existingRes = await fetch(
    `https://api.calendly.com/webhook_subscriptions?organization=${encodeURIComponent(orgUri)}&user=${encodeURIComponent(userUri)}&scope=user`,
    { headers: { Authorization: `Bearer ${integration.access_token}` } }
  );
  const existingData = await existingRes.json();
  const alreadyExists = existingData?.collection?.some(
    (w: any) => w.callback_url === webhookUrl
  );

  if (alreadyExists) {
    return NextResponse.json({ ok: true, message: 'Webhook déjà enregistré' });
  }

  // Crée le webhook
  const createRes = await fetch('https://api.calendly.com/webhook_subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: webhookUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: orgUri,
      user: userUri,
      scope: 'user',
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.message || 'Erreur création webhook' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, message: 'Webhook Calendly enregistré' });
}
