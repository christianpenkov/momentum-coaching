import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { isYtVideoId } from '@/lib/ytId';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// PostgREST plafonne à 1000 lignes par défaut — sans pagination explicite, une requête
// avec beaucoup de liens tronquerait silencieusement les résultats. Boucle par pages de
// 1000 jusqu'à épuisement.
async function fetchAllPages<T>(
  queryBuilder: () => any,
  pageSize = 1000
): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder().range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

async function getCreds(profileId: string): Promise<{ apiKey: string; domain: string; domainId: string | number; allDomains: { id: string | number; hostname: string }[] } | null> {
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
  // Un élève peut avoir changé de domaine Short.io (ex: ubizenai.s.gy → link.ubizenai.com)
  // sans avoir supprimé les anciens liens, toujours actifs en description de posts publiés
  // avant le changement — même bug/fix que snapshotOldDomainLinks côté cron poll-leads
  // (2026-08-14). all_domains liste tous les domaines connus du compte ; fallback sur le
  // seul domaine actif si absent (comptes connectés avant l'ajout de ce champ).
  const allDomains = ((integ.metadata as any)?.all_domains as { id: string | number; hostname: string }[] | undefined)
    ?? [{ id: domainId, hostname: domain }];
  return { apiKey: integ.api_key, domain, domainId, allDomains };
}

// Fetch complet Short.io — appelé seulement si cache expiré
async function fetchFromShortio(creds: { apiKey: string; domain: string; domainId: string | number; allDomains: { id: string | number; hostname: string }[] }, profileId: string) {
  const { apiKey, domain, domainId, allDomains } = creds;
  const headers = { authorization: apiKey, accept: 'application/json' };
  const safeJson = async (res: Response) => { try { return await res.json(); } catch { return {}; } };

  const [domainStatsRes, ...linksResPerDomain] = await Promise.all([
    fetch(`https://api-v2.short.io/statistics/domain/${domainId}?period=last30`, { headers }),
    ...allDomains.map(d => fetch(`https://api.short.io/api/links?domain_id=${d.id}&limit=150`, { headers })),
  ]);

  const [domainStats, ...linksDataPerDomain] = await Promise.all([
    safeJson(domainStatsRes),
    ...linksResPerDomain.map(safeJson),
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

  // Fusionne les liens de tous les domaines (actif + anciens) — chaque lien garde une
  // trace de son domaine d'origine pour le fallback shortUrl (l.secureShortURL/shortURL
  // manque rarement, mais si l'API ne renvoie que le path, il faut savoir sur quel
  // hostname le reconstruire, pas toujours celui actuellement actif).
  const allLinks: any[] = linksDataPerDomain.flatMap((linksData, i) =>
    (linksData?.links || []).map((l: any) => ({ ...l, __domainHostname: allDomains[i]?.hostname || domain }))
  );
  const totalLinks = linksDataPerDomain.reduce((s, d) => s + Number(d?.count ?? 0), 0) || allLinks.length;

  // ── Clics par lien : lus depuis la DB, jamais depuis l'API Short.io ─────────
  // Avant : 1 appel /statistics/link par lien, donc un plafond .slice(0, 20) pour tenir
  // dans le quota Short.io (60 req/fenêtre, partagé entre TOUS les profils du même run).
  // Ce plafond perdait silencieusement des liens dès qu'un élève en avait plus de 20
  // (observé : 26 liens bio/description sur ce profil, 6 ignorés à chaque affichage, et
  // le tri par clics n'intervenait qu'APRÈS la coupe — donc la sélection se faisait sur
  // l'ordre brut de l'API, pas sur l'importance réelle).
  // shortio_link_daily_snapshots contient déjà ces clics pour TOUS les liens et tous les
  // domaines (écrits par le cron poll-leads toutes les 30 min) : on les agrège en SQL,
  // sans plafond, sans quota, et le chartData par lien se reconstruit à partir des lignes
  // journalières. Les champs de détail (countries/browsers/cities/os/social/referrers)
  // ne sont affichés nulle part dans l'app (vérifié : seules des déclarations de type,
  // plus un helper topRef jamais appelé) — ils restent à [] pour ne pas casser le type.
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dbRows = await fetchAllPages<{
    link_id: string; path: string | null; short_url: string | null; original_url: string;
    link_type: string | null; link_category: string | null; date: string;
    human_clicks: number | null; total_clicks: number | null;
  }>(() =>
    serviceSupabase
      .from('shortio_link_daily_snapshots')
      .select('link_id, path, short_url, original_url, link_type, link_category, date, human_clicks, total_clicks')
      .eq('profile_id', profileId)
      .gte('date', since30d)
  );

  const derivePostPlatform = (originalUrl: string): string | null => {
    try {
      const u = new URL(originalUrl);
      const utmSource = u.searchParams.get('utm_source') || '';
      const utmMedium = u.searchParams.get('utm_medium') || '';
      const utmContent = u.searchParams.get('utm_content') || '';
      if (utmSource === 'yt') return 'YT';
      if (utmMedium === 'description' && isYtVideoId(utmContent)) return 'YT';
      if (utmSource === 'ig' || utmSource.includes('ubizenai')) return 'IG';
    } catch {}
    return null;
  };

  // Agrégation par link_id : somme des clics sur la fenêtre + série journalière.
  // link_type/link_category/original_url : première valeur non nulle rencontrée (le cron
  // écrit parfois null sur les lignes d'anciens domaines pour ne pas écraser l'existant).
  type LinkAgg = {
    path: string; shortUrl: string; originalUrl: string;
    linkType: string | null; linkCategory: string | null;
    clicsAvecBots: number; clicsHumains: number;
    chart: Map<string, number>;
  };
  const aggByLinkId = new Map<string, LinkAgg>();
  for (const row of dbRows) {
    let agg = aggByLinkId.get(row.link_id);
    if (!agg) {
      agg = {
        path: row.path || '', shortUrl: row.short_url || '', originalUrl: row.original_url || '',
        linkType: null, linkCategory: null, clicsAvecBots: 0, clicsHumains: 0, chart: new Map(),
      };
      aggByLinkId.set(row.link_id, agg);
    }
    if (!agg.linkType && row.link_type) agg.linkType = row.link_type;
    if (!agg.linkCategory && row.link_category) agg.linkCategory = row.link_category;
    if (!agg.originalUrl && row.original_url) agg.originalUrl = row.original_url;
    if (!agg.shortUrl && row.short_url) agg.shortUrl = row.short_url;
    if (!agg.path && row.path) agg.path = row.path;
    const human = row.human_clicks ?? 0;
    const total = row.total_clicks ?? 0;
    agg.clicsHumains += human;
    agg.clicsAvecBots += total;
    agg.chart.set(row.date, (agg.chart.get(row.date) ?? 0) + human);
  }

  // Métadonnées de présentation (titre, date de création) depuis l'API : les liens
  // remontés par la liste ci-dessus, indexés pour compléter les lignes DB.
  const apiLinkById = new Map<string, any>(allLinks.map((l: any) => [String(l.id), l]));

  const enrichedLinks = [...aggByLinkId.entries()].map(([linkId, agg]) => {
    const apiLink = apiLinkById.get(linkId);
    return {
      id: linkId,
      path: agg.path || apiLink?.path || '',
      shortUrl: agg.shortUrl || apiLink?.secureShortURL || apiLink?.shortURL
        || `https://${apiLink?.__domainHostname || domain}/${agg.path || apiLink?.path || ''}`,
      originalUrl: agg.originalUrl || apiLink?.originalURL || '',
      title: apiLink?.title || agg.path || '',
      createdAt: apiLink?.createdAt || null,
      clicsAvecBots: agg.clicsAvecBots,
      clicsHumains: agg.clicsHumains,
      clicksChange: null,
      chartData: [...agg.chart.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, clicks]) => ({ date, clicks })),
      countries: [], referrers: [], browsers: [], os: [], social: [], cities: [], utmMedium: [], utmSource: [],
      linkType: agg.linkType,
      linkCategory: agg.linkCategory,
      postPlatform: derivePostPlatform(agg.originalUrl || apiLink?.originalURL || ''),
    };
  });

  enrichedLinks.sort((a, b) => b.clicsAvecBots - a.clicsAvecBots);

  return {
    domain, totalLinks,
    clicsAvecBots: Number(domainStats.clicks ?? 0),
    clicsHumains: Number(domainStats.humanClicks ?? 0),
    clicksChange: domainStats.prevClicksChange !== undefined ? Number(domainStats.prevClicksChange) : null,
    clicsHumainsParLien: parseFloat(domainStats.clicksPerLink ?? '0') || 0,
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
