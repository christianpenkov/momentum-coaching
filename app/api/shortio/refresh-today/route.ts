import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { getShortioLinkCreds, snapshotShortioLinks } from '@/lib/shortio-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/shortio/refresh-today
// Body: { profile_id?: string }
// Snapshot J-0 Short.io : agrégat domaine + granularité par lien.
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

  const creds = await getShortioLinkCreds(profileId);
  if (!creds) return NextResponse.json({ ok: false, error: 'no_token' });

  const today = new Date().toISOString().split('T')[0];
  const errors: string[] = [];

  // 1. Snapshot granulaire par lien → shortio_link_daily_snapshots (period=today)
  const { synced, errors: linkErrors } = await snapshotShortioLinks(profileId, 'today', 'refresh_partial');
  if (linkErrors.length) errors.push(...linkErrors);

  // 2. Agrégat domaine J-0 → analytics_daily_snapshots (period=today)
  try {
    const domainRes = await fetch(
      `https://api-v2.short.io/statistics/domain/${creds.domainId}?period=today`,
      { headers: { authorization: creds.apiKey, accept: 'application/json' } }
    );
    if (!domainRes.ok) throw new Error(`Short.io domain ${domainRes.status}`);
    const domainStats = await domainRes.json();

    const { error: upsertErr } = await serviceSupabase
      .from('analytics_daily_snapshots')
      .upsert({
        profile_id:           profileId,
        date:                 today,
        shortio_clicks:       Number(domainStats.clicks      ?? 0) || null,
        shortio_human_clicks: Number(domainStats.humanClicks ?? 0) || null,
        shortio_top_countries: (domainStats.country || [])
          .filter((c: any) => c.score > 0).slice(0, 8)
          .map((c: any) => ({ label: c.countryName || c.country, code: c.country, value: c.score })),
        shortio_top_referrers: (domainStats.referer || [])
          .filter((r: any) => r.score > 0).slice(0, 8)
          .map((r: any) => ({ label: r.refhost || 'Direct', value: r.score })),
        backfill_source:      'refresh_partial',
      }, { onConflict: 'profile_id,date', ignoreDuplicates: false });

    if (upsertErr) errors.push(`domain_upsert: ${upsertErr.message}`);
  } catch (e: any) {
    errors.push(`domain_fetch: ${e?.message || 'unknown'}`);
  }

  return NextResponse.json({ ok: errors.length === 0, date: today, synced_links: synced, errors });
}
