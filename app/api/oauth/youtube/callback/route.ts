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
    return NextResponse.redirect(`${origin}/client/settings?error=youtube_denied`);
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
    return NextResponse.redirect(`${origin}/client/settings?error=youtube_state`);
  }

  // Échange le code contre un token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/oauth/youtube/callback`,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return NextResponse.redirect(`${origin}/client/settings?error=youtube_token`);
  }

  // Récupère le nom de la chaîne pour le label
  const channelRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );
  const channelData = await channelRes.json();
  const accountLabel = channelData?.items?.[0]?.snippet?.title || null;

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await serviceSupabase.from('integrations').upsert({
    profile_id: user.id,
    provider: 'youtube',
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    account_label: accountLabel,
    expires_at: expiresAt,
    connected_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,provider' });

  // Crée automatiquement le job Reporting API pour le CTR (channel_reach_basic_a1)
  // — données disponibles ~24h après, puis quotidiennement
  try {
    const existingJobsRes = await fetch(
      'https://youtubereporting.googleapis.com/v1/jobs',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const existingJobsData = await existingJobsRes.json();
    const alreadyExists = existingJobsData.jobs?.some((j: any) => j.reportTypeId === 'channel_reach_basic_a1');

    if (!alreadyExists) {
      await fetch('https://youtubereporting.googleapis.com/v1/jobs', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportTypeId: 'channel_reach_basic_a1',
          name: 'Momentum CTR Job',
        }),
      });
    }
  } catch {
    // Non bloquant — le job peut être créé plus tard manuellement
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const dest = profile?.role === 'coach' ? '/settings' : '/client/settings';
  return NextResponse.redirect(`${origin}${dest}?connected=youtube`);
}
