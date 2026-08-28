// Edge Function one-shot — backfill historique Short.io
// Récupère le chartData 30j par lien depuis l'API Short.io et insère les snapshots
// journaliers manquants dans shortio_link_daily_snapshots.
// À déclencher une seule fois manuellement via Supabase Dashboard ou curl.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createLinkCategoryResolver } from '../../../lib/shortio-link-category.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const safeJson = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

async function fetchShortioLinksForDomain(apiKey: string, domainId: string): Promise<any[]> {
  const headers = { authorization: apiKey, accept: 'application/json' };
  const all: any[] = [];
  let beforeId: string | undefined;
  while (true) {
    const url = `https://api.short.io/api/links?domain_id=${domainId}&limit=150${beforeId ? `&beforeId=${beforeId}` : ''}`;
    const res = await fetch(url, { headers });
    if (!res.ok) break;
    const data = await safeJson(res);
    const page: any[] = data?.links ?? [];
    if (!page.length) break;
    all.push(...page);
    if (page.length < 150) break;
    beforeId = String(page[page.length - 1].id);
  }
  return all;
}

// Un élève peut avoir changé de domaine Short.io — ses liens sur l'ancien domaine
// restent actifs (posts déjà publiés) mais un backfill limité au seul domaine actif les
// manquerait entièrement. Même principe que snapshotOldDomainLinks côté poll-leads.
async function fetchShortioLinksAllDomains(
  apiKey: string,
  domains: { id: string | number; hostname: string }[],
): Promise<{ link: any; hostname: string }[]> {
  const all: { link: any; hostname: string }[] = [];
  for (const d of domains) {
    const links = await fetchShortioLinksForDomain(apiKey, String(d.id));
    all.push(...links.map(link => ({ link, hostname: d.hostname })));
  }
  return all;
}

Deno.serve(async (req) => {
  // Auth
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const results: Record<string, any> = {};

  // Récupère tous les profils avec une intégration Short.io active
  const { data: integrations } = await supa
    .from('integrations')
    .select('profile_id, api_key, metadata')
    .eq('provider', 'shortio');

  if (!integrations?.length) {
    return new Response(JSON.stringify({ message: 'no shortio integrations' }), { status: 200 });
  }

  for (const integ of integrations) {
    const profileId = integ.profile_id;
    const apiKey = integ.api_key;
    const domain = (integ.metadata as any)?.domain;
    const domainId = String((integ.metadata as any)?.domain_id || '');
    if (!apiKey || !domain || !domainId) continue;
    const allDomains = ((integ.metadata as any)?.all_domains as { id: string | number; hostname: string }[] | undefined)
      ?? [{ id: domainId, hostname: domain }];

    const headers = { authorization: apiKey, accept: 'application/json' };

    // Même règle de catégorie que le cron et le bouton Rafraîchir
    // (lib/shortio-link-category.ts, source unique). La copie qui vivait ici
    // ignorait utm_medium=story : tous les liens Calendly de séquence story
    // étaient rétro-remplis sans catégorie, donc absents de « Clics totaux ».
    const [{ data: contentLinksRows }, { data: prospectLinksRows }] = await Promise.all([
      supa.from('content_links').select('platform, desc_calendly_short_url, desc_lm_short_url, lm_short_url').eq('profile_id', profileId),
      supa.from('prospect_links').select('short_url').eq('profile_id', profileId),
    ]);
    const resolveLinkCategory = createLinkCategoryResolver({
      contentLinks: contentLinksRows ?? [],
      prospectShortUrls: (prospectLinksRows ?? []).map((pl: any) => pl.short_url),
    });

    // Récupère tous les liens de tous les domaines connus du compte (actif + anciens)
    let linksWithDomain: { link: any; hostname: string }[];
    try { linksWithDomain = await fetchShortioLinksAllDomains(apiKey, allDomains); } catch (e: any) {
      results[profileId] = { error: `fetch_links: ${e?.message}` };
      continue;
    }

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    // Pour chaque lien : récupère le chartData 30j et insère les jours manquants
    for (const { link: l, hostname } of linksWithDomain) {
      try {
        const linkId = String(l.id);
        const path = l.path || '';
        const shortUrl = l.secureShortURL || l.shortURL || `https://${hostname}/${path}`;
        const originalUrl = l.originalURL || '';
        let link_type: string | null = null;
        try { link_type = new URL(originalUrl).searchParams.get('utm_medium') || null; } catch {}
        const link_category = resolveLinkCategory(path, shortUrl, originalUrl);

        const statsRes = await fetch(`https://api-v2.short.io/statistics/link/${linkId}?period=last30`, { headers });
        if (!statsRes.ok) { skipped++; continue; }
        const stats = await safeJson(statsRes);

        const chartRaw: { x: string; y: string }[] = stats.clickStatistics?.datasets?.[0]?.data || [];
        if (!chartRaw.length) { skipped++; continue; }

        // Insère chaque jour du chartData — ignoreDuplicates pour ne pas écraser les snapshots existants
        const rows = chartRaw.map((pt) => ({
          profile_id: profileId,
          link_id: linkId,
          path,
          short_url: shortUrl,
          original_url: originalUrl,
          date: pt.x.split('T')[0],
          link_type,
          link_category,
          human_clicks: Number(pt.y) || 0,
          total_clicks: Number(pt.y) || 0,
          backfill_source: 'backfill-shortio',
        }));

        const { error } = await supa
          .from('shortio_link_daily_snapshots')
          .upsert(rows, { onConflict: 'profile_id,link_id,date', ignoreDuplicates: true });

        if (error) { errors++; } else { inserted += rows.length; }

        // Pause pour ne pas dépasser le rate limit Short.io
        await new Promise(r => setTimeout(r, 100));
      } catch {
        errors++;
      }
    }

    results[profileId] = { links: linksWithDomain.length, inserted, skipped, errors };
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
