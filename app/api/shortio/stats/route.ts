import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  const creds = await getCreds(targetProfileId);
  if (!creds) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const { apiKey, domain, domainId } = creds;
  const headers = { authorization: apiKey, accept: 'application/json' };

  const safeJson = async (res: Response) => { try { return await res.json(); } catch { return {}; } };

  // Fetch domaine stats last30 + liste des liens en parallèle
  const [domainStatsRes, linksRes] = await Promise.all([
    fetch(`https://api-v2.short.io/statistics/domain/${domainId}?period=last30`, { headers }),
    fetch(`https://api.short.io/api/links?domain_id=${domainId}&limit=150`, { headers }),
  ]);

  const [domainStats, linksData] = await Promise.all([
    safeJson(domainStatsRes),
    safeJson(linksRes),
  ]);

  if (!domainStatsRes.ok) {
    return NextResponse.json({ error: domainStats?.message || 'Erreur Short.io', raw: domainStats }, { status: 400 });
  }

  // Chart domaine : { x: ISO date, y: "nombre_string" }
  const domainChartRaw: { x: string; y: string }[] = domainStats.clickStatistics?.datasets?.[0]?.data || [];
  const domainChartData = domainChartRaw.map((pt) => ({
    date: pt.x.split('T')[0],
    clicks: Number(pt.y) || 0,
  }));

  // Top pays domaine : { countryName, country, score }
  const topCountries = (domainStats.country || [])
    .filter((c: any) => c.score > 0)
    .slice(0, 8)
    .map((c: any) => ({ label: c.countryName || c.country || 'Inconnu', code: c.country, value: c.score }));

  // Top referrers domaine : { refhost, score }
  const topReferrers = (domainStats.referer || [])
    .filter((r: any) => r.score > 0)
    .slice(0, 8)
    .map((r: any) => ({ label: r.refhost || 'Direct', value: r.score }));

  // Top browsers : { browser, score }
  const topBrowsers = (domainStats.browser || [])
    .filter((b: any) => b.score > 0)
    .slice(0, 5)
    .map((b: any) => ({ label: b.browser, value: b.score }));

  // Top OS : { os, score }
  const topOs = (domainStats.os || [])
    .filter((o: any) => o.score > 0)
    .slice(0, 5)
    .map((o: any) => ({ label: o.os, value: o.score }));

  // Top social : { social, score }
  const topSocial = (domainStats.social || [])
    .filter((s: any) => s.score > 0)
    .slice(0, 5)
    .map((s: any) => ({ label: s.social || 'Direct', value: s.score }));

  // Top villes : { name, countryCode, score }
  const topCities = (domainStats.city || [])
    .filter((c: any) => c.score > 0)
    .slice(0, 5)
    .map((c: any) => ({ label: `${c.name} (${c.countryCode})`, value: c.score }));

  // Stats par lien individuel (top 20)
  const allLinks: any[] = linksData?.links || [];
  const totalLinks = Number(linksData?.count ?? allLinks.length);

  const linksWithStats = await Promise.all(
    allLinks.slice(0, 20).map(async (l: any) => {
      try {
        const statsRes = await fetch(`https://api-v2.short.io/statistics/link/${l.id}?period=last30`, { headers });
        const stats = await safeJson(statsRes);

        // Chart par lien : même format { x, y }
        const chartRaw: { x: string; y: string }[] = stats.clickStatistics?.datasets?.[0]?.data || [];
        const chartData = chartRaw
          .filter((pt) => Number(pt.y) > 0)
          .map((pt) => ({ date: pt.x.split('T')[0], clicks: Number(pt.y) || 0 }));

        return {
          id: l.id,
          path: l.path || '',
          shortUrl: l.secureShortURL || l.shortURL || `https://${domain}/${l.path}`,
          originalUrl: l.originalURL || '',
          title: l.title || l.path || '',
          createdAt: l.createdAt || null,
          clicks30d: Number(stats.totalClicks ?? 0),
          humanClicks30d: Number(stats.humanClicks ?? 0),
          clicksChange: stats.totalClicksChange !== undefined ? Number(stats.totalClicksChange) : null,
          chartData,
          // Par lien : referer avec champ "referer" (pas "refhost")
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
          id: l.id,
          path: l.path || '',
          shortUrl: l.secureShortURL || l.shortURL || `https://${domain}/${l.path}`,
          originalUrl: l.originalURL || '',
          title: l.title || l.path || '',
          createdAt: l.createdAt || null,
          clicks30d: 0, humanClicks30d: 0, clicksChange: null,
          chartData: [], countries: [], referrers: [], browsers: [], os: [], social: [], cities: [], utmMedium: [], utmSource: [],
        };
      }
    })
  );

  // Tri par clics décroissant
  linksWithStats.sort((a, b) => b.clicks30d - a.clicks30d);

  return NextResponse.json({
    domain,
    totalLinks,
    clicks30d: Number(domainStats.clicks ?? 0),
    humanClicks30d: Number(domainStats.humanClicks ?? 0),
    clicksChange: domainStats.prevClicksChange !== undefined ? Number(domainStats.prevClicksChange) : null,
    clicksPerLink30d: parseFloat(domainStats.clicksPerLink ?? '0') || 0,
    chartData: domainChartData,
    topCountries,
    topReferrers,
    topBrowsers,
    topOs,
    topSocial,
    topCities,
    links: linksWithStats,
  });
}
