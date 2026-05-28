import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/instagram/register-webhook
// S'abonne aux champs comments + messages sur le compte IG connecté
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

  if (!igAccountId) {
    return NextResponse.json({ error: 'ig_account_id manquant' }, { status: 404 });
  }

  const results: any = {};

  // Souscription aux champs comments + messages sur la page IG
  const subRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/subscribed_apps`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscribed_fields: 'comments,messages',
        access_token: token,
      }),
    }
  );
  const subData = await subRes.json();
  results.subscribed_apps = subData;

  // Vérifie les souscriptions actives
  const checkRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/subscribed_apps?access_token=${token}`
  );
  const checkData = await checkRes.json();
  results.current_subscriptions = checkData;

  return NextResponse.json({
    success: !subData.error,
    igAccountId,
    results,
  });
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
