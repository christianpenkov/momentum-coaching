import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // /dashboard/settings n'existe pas : les vraies routes sont /settings (coach) et
  // /client/settings (élève). Le rôle n'est connu qu'après auth, donc on retombe sur
  // /settings tant qu'on ne l'a pas — le middleware redirige un élève qui y atterrit.
  const fail = (reason: string, role?: string | null) =>
    NextResponse.redirect(`${origin}${role === 'client' ? '/client/settings' : '/settings'}?error=${reason}`);

  if (error) return fail('stripe_denied');
  if (!code || !state) return fail('stripe_invalid');

  // Vérifier le state = user_id en base64
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  // Rôle résolu ici : sert autant aux redirections d'erreur qu'à celle de succès.
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const role = profile?.role === 'coach' ? 'coach' : 'client';

  // Vérifier que le state correspond à cet utilisateur
  const expectedState = Buffer.from(user.id).toString('base64');
  if (state !== expectedState) return fail('stripe_state', role);

  // Échanger le code contre un access_token
  const tokenRes = await fetch('https://connect.stripe.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_secret: process.env.STRIPE_SECRET_KEY!,
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error) {
    console.error('Stripe OAuth error:', tokenData.error);
    return fail('stripe_token', role);
  }

  // Stocker dans Supabase (service role pour bypass RLS)
  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: existingStripe } = await serviceSupabase
    .from('integrations').select('first_connected_at')
    .eq('profile_id', user.id).eq('provider', 'stripe').maybeSingle();
  const stripeConnectedNow = new Date().toISOString();

  const { error: upsertError } = await serviceSupabase.from('integrations').upsert({
    profile_id: user.id,
    provider: 'stripe',
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    account_label: tokenData.stripe_user_id, // ex: acct_xxxxx — clé de résolution du webhook Connect
    // Une clé posée avant la bascule vers OAuth doit disparaître : sans ça deux
    // identifiants concurrents cohabitent et l'appelant ne sait plus lequel fait foi.
    api_key: null,
    connected_at: stripeConnectedNow,
    first_connected_at: existingStripe?.first_connected_at || stripeConnectedNow,
  }, { onConflict: 'profile_id,provider' });

  if (upsertError) {
    console.error('Supabase upsert error:', upsertError);
    return fail('stripe_save', role);
  }

  // Rediriger vers les réglages avec succès
  const dest = role === 'coach' ? '/settings' : '/client/settings';
  return NextResponse.redirect(`${origin}${dest}?connected=stripe`);
}
