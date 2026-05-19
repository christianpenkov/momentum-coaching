import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'shortio')
    .single();

  if (!integ?.api_key) return NextResponse.json({ error: 'Short.io non connecté' }, { status: 404 });

  const apiKey = integ.api_key;
  const domain = (integ.metadata as any)?.domain;
  const domainId = (integ.metadata as any)?.domain_id;
  const headers = { authorization: apiKey, accept: 'application/json' };

  const results: Record<string, any> = { apiKey_prefix: apiKey.slice(0, 8) + '...', domain, domainId };

  // 1. Liste des domaines
  const domainsRes = await fetch('https://api.short.io/api/domains', { headers });
  results.domains_status = domainsRes.status;
  results.domains_raw = await domainsRes.json().catch(() => 'parse error');

  if (!domainId) {
    return NextResponse.json({ error: 'domain_id manquant en metadata', results });
  }

  // 2. Stats domaine — toutes les périodes
  const periods = ['today', 'yesterday', 'week', 'month', 'lastmonth', 'last7', 'last30', 'total'];
  results.domain_stats = {};
  for (const period of periods) {
    const r = await fetch(`https://api-v2.short.io/statistics/domain/${domainId}?period=${period}`, { headers });
    results.domain_stats[period] = { status: r.status, data: await r.json().catch(() => 'parse error') };
  }

  // 3. Liste des liens
  const linksRes = await fetch(`https://api.short.io/api/links?domain_id=${domainId}&limit=5`, { headers });
  results.links_status = linksRes.status;
  const linksData = await linksRes.json().catch(() => ({}));
  results.links_raw = linksData;

  const links: any[] = linksData?.links || [];
  if (links.length > 0) {
    const firstLink = links[0];
    results.first_link = firstLink;

    // 4. Stats du premier lien — toutes les périodes
    results.link_stats = {};
    for (const period of ['last30', 'last7', 'month', 'total']) {
      const r = await fetch(`https://api-v2.short.io/statistics/link/${firstLink.id}?period=${period}`, { headers });
      results.link_stats[period] = { status: r.status, data: await r.json().catch(() => 'parse error') };
    }

    // 5. Clics par lien en masse
    const linkIds = links.map((l: any) => l.id).join(',');
    const clicksRes = await fetch(`https://api-v2.short.io/statistics/domain/${domainId}/link_clicks?link_ids=${linkIds}`, { headers });
    results.clicks_per_link_status = clicksRes.status;
    results.clicks_per_link_raw = await clicksRes.json().catch(() => 'parse error');

    // 6. Clickstream du premier lien
    const streamRes = await fetch(`https://api-v2.short.io/statistics/link/${firstLink.id}/clickstream?limit=5`, { headers });
    results.clickstream_status = streamRes.status;
    results.clickstream_raw = await streamRes.json().catch(() => 'parse error');
  }

  return NextResponse.json(results, { status: 200 });
}
