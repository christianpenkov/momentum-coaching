import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Token Fathom avec refresh ──────────────────────────────────────────────
// Même pattern que getCalendlyToken (lib/calendly-fetch.ts) : token stocké dans
// integrations, refresh automatique si expiré (marge 5 min) via le endpoint OAuth Fathom.

export async function getFathomToken(profileId: string): Promise<string | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId)
    .eq('provider', 'fathom')
    .single();

  if (!integ?.access_token) return null;

  const expired = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;

  if (!expired) return integ.access_token;
  if (!integ.refresh_token) return null;

  const res = await fetch('https://fathom.video/external/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integ.refresh_token,
      client_id: process.env.FATHOM_CLIENT_ID!,
      client_secret: process.env.FATHOM_CLIENT_SECRET!,
    }),
  });

  const data = await res.json();
  if (!data.access_token) return null;

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  await serviceSupabase.from('integrations').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || integ.refresh_token,
    expires_at: expiresAt,
  }).eq('profile_id', profileId).eq('provider', 'fathom');

  return data.access_token;
}
