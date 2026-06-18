import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type TopEntry = { label: string; value: number };

interface SnapshotRow {
  link_id: string;
  path: string;
  short_url: string;
  original_url: string;
  date: string;
  human_clicks: number;
  total_clicks: number;
  link_type: string | null;
  link_category: string | null;
  top_countries: (TopEntry & { code?: string })[] | null;
  top_referrers: TopEntry[] | null;
  top_browsers: TopEntry[] | null;
  top_os: TopEntry[] | null;
  top_social: TopEntry[] | null;
  top_cities: TopEntry[] | null;
  utm_sources: TopEntry[] | null;
  utm_mediums: TopEntry[] | null;
}

const EMPTY_STATS = {
  domain: '', totalLinks: 0, clicks30d: 0, humanClicks30d: 0,
  clicksChange: null as number | null, clicksPerLink30d: 0,
  chartData: [] as { date: string; clicks: number }[],
  topCountries: [] as TopEntry[], topReferrers: [] as TopEntry[],
  topBrowsers: [] as TopEntry[], topOs: [] as TopEntry[],
  topSocial: [] as TopEntry[], topCities: [] as TopEntry[],
  links: [] as any[],
};

// Agrège un tableau de top entries (SUM par label à travers plusieurs jours)
function mergeTop(arrays: (TopEntry[] | null)[], limit = 8): TopEntry[] {
  const acc = new Map<string, number>();
  for (const arr of arrays) {
    for (const entry of (arr ?? [])) {
      acc.set(entry.label, (acc.get(entry.label) ?? 0) + entry.value);
    }
  }
  return [...acc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function mapPostgresToShortio(
  rows: SnapshotRow[],
  domain: string,
  metaMap: Map<string, { title: string | null; created_at: string | null }>,
) {
  if (!rows.length) return { ...EMPTY_STATS, domain };

  // Grouper par link_id
  const byLink = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const group = byLink.get(row.link_id) ?? [];
    group.push(row);
    byLink.set(row.link_id, group);
  }

  // chartData domaine : SUM total_clicks par date (tous liens)
  const domainByDate = new Map<string, number>();
  for (const row of rows) {
    domainByDate.set(row.date, (domainByDate.get(row.date) ?? 0) + row.total_clicks);
  }
  const chartData = [...domainByDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, clicks]) => ({ date, clicks }));

  // Agrégats domaine
  let totalHumanClicks = 0;
  let totalClicks = 0;
  for (const row of rows) {
    totalHumanClicks += row.human_clicks;
    totalClicks += row.total_clicks;
  }

  const mergedCountries = mergeTop(rows.map(r => r.top_countries));
  const topReferrers    = mergeTop(rows.map(r => r.top_referrers));
  const topBrowsers     = mergeTop(rows.map(r => r.top_browsers));
  const topOs           = mergeTop(rows.map(r => r.top_os));
  const topSocial       = mergeTop(rows.map(r => r.top_social));
  const topCities       = mergeTop(rows.map(r => r.top_cities));

  // Construire les liens
  const links = [...byLink.entries()].map(([linkId, linkRows]) => {
    const sorted = [...linkRows].sort((a, b) => a.date.localeCompare(b.date));
    const linkHuman = sorted.reduce((s, r) => s + r.human_clicks, 0);
    const linkTotal = sorted.reduce((s, r) => s + r.total_clicks, 0);
    const first = sorted[0];
    const meta = metaMap.get(linkId);
    // Fallback link_type : depuis la colonne DB, sinon parse originalUrl
    let linkType = first.link_type ?? null;
    if (!linkType) {
      try { linkType = new URL(first.original_url).searchParams.get('utm_medium') || null; } catch {}
    }
    // postPlatform depuis utm_source stocké en DB ('yt' → 'YT', 'ig' → 'IG')
    const utmSourceVal = (() => {
      try { return new URL(first.original_url).searchParams.get('utm_source') || null; } catch { return null; }
    })();
    const postPlatform = utmSourceVal === 'yt' ? 'YT' : utmSourceVal === 'ig' ? 'IG' : null;

    // link_category : valeur non-ambiguë issue du cron (prend la première non-null)
    const linkCategory = sorted.find(r => r.link_category)?.link_category ?? null;

    return {
      id: linkId,
      path: first.path,
      shortUrl: first.short_url,
      originalUrl: first.original_url,
      title: meta?.title || first.path,
      createdAt: meta?.created_at || null,
      linkType,
      linkCategory,
      postPlatform,
      clicks30d: linkTotal,
      humanClicks30d: linkHuman,
      clicksChange: null as number | null,
      chartData: sorted.map(r => ({ date: r.date, clicks: r.total_clicks })),
      countries: mergeTop(sorted.map(r => r.top_countries)),
      referrers: mergeTop(sorted.map(r => r.top_referrers)),
      browsers:  mergeTop(sorted.map(r => r.top_browsers)),
      os:        mergeTop(sorted.map(r => r.top_os)),
      social:    mergeTop(sorted.map(r => r.top_social)),
      cities:    mergeTop(sorted.map(r => r.top_cities)),
      utmSource: mergeTop(sorted.map(r => r.utm_sources)),
      utmMedium: mergeTop(sorted.map(r => r.utm_mediums)),
    };
  }).sort((a, b) => b.clicks30d - a.clicks30d);

  const totalLinks = byLink.size;

  return {
    domain,
    totalLinks,
    clicks30d: totalClicks,
    humanClicks30d: totalHumanClicks,
    clicksChange: null,
    clicksPerLink30d: totalLinks > 0 ? Math.round(totalHumanClicks / totalLinks) : 0,
    chartData,
    topCountries: mergedCountries,
    topReferrers,
    topBrowsers,
    topOs,
    topSocial,
    topCities,
    links,
  };
}

// GET /api/shortio/snapshots?profileId=xxx&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');
  const startDate = searchParams.get('startDate') ?? '';
  const endDate   = searchParams.get('endDate')   ?? '';

  // Validation des dates
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  }

  // Auth guard IDOR
  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients').select('id')
      .eq('profile_id', profileId).eq('coach_id', user.id).single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  console.log('[shortio/snapshots] profileId=%s start=%s end=%s', targetProfileId, startDate, endDate);

  try {
    // Fetch en parallèle : snapshots + domain + metadata liens
    const [snapshotsRes, integRes, metaRes] = await Promise.all([
      serviceSupabase
        .from('shortio_link_daily_snapshots')
        .select('link_id,path,short_url,original_url,date,human_clicks,total_clicks,link_type,link_category,top_countries,top_referrers,top_browsers,top_os,top_social,top_cities,utm_sources,utm_mediums')
        .eq('profile_id', targetProfileId)
        .gte('date', startDate)
        .lte('date', endDate),
      serviceSupabase
        .from('integrations')
        .select('metadata')
        .eq('profile_id', targetProfileId)
        .eq('provider', 'shortio')
        .maybeSingle(),
      serviceSupabase
        .from('shortio_links_metadata')
        .select('link_id,title,created_at')
        .eq('profile_id', targetProfileId),
    ]);

    if (snapshotsRes.error) throw snapshotsRes.error;
    if (integRes.error) console.warn('[shortio/snapshots] integrations_error:', integRes.error.message, { targetProfileId });

    const domain = (integRes.data?.metadata as any)?.domain || '';
    const metaMap = new Map(
      (metaRes.data || []).map((m: any) => [m.link_id, { title: m.title, created_at: m.created_at }])
    );

    const data = snapshotsRes.data;

    if (!data?.length) {
      console.warn('[shortio/snapshots] NO_DATA profileId=%s start=%s end=%s', targetProfileId, startDate, endDate);
      return NextResponse.json({ ...EMPTY_STATS, domain }, {
        headers: { 'Cache-Control': 'public, max-age=86400' },
      });
    }

    const linkTypesSample = [...new Set((data as any[]).map((r: any) => r.link_type))].slice(0, 5);
    console.log('[shortio/snapshots] rows=%d links=%d domain=%s integError=%s linkTypes=%s', data.length, new Set(data.map((r: any) => r.link_id)).size, domain, integRes.error?.message || 'none', JSON.stringify(linkTypesSample));

    const result = mapPostgresToShortio(data as SnapshotRow[], domain, metaMap);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });

  } catch (e: any) {
    console.error('[shortio/snapshots] DB_ERROR', e?.message, { profileId: targetProfileId });
    return NextResponse.json(EMPTY_STATS);
  }
}
