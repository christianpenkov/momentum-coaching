import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function getCreds(profileId: string): Promise<{ apiKey: string; domain: string; domainId: string | number } | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'shortio')
    .single();

  if (!integ?.api_key) return null;
  const domain = (integ.metadata as any)?.domain || null;
  const domainId = (integ.metadata as any)?.domain_id || null;
  if (!domain || !domainId) return null;
  return { apiKey: integ.api_key, domain, domainId };
}

// Fetch complet Short.io — appelé seulement si cache expiré
async function fetchFromShortio(creds: { apiKey: string; domain: string; domainId: string | number }, profileId: string) {
  const { apiKey, domain, domainId } = creds;
  const headers = { authorization: apiKey, accept: 'application/json' };
  const safeJson = async (res: Response) => { try { return await res.json(); } catch { return {}; } };

  const [domainStatsRes, linksRes] = await Promise.all([
    fetch(`https://api-v2.short.io/statistics/domain/${domainId}?period=last30`, { headers }),
    fetch(`https://api.short.io/api/links?domain_id=${domainId}&limit=150`, { headers }),
  ]);

  const [domainStats, linksData] = await Promise.all([
    safeJson(domainStatsRes),
    safeJson(linksRes),
  ]);

  if (!domainStatsRes.ok) {
    throw new Error(domainStats?.message || 'Erreur Short.io domaine');
  }

  const domainChartRaw: { x: string; y: string }[] = domainStats.clickStatistics?.datasets?.[0]?.data || [];
  const domainChartData = domainChartRaw.map((pt) => ({
    date: pt.x.split('T')[0],
    clicks: Number(pt.y) || 0,
  }));

  const topCountries = (domainStats.country || []).filter((c: any) => c.score > 0).slice(0, 8)
    .map((c: any) => ({ label: c.countryName || c.country || 'Inconnu', code: c.country, value: c.score }));
  const topReferrers = (domainStats.referer || []).filter((r: any) => r.score > 0).slice(0, 8)
    .map((r: any) => ({ label: r.refhost || 'Direct', value: r.score }));
  const topBrowsers = (domainStats.browser || []).filter((b: any) => b.score > 0).slice(0, 5)
    .map((b: any) => ({ label: b.browser, value: b.score }));
  const topOs = (domainStats.os || []).filter((o: any) => o.score > 0).slice(0, 5)
    .map((o: any) => ({ label: o.os, value: o.score }));
  const topSocial = (domainStats.social || []).filter((s: any) => s.score > 0).slice(0, 5)
    .map((s: any) => ({ label: s.social || 'Direct', value: s.score }));
  const topCities = (domainStats.city || []).filter((c: any) => c.score > 0).slice(0, 5)
    .map((c: any) => ({ label: `${c.name} (${c.countryCode})`, value: c.score }));

  const allLinks: any[] = linksData?.links || [];
  const totalLinks = Number(linksData?.count ?? allLinks.length);

  const linksWithStats = await Promise.all(
    allLinks.slice(0, 20).map(async (l: any) => {
      try {
        const statsRes = await fetch(`https://api-v2.short.io/statistics/link/${l.id}?period=last30`, { headers });
        const stats = await safeJson(statsRes);
        const chartRaw: { x: string; y: string }[] = stats.clickStatistics?.datasets?.[0]?.data || [];
        const chartData = chartRaw.map((pt) => ({ date: pt.x.split('T')[0], clicks: Number(pt.y) || 0 }));
        return {
          id: l.id, path: l.path || '',
          shortUrl: l.secureShortURL || l.shortURL || `https://${domain}/${l.path}`,
          originalUrl: l.originalURL || '', title: l.title || l.path || '', createdAt: l.createdAt || null,
          clicks30d: Number(stats.totalClicks ?? 0), humanClicks30d: Number(stats.humanClicks ?? 0),
          clicksChange: stats.totalClicksChange !== undefined ? Number(stats.totalClicksChange) : null,
          chartData,
          countries: (stats.country || []).filter((c: any) => c.score > 0).slice(0, 5).map((c: any) => ({ label: c.countryName || c.country, value: c.score })),
          referrers: (stats.referer || []).filter((r: any) => r.score > 0).slice(0, 5).map((r: any) => ({ label: r.referer || 'Direct', value: r.score })),
          browsers: (stats.browser || []).filter((b: any) => b.score > 0).slice(0, 5).map((b: any) => ({ label: b.browser, value: b.score })),
          os: (stats.os || []).filter((o: any) => o.score > 0).slice(0, 5).map((o: any) => ({ label: o.os, value: o.score })),
          social: (stats.social || []).filter((s: any) => s.score > 0).slice(0, 5).map((s: any) => ({ label: s.social || 'Direct', value: s.score })),
          cities: (stats.city || []).filter((c: any) => c.score > 0).slice(0, 5).map((c: any) => ({ label: `${c.name} (${c.countryCode})`, value: c.score })),
          utmMedium: (stats.utm_medium || []).filter((u: any) => u.score > 0 && u.utm_medium).slice(0, 5).map((u: any) => ({ label: u.utm_medium, value: u.score })),
          utmSource: (stats.utm_source || []).filter((u: any) => u.score > 0 && u.utm_source).slice(0, 5).map((u: any) => ({ label: u.utm_source, value: u.score })),
        };
      } catch {
        return {
          id: l.id, path: l.path || '',
          shortUrl: l.secureShortURL || l.shortURL || `https://${domain}/${l.path}`,
          originalUrl: l.originalURL || '', title: l.title || l.path || '', createdAt: l.createdAt || null,
          clicks30d: 0, humanClicks30d: 0, clicksChange: null,
          chartData: [], countries: [], referrers: [], browsers: [], os: [], social: [], cities: [], utmMedium: [], utmSource: [],
        };
      }
    })
  );

  linksWithStats.sort((a, b) => b.clicks30d - a.clicks30d);

  // Enrichissement link_type + postPlatform depuis DB
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: dbRows } = await serviceSupabase
    .from('shortio_link_daily_snapshots')
    .select('link_id, link_type, link_category, original_url')
    .eq('profile_id', profileId)
    .gte('date', since30d);

  // ID YouTube = exactement 11 chars dans [A-Za-z0-9_-]
  const isYtVideoId = (s: string) => /^[A-Za-z0-9_-]{11}$/.test(s);

  const dbByLinkId = new Map<string, { linkType: string | null; linkCategory: string | null; postPlatform: string | null }>();
  for (const row of dbRows ?? []) {
    if (!dbByLinkId.has(row.link_id)) {
      let postPlatform: string | null = null;
      try {
        const u = new URL(row.original_url);
        const utmSource = u.searchParams.get('utm_source') || '';
        const utmMedium = u.searchParams.get('utm_medium') || '';
        const utmContent = u.searchParams.get('utm_content') || '';
        if (utmSource === 'yt') postPlatform = 'YT';
        else if (utmMedium === 'description' && isYtVideoId(utmContent)) postPlatform = 'YT';
        else if (utmSource === 'ig' || utmSource.includes('ubizenai')) postPlatform = 'IG';
      } catch {}
      dbByLinkId.set(row.link_id, { linkType: row.link_type ?? null, linkCategory: (row as any).link_category ?? null, postPlatform });
    }
  }

  const enrichedLinks = linksWithStats.map((l: any) => {
    const meta = dbByLinkId.get(l.id) ?? { linkType: null, linkCategory: null, postPlatform: null };
    return { ...l, linkType: meta.linkType, linkCategory: meta.linkCategory, postPlatform: meta.postPlatform };
  });

  return {
    domain, totalLinks,
    clicks30d: Number(domainStats.clicks ?? 0),
    humanClicks30d: Number(domainStats.humanClicks ?? 0),
    clicksChange: domainStats.prevClicksChange !== undefined ? Number(domainStats.prevClicksChange) : null,
    clicksPerLink30d: parseFloat(domainStats.clicksPerLink ?? '0') || 0,
    chartData: domainChartData,
    topCountries, topReferrers, topBrowsers, topOs, topSocial, topCities,
    links: enrichedLinks,
  };
}

// Sauvegarde en cache DB (non bloquant — erreur silencieuse)
async function saveCache(profileId: string, payload: object) {
  await serviceSupabase.from('shortio_stats_cache').upsert({
    profile_id: profileId,
    payload,
    fetched_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' });
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients').select('id')
      .eq('profile_id', profileId).eq('coach_id', user.id).single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  const creds = await getCreds(targetProfileId);
  if (!creds) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const forceRefresh = searchParams.get('force') === '1';

  // ── Stale-While-Revalidate ────────────────────────────────────────────────
  const { data: cached } = await serviceSupabase
    .from('shortio_stats_cache')
    .select('payload, fetched_at')
    .eq('profile_id', targetProfileId)
    .single();

  const cacheAge = cached?.fetched_at
    ? Date.now() - new Date(cached.fetched_at).getTime()
    : Infinity;

  const cacheIsStale = cacheAge > CACHE_TTL_MS;

  // force=1 → bypass total du cache, fetch complet immédiat
  if (forceRefresh) {
    try {
      const payload = await fetchFromShortio(creds, targetProfileId);
      saveCache(targetProfileId, payload).catch(() => {});
      return NextResponse.json(payload);
    } catch (err: any) {
      return NextResponse.json({ error: err.message || 'Erreur Short.io' }, { status: 400 });
    }
  }

  // Cache frais → réponse immédiate, aucun appel Short.io
  if (cached && !cacheIsStale) {
    return NextResponse.json(cached.payload);
  }

  // Cache expiré mais existant → SWR : répondre immédiatement avec stale data,
  // déclencher le refresh en arrière-plan (fire-and-forget)
  if (cached && cacheIsStale) {
    fetchFromShortio(creds, targetProfileId)
      .then(fresh => saveCache(targetProfileId, fresh))
      .catch(() => {});

    return NextResponse.json({ ...cached.payload, _stale: true });
  }

  // Aucun cache → premier chargement, on attend le fetch complet
  try {
    const payload = await fetchFromShortio(creds, targetProfileId);
    saveCache(targetProfileId, payload).catch(() => {});
    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erreur Short.io' }, { status: 400 });
  }
}
