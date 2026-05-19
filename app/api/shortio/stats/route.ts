import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getCreds(profileId: string): Promise<{ apiKey: string; domain: string; domainId: string } | null> {
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

  // Fetch domaine stats 30j + liste des liens en parallèle
  const [domainStatsRes, linksRes] = await Promise.all([
    fetch(`https://api-v2.short.io/statistics/domain/${domainId}?period=last30`, { headers }),
    fetch(`https://api.short.io/api/links?domain_id=${domainId}&limit=150`, { headers }),
  ]);

  const [domainStats, linksData] = await Promise.all([
    safeJson(domainStatsRes),
    safeJson(linksRes),
  ]);

  if (!domainStatsRes.ok) {
    return NextResponse.json({ error: domainStats?.message || domainStats?.error || 'Erreur Short.io', status: domainStatsRes.status, raw: domainStats }, { status: 400 });
  }

  // Clics par lien en masse
  const linkIds = (linksData?.links || []).map((l: any) => l.id).join(',');
  const clicksPerLinkRes = linkIds
    ? await fetch(`https://api-v2.short.io/statistics/domain/${domainId}/link_clicks?link_ids=${linkIds}`, { headers })
    : null;
  const clicksPerLink: Record<string, number> = clicksPerLinkRes ? await safeJson(clicksPerLinkRes) : {};

  // Stats par lien individuel (top 20 seulement pour éviter le rate limit)
  const topLinks = (linksData?.links || [])
    .map((l: any) => ({ ...l, clicks: clicksPerLink[String(l.id)] ?? l.totalClicks ?? 0 }))
    .sort((a: any, b: any) => b.clicks - a.clicks)
    .slice(0, 20);

  const linksWithStats = await Promise.all(
    topLinks.map(async (l: any) => {
      try {
        const statsRes = await fetch(`https://api-v2.short.io/statistics/link/${l.id}?period=last30`, { headers });
        const stats = await safeJson(statsRes);
        return {
          id: l.id,
          path: l.path || '',
          shortUrl: `https://${domain}/${l.path}`,
          originalUrl: l.originalURL || l.redirectURL || '',
          title: l.title || l.path || '',
          createdAt: l.createdAt || null,
          clicks30d: stats.totalClicks ?? l.clicks ?? 0,
          humanClicks30d: stats.humanClicks ?? 0,
          clicksChange: stats.clicksChange ?? 0,
          // Courbe clics/jour
          chartData: (stats.clickStatistics?.datasets?.[0]?.data || []).map((v: number, i: number) => {
            const labels = stats.clickStatistics?.labels || [];
            return { date: labels[i] || `J${i + 1}`, clicks: v };
          }),
          // Top pays
          countries: (stats.countries || []).slice(0, 5).map((c: any) => ({ label: c.country || c.label, value: c.score || c.value || 0 })),
          // Top referrers
          referrers: (stats.referer || stats.referrers || []).slice(0, 5).map((r: any) => ({ label: r.referer || r.label || 'Direct', value: r.score || r.value || 0 })),
          // Browsers
          browsers: (stats.browsers || []).slice(0, 5).map((b: any) => ({ label: b.browser || b.label, value: b.score || b.value || 0 })),
          // OS
          os: (stats.os || []).slice(0, 5).map((o: any) => ({ label: o.os || o.label, value: o.score || o.value || 0 })),
          // Devices
          devices: (stats.devices || []).slice(0, 3).map((d: any) => ({ label: d.device || d.label, value: d.score || d.value || 0 })),
        };
      } catch {
        return {
          id: l.id,
          path: l.path || '',
          shortUrl: `https://${domain}/${l.path}`,
          originalUrl: l.originalURL || l.redirectURL || '',
          title: l.title || l.path || '',
          createdAt: l.createdAt || null,
          clicks30d: l.clicks ?? 0,
          humanClicks30d: 0,
          clicksChange: 0,
          chartData: [],
          countries: [],
          referrers: [],
          browsers: [],
          os: [],
          devices: [],
        };
      }
    })
  );

  // Courbe domaine clics/jour
  const domainChartData = (domainStats.clickStatistics?.datasets?.[0]?.data || []).map((v: number, i: number) => {
    const labels = domainStats.clickStatistics?.labels || [];
    return { date: labels[i] || `J${i + 1}`, clicks: v };
  });

  return NextResponse.json({
    domain,
    totalLinks: Number(linksData?.count ?? linksData?.links?.length ?? 0),
    // Stats domaine 30j
    clicks30d: Number(domainStats.totalClicks ?? domainStats.clicks ?? 0),
    humanClicks30d: Number(domainStats.humanClicks ?? 0),
    clicksChange: Number(domainStats.clicksChange ?? 0),
    clicksPerLink30d: Number(domainStats.clicksPerLink ?? domainStats.clicksPerLinkChange ?? 0),
    // Top pays/referrers domaine
    topCountries: (domainStats.countries || []).slice(0, 8).map((c: any) => ({ label: c.country || c.label, value: c.score || c.value || 0 })),
    topReferrers: (domainStats.referer || domainStats.referrers || []).slice(0, 8).map((r: any) => ({ label: r.referer || r.label || 'Direct', value: r.score || r.value || 0 })),
    topBrowsers: (domainStats.browsers || []).slice(0, 5).map((b: any) => ({ label: b.browser || b.label, value: b.score || b.value || 0 })),
    topOs: (domainStats.os || []).slice(0, 5).map((o: any) => ({ label: o.os || o.label, value: o.score || o.value || 0 })),
    topDevices: (domainStats.devices || []).slice(0, 3).map((d: any) => ({ label: d.device || d.label, value: d.score || d.value || 0 })),
    chartData: domainChartData,
    links: linksWithStats,
  });
}
