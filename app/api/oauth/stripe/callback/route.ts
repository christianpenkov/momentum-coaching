import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=stripe_denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=stripe_invalid`);
  }

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

  // Vérifier que le state correspond à cet utilisateur
  const expectedState = Buffer.from(user.id).toString('base64');
  if (state !== expectedState) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=stripe_state`);
  }

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
    return NextResponse.redirect(`${origin}/dashboard/settings?error=stripe_token`);
  }

  // Stocker dans Supabase (service role pour bypass RLS)
  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error: upsertError } = await serviceSupabase.from('integrations').upsert({
    profile_id: user.id,
    provider: 'stripe',
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    account_label: tokenData.stripe_user_id, // ex: acct_xxxxx
    connected_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,provider' });

  if (upsertError) {
    console.error('Supabase upsert error:', upsertError);
    return NextResponse.redirect(`${origin}/dashboard/settings?error=stripe_save`);
  }

  // Rediriger vers les réglages avec succès
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const dest = profile?.role === 'coach' ? '/settings' : '/espace/settings';
  return NextResponse.redirect(`${origin}${dest}?connected=stripe`);
}
