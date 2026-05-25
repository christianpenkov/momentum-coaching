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
    return NextResponse.redirect(`${origin}/client/settings?error=instagram_denied`);
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
    return NextResponse.redirect(`${origin}/client/settings?error=instagram_state`);
  }

  // Échange le code contre un token court-terme (Instagram Business API)
  const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_CLIENT_ID!,
      client_secret: process.env.INSTAGRAM_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/oauth/instagram/callback`,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return NextResponse.redirect(`${origin}/client/settings?error=instagram_token`);
  }

  // Échange contre un token long-terme (60 jours)
  const longTokenRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&access_token=${tokenData.access_token}`
  );
  const longTokenData = await longTokenRes.json();
  console.log('[IG callback] short token prefix:', tokenData.access_token?.slice(0, 20));
  console.log('[IG callback] long token response:', JSON.stringify(longTokenData));
  const accessToken = longTokenData.access_token || tokenData.access_token;
  const expiresIn = longTokenData.expires_in || null;

  // Récupère l'ID réel + username via /me
  const meRes = await fetch(
    `https://graph.instagram.com/v22.0/me?fields=id,username,account_type&access_token=${accessToken}`
  );
  const meData = await meRes.json();
  console.log('[IG callback] /me response:', JSON.stringify(meData));
  const igAccountId = meData.id ? String(meData.id) : (tokenData.user_id ? String(tokenData.user_id) : null);
  const accountLabel = meData.username ? `@${meData.username}` : null;

  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await serviceSupabase.from('integrations').upsert({
    profile_id: user.id,
    provider: 'instagram',
    access_token: accessToken,
    refresh_token: null,
    account_label: accountLabel,
    expires_at: expiresAt,
    connected_at: new Date().toISOString(),
    metadata: igAccountId ? { ig_account_id: igAccountId } : null,
  }, { onConflict: 'profile_id,provider' });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const dest = profile?.role === 'coach' ? '/settings' : '/client/settings';
  return NextResponse.redirect(`${origin}${dest}?connected=instagram`);
}
