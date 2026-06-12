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

  // 3. Click stream — clics bruts des 2 dernières heures pour attribution LM précise
  // Filtre afterDate = il y a 2h pour ne pas parcourir toute l'historique
  // Même avec 500+ liens LM, seuls les clics récents sont retournés (max 500 par requête)
  try {
    // Depuis minuit aujourd'hui — couvre toute la journée peu importe l'heure du refresh
    const afterDate = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').toISOString();
    const clicksRes = await fetch(
      `https://api-v2.short.io/statistics/domain/${creds.domainId}/last_clicks`,
      {
        method: 'POST',
        headers: { authorization: creds.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ limit: 500, afterDate }),
      }
    );
    if (clicksRes.ok) {
      const clicksData = await clicksRes.json();
      const rawClicks: { path: string; dt: string }[] = clicksData?.clicks ?? clicksData ?? [];

      // On ne traite que les paths LM (lm-*)
      const lmClicks = rawClicks.filter(c => c.path?.startsWith('lm-'));

      for (const click of lmClicks) {
        const clickedAt = click.dt ? new Date(click.dt).toISOString() : new Date().toISOString();

        // Trouver le lead via tracking_link
        const { data: igLead } = await serviceSupabase
          .from('instagram_leads')
          .select('id, ig_username, detected_at')
          .eq('profile_id', profileId)
          .filter('tracking_link', 'like', `%/${click.path}`)
          .maybeSingle();

        if (!igLead) continue;

        // Vérifier que le clic est APRÈS la détection du lead (pas un clic antérieur)
        if (new Date(clickedAt) < new Date(igLead.detected_at)) continue;

        const { error: evtErr } = await serviceSupabase.from('prospect_events').upsert({
          profile_id:   profileId,
          prospect_key: igLead.ig_username.toLowerCase(),
          platform:     'ig',
          event_type:   'lm_clicked',
          occurred_at:  clickedAt,
          ig_lead_id:   igLead.id,
        }, { onConflict: 'ig_lead_id,event_type', ignoreDuplicates: true });

        if (evtErr) errors.push(`lm_clicked_${click.path}: ${evtErr.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`click_stream: ${e?.message || 'unknown'}`);
  }

  return NextResponse.json({ ok: errors.length === 0, date: today, synced_links: synced, errors });
}
