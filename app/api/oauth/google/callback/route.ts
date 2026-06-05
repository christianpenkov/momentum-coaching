import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect(`${origin}/settings?error=google_denied`);
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
    return NextResponse.redirect(`${origin}/settings?error=google_state`);
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );

  const { tokens } = await oauth2.getToken(code);

  if (!tokens.access_token) {
    return NextResponse.redirect(`${origin}/settings?error=google_token`);
  }

  const expiresAt = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : null;

  // Récupérer le label (email Google du coach)
  oauth2.setCredentials(tokens);
  let accountLabel: string | null = null;
  try {
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const { data: userInfo } = await oauth2Api.userinfo.get();
    accountLabel = userInfo.email || null;
  } catch {
    // Non bloquant
  }

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await serviceSupabase.from('integrations').upsert({
    profile_id: user.id,
    provider: 'google',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    account_label: accountLabel,
    expires_at: expiresAt,
    connected_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,provider' });

  return NextResponse.redirect(`${origin}/settings?connected=google`);
}
