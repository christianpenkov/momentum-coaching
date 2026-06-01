import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_ID = process.env.INSTAGRAM_CLIENT_ID!;
const APP_SECRET = process.env.INSTAGRAM_CLIENT_SECRET!;
const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL!;

// POST /api/instagram/register-webhook
// Deux niveaux d'abonnement :
// 1. App-level : souscrit comments+messages au niveau de l'app Meta (App Token)
// 2. Account-level : subscribed_apps sur le compte IG (User Token)
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) {
    return NextResponse.json({ error: 'Compte Instagram non connecté' }, { status: 404 });
  }

  const token = integ.access_token;
  const igAccountId = (integ.metadata as any)?.ig_account_id;
  if (!igAccountId) return NextResponse.json({ error: 'ig_account_id manquant' }, { status: 404 });

  const results: any = {};
  const appToken = `${APP_ID}|${APP_SECRET}`;

  // NIVEAU 1 — App-level webhook subscription (fields comments + messages)
  const appSubRes = await fetch(`https://graph.facebook.com/v21.0/${APP_ID}/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      object: 'instagram',
      callback_url: `${PLATFORM_URL}/api/webhooks/instagram`,
      fields: 'comments,messages',
      verify_token: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN!,
      access_token: appToken,
    }),
  });
  results.app_subscription = await appSubRes.json();

  // NIVEAU 2 — Account-level subscribed_apps (autorise l'app sur CE compte IG)
  const subRes = await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscribed_fields: 'comments,messages', access_token: token }),
  });
  results.account_subscription = await subRes.json();

  // Vérification finale
  const checkRes = await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/subscribed_apps?access_token=${token}`);
  results.current_subscriptions = await checkRes.json();

  const success = !results.app_subscription?.error && !results.account_subscription?.error;
  return NextResponse.json({ success, igAccountId, results });
}

// GET — vérifie les souscriptions actives sans rien modifier
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) {
    return NextResponse.json({ error: 'Compte Instagram non connecté' }, { status: 404 });
  }

  const token = integ.access_token;
  const igAccountId = (integ.metadata as any)?.ig_account_id;

  const checkRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/subscribed_apps?access_token=${token}`
  );
  const checkData = await checkRes.json();

  return NextResponse.json({ igAccountId, subscriptions: checkData });
}
