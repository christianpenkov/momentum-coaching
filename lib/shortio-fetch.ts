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

  if (error) return error.message;

  // Si des clics humains existent, mettre à jour first_click_at.
  // Condition stricte : le lien doit avoir été envoyé (calendly_link_sent = true).
  // Sans envoi confirmé, les clics viennent forcément d'un lead précédent qui avait
  // utilisé le même path Short.io — on ne les comptabilise pas pour ce lead.
  if (row.human_clicks > 0) {
    const { data: pl } = await serviceSupabase
      .from('prospect_links')
      .select('id, ig_username, ig_lead_id, first_click_at, calendly_link_sent, calendly_link_sent_at')
      .eq('profile_id', profileId)
      .filter('short_url', 'like', `%/${row.path}`)
      .maybeSingle();

    if (pl && pl.calendly_link_sent && pl.calendly_link_sent_at) {
      // Ne comptabiliser un clic que si le snapshot date d'après l'envoi du lien
      // Les clics cumulés historiques (path Short.io réutilisé) sont ignorés
      const snapshotDate = new Date(row.date + 'T00:00:00Z');
      const sentAt = new Date(pl.calendly_link_sent_at);
      const clickIsAfterSend = snapshotDate >= new Date(sentAt.toISOString().slice(0, 10) + 'T00:00:00Z');

      if (clickIsAfterSend && !pl.first_click_at) {
        const snapshotClickAt = new Date().toISOString();
        await serviceSupabase
          .from('prospect_links')
          .update({ first_click_at: snapshotClickAt })
          .eq('id', pl.id);

        // Upsert l'événement link_clicked avec la date du snapshot courant
        await serviceSupabase.from('prospect_events').upsert({
          profile_id:       profileId,
          prospect_key:     pl.ig_username,
          platform:         'ig',
          event_type:       'link_clicked',
          occurred_at:      snapshotClickAt,
          ig_lead_id:       pl.ig_lead_id,
          prospect_link_id: pl.id,
        }, { onConflict: 'prospect_link_id,event_type' });
      }
    }

    // Second check : lien LM personnalisé sur instagram_leads.tracking_link
    // On vérifie le total cumulé (pas juste le snapshot du jour) pour ne pas rater les clics passés
    if (!pl) {
      const { data: cumulRow } = await serviceSupabase
        .from('shortio_link_daily_snapshots')
        .select('human_clicks')
        .eq('profile_id', profileId)
        .eq('path', row.path)
        .gt('human_clicks', 0)
        .limit(1)
        .maybeSingle();

      if (cumulRow) {
        const { data: igLead } = await serviceSupabase
          .from('instagram_leads')
          .select('id, ig_username, profile_id')
          .eq('profile_id', profileId)
          .filter('tracking_link', 'like', `%/${row.path}`)
          .maybeSingle();

        if (igLead) {
          const { error: evtErr } = await serviceSupabase.from('prospect_events').upsert({
            profile_id:   profileId,
            prospect_key: igLead.ig_username.toLowerCase(),
            platform:     'ig',
            event_type:   'lm_clicked',
            occurred_at:  new Date().toISOString(),
            ig_lead_id:   igLead.id,
          }, { onConflict: 'ig_lead_id,event_type', ignoreDuplicates: true });
          if (evtErr) console.error('[shortio-fetch] lm_clicked upsert:', evtErr.message);
        }
      }
    }
  }

  return null;
}

// ── Click stream : attribution lm_clicked + link_clicked avec timestamp précis ──
// afterDate : ISO string — ne récupère que les clics après cette date
// Traite deux types de liens :
//   - lm-* → lm_clicked sur instagram_leads.tracking_link
//   - liens Calendly (prospect_links) → link_clicked si clic postérieur à calendly_link_sent_at
export async function syncLmClickStream(
  profileId: string,
  creds: ShortioLinkCreds,
  afterDate: string,
): Promise<string[]> {
  const errors: string[] = [];
  try {
    const res = await fetch(
      `https://api-v2.short.io/statistics/domain/${creds.domainId}/last_clicks`,
      {
        method: 'POST',
        headers: { authorization: creds.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ limit: 500, afterDate }),
      }
    );
    if (!res.ok) return [`click_stream_${res.status}`];

    const data = await res.json();
    const rawClicks: { path: string; dt: string; human: boolean }[] = data?.clicks ?? data ?? [];
    const humanClicks = rawClicks.filter(c => c.human === true && c.path);

    // ── LM clicks (paths lm-*) ──────────────────────────────────────────────
    for (const click of humanClicks.filter(c => c.path.replace(/^\//, '').startsWith('lm-'))) {
      const clickedAt = click.dt ? new Date(click.dt).toISOString() : new Date().toISOString();
      const cleanPath = click.path.replace(/^\//, '');

      const { data: igLead } = await serviceSupabase
        .from('instagram_leads')
        .select('id, ig_username, detected_at')
        .eq('profile_id', profileId)
        .filter('tracking_link', 'like', `%/${cleanPath}`)
        .maybeSingle();

      if (!igLead) continue;
      if (new Date(clickedAt) < new Date(igLead.detected_at)) continue;

      // index partiel → select + insert conditionnel
      const { data: existing } = await serviceSupabase
        .from('prospect_events')
        .select('id')
        .eq('ig_lead_id', igLead.id)
        .eq('event_type', 'lm_clicked')
        .maybeSingle();

      if (!existing) {
        const { error: evtErr } = await serviceSupabase.from('prospect_events').insert({
          profile_id:   profileId,
          prospect_key: igLead.ig_username.toLowerCase(),
          platform:     'ig',
          event_type:   'lm_clicked',
          occurred_at:  clickedAt,
          ig_lead_id:   igLead.id,
        });
        if (evtErr) errors.push(`lm_clicked_${cleanPath}: ${evtErr.message}`);
      }
    }

    // ── Calendly link clicks (prospect_links) ───────────────────────────────
    // Tous les clics humains sur des paths non-lm — on cherche le prospect_link correspondant
    for (const click of humanClicks.filter(c => !c.path.replace(/^\//, '').startsWith('lm-'))) {
      const clickedAt = click.dt ? new Date(click.dt).toISOString() : new Date().toISOString();
      const cleanPath = click.path.replace(/^\//, '');

      const { data: pl } = await serviceSupabase
        .from('prospect_links')
        .select('id, ig_username, ig_lead_id, calendly_link_sent, calendly_link_sent_at, first_click_at')
        .eq('profile_id', profileId)
        .filter('short_url', 'like', `%/${cleanPath}`)
        .maybeSingle();

      if (!pl) continue;
      if (!pl.calendly_link_sent || !pl.calendly_link_sent_at) continue;
      // Le clic doit être postérieur à l'envoi du lien
      if (new Date(clickedAt) <= new Date(pl.calendly_link_sent_at)) continue;

      // Écrire first_click_at si pas encore renseigné
      if (!pl.first_click_at) {
        await serviceSupabase
          .from('prospect_links')
          .update({ first_click_at: clickedAt })
          .eq('id', pl.id);
      }

      // Upsert link_clicked dans prospect_events (index partiel sur prospect_link_id,event_type)
      const { data: existingEvt } = await serviceSupabase
        .from('prospect_events')
        .select('id')
        .eq('prospect_link_id', pl.id)
        .eq('event_type', 'link_clicked')
        .maybeSingle();

      if (!existingEvt) {
        const { error: evtErr } = await serviceSupabase.from('prospect_events').insert({
          profile_id:       profileId,
          prospect_key:     pl.ig_username.toLowerCase(),
          platform:         'ig',
          event_type:       'link_clicked',
          occurred_at:      clickedAt,
          ig_lead_id:       pl.ig_lead_id,
          prospect_link_id: pl.id,
        });
        if (evtErr) errors.push(`link_clicked_${cleanPath}: ${evtErr.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`click_stream: ${e?.message || 'unknown'}`);
  }
  return errors;
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
