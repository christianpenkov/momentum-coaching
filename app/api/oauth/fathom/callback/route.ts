import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect(`${origin}/settings?error=fathom_denied`);
  }

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

  const expectedState = Buffer.from(user.id).toString('base64');
  if (state !== expectedState) {
    return NextResponse.redirect(`${origin}/settings?error=fathom_state`);
  }

  // Échanger le code — endpoint confirmé depuis le code source du SDK officiel
  // fathom-typescript (fathom.video/external/v1/oauth2/token), la doc publique
  // ne le documente pas explicitement.
  const tokenRes = await fetch('https://fathom.video/external/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.FATHOM_CLIENT_ID!,
      client_secret: process.env.FATHOM_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/oauth/fathom/callback`,
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error('[Fathom callback] token exchange failed:', JSON.stringify(tokenData));
    return NextResponse.redirect(`${origin}/settings?error=fathom_token`);
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await serviceSupabase.from('integrations').upsert({
    profile_id: user.id,
    provider: 'fathom',
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    account_label: null,
    expires_at: expiresAt,
    connected_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,provider' });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();

  const base = process.env.NEXT_PUBLIC_PLATFORM_URL || '';

  // Enregistrement webhook Fathom (fire-and-forget, idempotent côté route)
  fetch(`${base}/api/fathom/register-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: request.headers.get('cookie') || '' },
  }).catch(e => console.error('[Fathom callback] register-webhook failed:', e));

  const dest = profile?.role === 'coach' ? '/settings' : '/client/settings';
  return NextResponse.redirect(`${origin}${dest}?connected=fathom`);
}
