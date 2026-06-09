import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ShortioLinkCreds {
  apiKey: string;
  domain: string;
  domainId: string | number;
}

export interface ShortioLinkRow {
  id: string;
  path: string;
  shortUrl: string;
  originalUrl: string;
  title: string;
  createdAt: string | null;
}

export interface ShortioLinkSnapshot {
  link_id: string;
  path: string;
  short_url: string;
  original_url: string;
  date: string;
  human_clicks: number;
  total_clicks: number;
  link_type: string | null;
  top_countries: { label: string; code: string; value: number }[];
  top_referrers: { label: string; value: number }[];
  top_browsers:  { label: string; value: number }[];
  top_os:        { label: string; value: number }[];
  top_social:    { label: string; value: number }[];
  top_cities:    { label: string; value: number }[];
  utm_sources:   { label: string; value: number }[];
  utm_mediums:   { label: string; value: number }[];
}

// ── Credentials depuis integrations ──────────────────────────────────────────
export async function getShortioLinkCreds(profileId: string): Promise<ShortioLinkCreds | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'shortio')
    .single();

  if (!integ?.api_key) return null;
  const domain   = (integ.metadata as any)?.domain    || null;
  const domainId = (integ.metadata as any)?.domain_id || null;
  if (!domain || !domainId) return null;
  return { apiKey: integ.api_key, domain, domainId };
}

// ── Liste des liens du domaine ────────────────────────────────────────────────
export async function fetchShortioLinks(creds: ShortioLinkCreds): Promise<ShortioLinkRow[]> {
  const res = await fetch(
    `https://api.short.io/api/links?domain_id=${creds.domainId}&limit=150`,
    { headers: { authorization: creds.apiKey, accept: 'application/json' } }
  );
  if (!res.ok) throw new Error(`Short.io links ${res.status}`);
  const data = await res.json();
  const links: any[] = data?.links || [];
  return links.map((l: any) => ({
    id:          String(l.id),
    path:        l.path || '',
    shortUrl:    l.secureShortURL || l.shortURL || `https://${creds.domain}/${l.path}`,
    originalUrl: l.originalURL || '',
    title:       l.title || l.path || '',
    createdAt:   l.createdAt || null,
  }));
}

// ── Stats d'un lien pour une période (today | yesterday | last7 | last30 | custom) ──
export async function fetchShortioLinkStats(
  creds: ShortioLinkCreds,
  link: ShortioLinkRow,
  period: string,
  date: string, // date ISO YYYY-MM-DD à stocker dans le snapshot
): Promise<ShortioLinkSnapshot> {
  const res = await fetch(
    `https://api-v2.short.io/statistics/link/${link.id}?period=${period}`,
    { headers: { authorization: creds.apiKey, accept: 'application/json' } }
  );

  // Dériver link_type depuis utm_medium de l'originalUrl
  let link_type: string | null = null;
  try { link_type = new URL(link.originalUrl).searchParams.get('utm_medium') || null; } catch {}

  if (!res.ok) return emptySnapshot(link, date, link_type);

  let stats: any = {};
  try { stats = await res.json(); } catch { return emptySnapshot(link, date, link_type); }

  const pick = (arr: any[], labelKey: string, extraKey?: string) =>
    (arr || [])
      .filter((x: any) => x.score > 0)
      .slice(0, 8)
      .map((x: any) => ({ label: x[labelKey] || x[extraKey || labelKey] || 'Inconnu', value: Number(x.score) }));

  return {
    link_id:      link.id,
    path:         link.path,
    short_url:    link.shortUrl,
    original_url: link.originalUrl,
    date,
    link_type,
    human_clicks: Number(stats.humanClicks ?? 0),
    total_clicks: Number(stats.totalClicks ?? 0),
    top_countries: (stats.country || [])
      .filter((c: any) => c.score > 0).slice(0, 8)
      .map((c: any) => ({ label: c.countryName || c.country || 'Inconnu', code: c.country || '', value: Number(c.score) })),
    top_referrers: pick(stats.referer,   'refhost', 'referer').map(x => ({ ...x, label: x.label || 'Direct' })),
    top_browsers:  pick(stats.browser,   'browser'),
    top_os:        pick(stats.os,        'os'),
    top_social:    pick(stats.social,    'social').map(x => ({ ...x, label: x.label || 'Direct' })),
    top_cities:    (stats.city || [])
      .filter((c: any) => c.score > 0).slice(0, 8)
      .map((c: any) => ({ label: `${c.name || '?'} (${c.countryCode || '?'})`, value: Number(c.score) })),
    utm_sources:   (stats.utm_source || [])
      .filter((u: any) => u.score > 0 && u.utm_source).slice(0, 8)
      .map((u: any) => ({ label: u.utm_source, value: Number(u.score) })),
    utm_mediums:   (stats.utm_medium || [])
      .filter((u: any) => u.score > 0 && u.utm_medium).slice(0, 8)
      .map((u: any) => ({ label: u.utm_medium, value: Number(u.score) })),
  };
}

function emptySnapshot(link: ShortioLinkRow, date: string, link_type: string | null = null): ShortioLinkSnapshot {
  return {
    link_id: link.id, path: link.path, short_url: link.shortUrl,
    original_url: link.originalUrl, date, link_type,
    human_clicks: 0, total_clicks: 0,
    top_countries: [], top_referrers: [], top_browsers: [],
    top_os: [], top_social: [], top_cities: [],
    utm_sources: [], utm_mediums: [],
  };
}

// ── Upsert un snapshot dans shortio_link_daily_snapshots ─────────────────────
export async function upsertShortioLinkSnapshot(
  profileId: string,
  row: ShortioLinkSnapshot,
  source: 'cron' | 'refresh_partial',
): Promise<string | null> {
  const { error } = await serviceSupabase
    .from('shortio_link_daily_snapshots')
    .upsert({
      profile_id:    profileId,
      link_id:       row.link_id,
      path:          row.path,
      short_url:     row.short_url,
      original_url:  row.original_url,
      date:          row.date,
      human_clicks:  row.human_clicks,
      total_clicks:  row.total_clicks,
      link_type:     row.link_type,
      top_countries: row.top_countries,
      top_referrers: row.top_referrers,
      top_browsers:  row.top_browsers,
      top_os:        row.top_os,
      top_social:    row.top_social,
      top_cities:    row.top_cities,
      utm_sources:   row.utm_sources,
      utm_mediums:   row.utm_mediums,
      backfill_source: source,
    }, { onConflict: 'profile_id,link_id,date', ignoreDuplicates: false });

  return error ? error.message : null;
}

// ── Helper principal : snapshot complet pour un profil sur une période ────────
export async function snapshotShortioLinks(
  profileId: string,
  period: 'yesterday' | 'today',
  source: 'cron' | 'refresh_partial',
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];

  const creds = await getShortioLinkCreds(profileId);
  if (!creds) return { synced: 0, errors: ['no_shortio_creds'] };

  let links: ShortioLinkRow[];
  try {
    links = await fetchShortioLinks(creds);
  } catch (e: any) {
    return { synced: 0, errors: [`fetch_links: ${e?.message || 'unknown'}`] };
  }

  if (!links.length) return { synced: 0, errors: [] };

  // Upsert métadonnées des liens (title, createdAt) — une fois par nuit, non bloquant
  serviceSupabase.from('shortio_links_metadata').upsert(
    links.map(l => ({
      link_id:    l.id,
      profile_id: profileId,
      title:      l.title,
      path:       l.path,
      created_at: l.createdAt,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'link_id', ignoreDuplicates: false }
  ).then(({ error }) => {
    if (error) console.error('[shortio-fetch] metadata_upsert:', error.message);
  });

  // Date cible
  const d = new Date();
  if (period === 'yesterday') d.setDate(d.getDate() - 1);
  const date = d.toISOString().split('T')[0];

  // Fetch stats pour chaque lien en parallèle (Promise.allSettled → robuste)
  const settled = await Promise.allSettled(
    links.map(link => fetchShortioLinkStats(creds, link, period, date))
  );

  let synced = 0;
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const link = links[i];
    const snapshot = s.status === 'fulfilled'
      ? s.value
      : emptySnapshot(link, date);

    if (s.status === 'rejected') {
      errors.push(`fetch_link_${link.path}: ${s.reason?.message || 'unknown'}`);
    }

    const upsertErr = await upsertShortioLinkSnapshot(profileId, snapshot, source);
    if (upsertErr) errors.push(`upsert_${link.path}: ${upsertErr}`);
    else synced++;
  }

  return { synced, errors };
}
