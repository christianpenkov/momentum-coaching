import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getCreds(profileId: string): Promise<{ apiKey: string; domainId: string | number } | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'shortio')
    .single();

  if (!integ?.api_key) return null;
  const domainId = (integ.metadata as any)?.domain_id || null;
  if (!domainId) return null;
  return { apiKey: integ.api_key, domainId };
}

// POST /api/shortio/refresh-today
// Body: { profile_id: string }
// Met à jour le snapshot J-0 Short.io dans analytics_daily_snapshots.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const profileId: string = body.profile_id || user.id;

  if (profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const creds = await getCreds(profileId);
  if (!creds) return NextResponse.json({ ok: false, error: 'no_token' });

  const today = new Date().toISOString().split('T')[0];
  const errors: string[] = [];

  try {
    const headers = { authorization: creds.apiKey, accept: 'application/json' };
    const res = await fetch(`https://api-v2.short.io/statistics/domain/${creds.domainId}?period=today`, { headers });
    if (!res.ok) throw new Error(`Short.io ${res.status}`);
    const data = await res.json();

    const { error } = await serviceSupabase
      .from('analytics_daily_snapshots')
      .upsert({
        profile_id: profileId,
        date: today,
        shortio_clicks:       Number(data.clicks ?? 0) || null,
        shortio_human_clicks: Number(data.humanClicks ?? 0) || null,
        shortio_links:        Number(data.linksCount ?? 0) || null,
        backfill_source:      'refresh_partial',
      }, { onConflict: 'profile_id,date', ignoreDuplicates: false });

    if (error) errors.push(`upsert: ${error.message}`);
  } catch (e: any) {
    errors.push(`fetch_error: ${e?.message || 'unknown'}`);
  }

  return NextResponse.json({ ok: errors.length === 0, date: today, errors });
}
