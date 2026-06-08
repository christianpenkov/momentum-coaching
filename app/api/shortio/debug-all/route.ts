import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const safeJson = async (res: Response) => {
  try { return await res.json(); } catch { return { _parseError: true }; }
};

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'shortio')
    .single();

  if (!integ?.api_key) return NextResponse.json({ error: 'Pas de clé API Short.io' }, { status: 404 });

  const apiKey = integ.api_key;
  const domainId = (integ.metadata as any)?.domain_id;
  const h = { authorization: apiKey, accept: 'application/json' };
  const result: Record<string, any> = {};

  // 1. Liste des domaines
  const domainsRes = await fetch('https://api.short.io/api/domains', { headers: h });
  result.domains = { status: domainsRes.status, body: await safeJson(domainsRes) };

  if (!domainId) return NextResponse.json({ error: 'domain_id manquant dans metadata', result });

  // 2. Stats domaine — toutes les périodes
  const periods = ['today', 'yesterday', 'last7', 'last30'];
  result.domainStats = {};
  await Promise.all(periods.map(async (period) => {
    const res = await fetch(`https://api-v2.short.io/statistics/domain/${domainId}?period=${period}`, { headers: h });
    result.domainStats[period] = { status: res.status, body: await safeJson(res) };
  }));

  // 3. Liste des liens
  const linksRes = await fetch(`https://api.short.io/api/links?domain_id=${domainId}&limit=150`, { headers: h });
  const linksBody = await safeJson(linksRes);
  result.links = { status: linksRes.status, count: linksBody?.count, sampleLinks: (linksBody?.links || []).slice(0, 5) };

  const allLinks: any[] = linksBody?.links || [];
  const firstLink = allLinks[0];
  const prospectLink = allLinks.find((l: any) => l.path?.includes('christian') || l.path?.includes('prospect')) || firstLink;

  // 4. Stats lien individuel — premier lien + lien prospect si trouvé
  result.linkStats = {};
  const linksToTest = [...new Set([firstLink, prospectLink].filter(Boolean).map((l: any) => l.id))]
    .slice(0, 3);

  await Promise.all(linksToTest.map(async (linkId: string) => {
    const link = allLinks.find((l: any) => l.id === linkId);
    const statsResults: Record<string, any> = {};
    await Promise.all(periods.map(async (period) => {
      const res = await fetch(`https://api-v2.short.io/statistics/link/${linkId}?period=${period}`, { headers: h });
      statsResults[period] = { status: res.status, body: await safeJson(res) };
    }));
    result.linkStats[link?.path || linkId] = { linkId, shortUrl: link?.shortURL, originalUrl: link?.originalURL, stats: statsResults };
  }));

  // 5. Clics individuels (clicks feed) — si dispo
  const clicksRes = await fetch(`https://api-v2.short.io/statistics/domain/${domainId}/clicks?period=last30&limit=10`, { headers: h });
  result.clicksFeed = { status: clicksRes.status, body: await safeJson(clicksRes) };

  // 6. Tentative endpoint /clicks sur un lien
  if (firstLink) {
    const linkClicksRes = await fetch(`https://api-v2.short.io/statistics/link/${firstLink.id}/clicks?period=last30&limit=5`, { headers: h });
    result.linkClicksFeed = { status: linkClicksRes.status, body: await safeJson(linkClicksRes) };
  }

  return NextResponse.json(result, { status: 200 });
}
