// Edge Function one-shot — backfill historique Short.io
// Récupère le chartData 30j par lien depuis l'API Short.io et insère les snapshots
// journaliers manquants dans shortio_link_daily_snapshots.
// À déclencher une seule fois manuellement via Supabase Dashboard ou curl.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const safeJson = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

async function fetchShortioLinks(creds: { apiKey: string; domainId: string }): Promise<any[]> {
  const headers = { authorization: creds.apiKey, accept: 'application/json' };
  const all: any[] = [];
  let beforeId: string | undefined;
  while (true) {
    const url = `https://api.short.io/api/links?domain_id=${creds.domainId}&limit=150${beforeId ? `&beforeId=${beforeId}` : ''}`;
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

    const headers = { authorization: apiKey, accept: 'application/json' };

    // Tables de référence pour link_category
    const [{ data: contentLinksRows }, { data: prospectLinksRows }] = await Promise.all([
      supa.from('content_links').select('platform, desc_calendly_short_url, desc_lm_short_url, lm_short_url').eq('profile_id', profileId),
      supa.from('prospect_links').select('short_url').eq('profile_id', profileId),
    ]);

    const descCalendlyIg = new Set<string>();
    const descCalendlyYt = new Set<string>();
    const descLmIg = new Set<string>();
    const descLmYt = new Set<string>();
    const lmDmAutoUrls = new Set<string>();
    for (const cl of contentLinksRows ?? []) {
      const platform = (cl.platform || '').toUpperCase();
      if (cl.desc_calendly_short_url) (platform === 'YT' ? descCalendlyYt : descCalendlyIg).add(cl.desc_calendly_short_url.toLowerCase());
      if (cl.desc_lm_short_url) (platform === 'YT' ? descLmYt : descLmIg).add(cl.desc_lm_short_url.toLowerCase());
      if (cl.lm_short_url) lmDmAutoUrls.add(cl.lm_short_url.toLowerCase());
    }
    const prospectUrls = new Set<string>((prospectLinksRows ?? []).map((pl: any) => (pl.short_url || '').toLowerCase()));

    const resolveLinkCategory = (path: string, shortUrl: string, linkType: string | null): string | null => {
      const p = path.toLowerCase();
      const u = shortUrl.toLowerCase();
      if (linkType === 'bio') {
        const hasIg = p.includes('ig') || p.includes('-ig');
        const hasYt = p.includes('yt') || p.includes('-yt');
        const isCalendly = p.includes('calendly') || p.startsWith('bio-calendly');
        const isLm = p.startsWith('lm-bio') || p.startsWith('lm-');
        if (isCalendly && hasIg) return 'calendly_bio_ig';
        if (isCalendly && hasYt) return 'calendly_bio_yt';
        if (isLm && hasYt) return 'lm_bio_yt';
        if (isLm && hasIg) return 'lm_bio_ig';
        if (hasIg) return 'calendly_bio_ig';
        if (hasYt) return 'calendly_bio_yt';
      }
      if (linkType === 'description') {
        if (descCalendlyIg.has(u)) return 'calendly_desc_ig';
        if (descCalendlyYt.has(u)) return 'calendly_desc_yt';
        if (descLmIg.has(u)) return 'lm_desc_ig';
        if (descLmYt.has(u)) return 'lm_desc_yt';
      }
      if (linkType === 'leadmagnet' || (linkType === null && (p.startsWith('lm-') || p.startsWith('guide-') || p.startsWith('beau-')))) {
        return 'lm_dm_auto';
      }
      if (linkType === 'dm' || (linkType === null && (p.includes('prendre-rdv') || p.includes('christian') || p.includes('incogniton')))) {
        if (prospectUrls.has(u)) return 'calendly_dm_prospect';
        if (p.startsWith('lm-')) return 'lm_dm_auto';
        return 'calendly_dm_prospect';
      }
      return null;
    };

    // Récupère tous les liens du domaine
    let links: any[];
    try { links = await fetchShortioLinks({ apiKey, domainId }); } catch (e: any) {
      results[profileId] = { error: `fetch_links: ${e?.message}` };
      continue;
    }

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    // Pour chaque lien : récupère le chartData 30j et insère les jours manquants
    for (const l of links) {
      try {
        const linkId = String(l.id);
        const path = l.path || '';
        const shortUrl = l.secureShortURL || l.shortURL || `https://${domain}/${path}`;
        const originalUrl = l.originalURL || '';
        let link_type: string | null = null;
        try { link_type = new URL(originalUrl).searchParams.get('utm_medium') || null; } catch {}
        const link_category = resolveLinkCategory(path, shortUrl, link_type);

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

    results[profileId] = { links: links.length, inserted, skipped, errors };
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
