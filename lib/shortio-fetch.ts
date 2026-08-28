import { createClient } from '@supabase/supabase-js';
import { parisDateStr } from './period';
import { fetchClicsShortio, agregerClics, cleClic } from './shortio-clicks';
import { createLinkCategoryResolver, type LinkCategory } from './shortio-link-category';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ShortioLinkCreds {
  apiKey: string;
  domain: string;
  domainId: string | number;
  // Tous les domaines connus du compte Short.io de l'élève (actif + anciens) — un
  // élève qui a changé de domaine garde des liens toujours actifs (posts déjà publiés)
  // sur l'ancien. Sans ça, snapshotShortioLinks/syncLmClickStream ignorent
  // silencieusement les clics sur ces liens — même bug/fix que snapshotOldDomainLinks
  // côté cron poll-leads (2026-08-14). Fallback [domaine actif] si absent (comptes
  // connectés avant l'ajout de ce champ).
  allDomains: { id: string | number; hostname: string }[];
}

export interface ShortioLinkRow {
  id: string;
  path: string;
  shortUrl: string;
  originalUrl: string;
  title: string;
  createdAt: string | null;
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
  const allDomains = ((integ.metadata as any)?.all_domains as { id: string | number; hostname: string }[] | undefined)
    ?? [{ id: domainId, hostname: domain }];
  return { apiKey: integ.api_key, domain, domainId, allDomains };
}

// ── Liste des liens de TOUS les domaines du compte (actif + anciens), pagination
// cursor-based via beforeId propre à chaque domaine ─────────────────────────────
async function fetchShortioLinks(creds: ShortioLinkCreds): Promise<ShortioLinkRow[]> {
  const domains = creds.allDomains.length > 0 ? creds.allDomains : [{ id: creds.domainId, hostname: creds.domain }];
  const allLinks: any[] = [];

  for (const d of domains) {
    let beforeId: string | null = null;
    const limit = 150;
    while (true) {
      const url = new URL(`https://api.short.io/api/links`);
      url.searchParams.set('domain_id', String(d.id));
      url.searchParams.set('limit', String(limit));
      if (beforeId) url.searchParams.set('beforeId', beforeId);

      const res = await fetch(url.toString(), { headers: { authorization: creds.apiKey, accept: 'application/json' } });
      if (!res.ok) throw new Error(`Short.io links ${res.status}`);
      const data = await res.json();
      const page: any[] = data?.links || [];
      allLinks.push(...page.map((l: any) => ({ ...l, __domainHostname: d.hostname })));
      if (page.length < limit) break;
      beforeId = String(page[page.length - 1].id);
    }
  }

  return allLinks.map((l: any) => ({
    id:          String(l.id),
    path:        l.path || '',
    shortUrl:    l.secureShortURL || l.shortURL || `https://${l.__domainHostname || creds.domain}/${l.path}`,
    originalUrl: l.originalURL || '',
    title:       l.title || l.path || '',
    createdAt:   l.createdAt || null,
  }));
}

// ── Click stream : attribution lm_clicked + link_clicked avec timestamp précis ──
// afterDate : ISO string — ne récupère que les clics après cette date
// Traite deux types de liens :
//   - lm-* → lm_clicked sur instagram_leads.tracking_link
//   - liens Calendly (prospect_links) → link_clicked si clic postérieur à calendly_link_sent_at
// Rate-limit Short.io observé en prod sur cet endpoint précis quand deux domaines du
// même compte sont interrogés dos à dos (cf. supabase/functions/poll-leads/index.ts,
// snapshotOldDomainLinks, 2026-08-14 — x-ratelimit-limit=60, reset après ~48s). Lit le
// header x-ratelimit-reset pour attendre exactement le bon délai avant un unique retry,
// plutôt qu'un délai fixe qui ne correspond pas au vrai temps de réinitialisation.
const CLICK_STREAM_MAX_RATE_LIMIT_WAIT_MS = 60_000;
// Conservé pour la compatibilité de signature ; la lecture paginée réelle vit
// désormais dans lib/shortio-clicks.ts (source unique avec le cron).
async function fetchLastClicksWithRetry(domainId: string | number, apiKey: string, afterDate: string): Promise<Response> {
  const call = () => fetch(
    `https://api-v2.short.io/statistics/domain/${domainId}/last_clicks`,
    {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ limit: 500, afterDate }),
    }
  );
  let res = await call();
  if (res.status === 429) {
    const resetSeconds = Number(res.headers.get('x-ratelimit-reset'));
    const waitMs = Number.isFinite(resetSeconds) && resetSeconds > 0
      ? Math.min(resetSeconds * 1000 + 1000, CLICK_STREAM_MAX_RATE_LIMIT_WAIT_MS)
      : 10_000;
    await new Promise(r => setTimeout(r, waitMs));
    res = await call();
  }
  return res;
}

export async function syncLmClickStream(
  profileId: string,
  creds: ShortioLinkCreds,
  afterDate: string,
): Promise<string[]> {
  const errors: string[] = [];
  try {
    // Un domaine par appel — un élève qui a changé de domaine Short.io garde des liens
    // toujours actifs sur l'ancien, sinon leurs clics n'alimentent jamais l'attribution
    // temps réel (lm_clicked/link_clicked) ci-dessous.
    const domains = creds.allDomains.length > 0 ? creds.allDomains : [{ id: creds.domainId, hostname: creds.domain }];
    const rawClicks: { path: string; dt: string; human: boolean }[] = [];
    for (const d of domains) {
      const res = await fetchLastClicksWithRetry(d.id, creds.apiKey, afterDate);
      if (!res.ok) { errors.push(`click_stream_domain_${d.id}_${res.status}`); continue; }
      const data = await res.json();
      rawClicks.push(...((data?.clicks ?? data ?? []) as { path: string; dt: string; human: boolean }[]));
    }
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

      // Upsert avec occurred_at réel — le click stream doit toujours primer sur le timestamp
      // artificiel midi UTC que le snapshot daily peut avoir écrit en premier
      const { data: existing } = await serviceSupabase
        .from('prospect_events')
        .select('id, occurred_at')
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
      } else if (existing.occurred_at?.includes('T12:00:00')) {
        // Remplacer le timestamp artificiel midi UTC par la vraie heure du clic
        await serviceSupabase.from('prospect_events')
          .update({ occurred_at: clickedAt })
          .eq('id', existing.id);
      }
    }

    // ── Calendly link clicks (prospect_links) ───────────────────────────────
    // Tous les clics humains sur des paths non-lm — on cherche le prospect_link correspondant
    for (const click of humanClicks.filter(c => !c.path.replace(/^\//, '').startsWith('lm-'))) {
      const clickedAt = click.dt ? new Date(click.dt).toISOString() : new Date().toISOString();
      const cleanPath = click.path.replace(/^\//, '');

      const { data: pl } = await serviceSupabase
        .from('prospect_links')
        .select('id, ig_username, ig_lead_id, calendly_link_sent, calendly_link_sent_at, last_calendly_link_sent_at, first_click_at')
        .eq('profile_id', profileId)
        .filter('short_url', 'like', `%/${cleanPath}`)
        .maybeSingle();

      if (!pl) continue;
      const sentRefAt = pl.last_calendly_link_sent_at ?? pl.calendly_link_sent_at;
      if (!pl.calendly_link_sent || !sentRefAt) continue;
      if (new Date(clickedAt) <= new Date(sentRefAt)) continue;

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

// ── Bouton « Rafraîchir » : snapshot du jour ─────────────────────────────────
//
// Même source et même règle de date que le cron (lib/shortio-clicks.ts) : un clic
// appartient au jour PARIS de son horodatage. C'est indispensable, sinon le bouton
// réintroduirait les valeurs fausses que le cron vient de corriger.
//
// Il n'écrit QUE la journée en cours, et en mode monotone (jamais `p_ecraser`) :
// réparer les journées closes est le travail du cron, qui dispose d'une fenêtre de
// 7 jours. Le bouton doit rester rapide et ne jamais pouvoir dégrader l'historique.
//
// Coût : 1 à 2 appels Short.io par domaine (le flux, paginé) plus la liste des liens,
// au lieu d'un appel PAR LIEN comme auparavant.
export async function snapshotShortioLinks(
  profileId: string,
  source: 'cron' | 'refresh_partial' = 'refresh_partial',
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

  // Même règle de catégorie que le cron (source unique).
  const [contentLinksRes, prospectLinksRes] = await Promise.all([
    serviceSupabase.from('content_links').select('platform, desc_calendly_short_url, desc_lm_short_url, lm_short_url').eq('profile_id', profileId),
    serviceSupabase.from('prospect_links').select('short_url').eq('profile_id', profileId),
  ]);
  const resolveLinkCategory = createLinkCategoryResolver({
    contentLinks: contentLinksRes.data ?? [],
    prospectShortUrls: (prospectLinksRes.data ?? []).map((pl: { short_url: string | null }) => pl.short_url),
  });

  // Métadonnées des liens (titre, date de création) — non bloquant.
  serviceSupabase.from('shortio_links_metadata').upsert(
    links.map(l => ({
      link_id: l.id, profile_id: profileId, title: l.title, path: l.path,
      created_at: l.createdAt, updated_at: new Date().toISOString(),
    })),
    { onConflict: 'link_id', ignoreDuplicates: false },
  ).then(({ error }) => { if (error) console.error('[shortio-fetch] metadata_upsert:', error.message); });

  // Flux de clics des dernières 36 h sur TOUS les domaines du compte (l'élève qui a
  // changé de domaine garde des liens actifs sur l'ancien). 36 h et non 24 h : une
  // marge suffisante pour couvrir toute la journée Paris en cours quel que soit le
  // décalage UTC, sans ramener inutilement l'avant-veille.
  const depuis = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const clicsParPathEtJour = new Map<string, { human: number; total: number }>();
  const domaines = creds.allDomains.length > 0 ? creds.allDomains : [{ id: creds.domainId, hostname: creds.domain }];
  for (const d of domaines) {
    try {
      const { clics } = await fetchClicsShortio(d.id, creds.apiKey, depuis);
      const agg = agregerClics(clics, iso => parisDateStr(new Date(iso)));
      for (const [k, v] of agg.parPathEtJour) {
        const cur = clicsParPathEtJour.get(k) ?? { human: 0, total: 0 };
        clicsParPathEtJour.set(k, { human: cur.human + v.human, total: cur.total + v.total });
      }
    } catch (e: any) {
      // Tracé, pas avalé : sans ça, un quota dépassé produisait des zéros
      // indiscernables d'une absence réelle de clic.
      errors.push(`click_stream_domain_${d.id}: ${e?.message || 'unknown'}`);
    }
  }

  const aujourdhui = parisDateStr(new Date());
  let synced = 0;
  for (const link of links) {
    const compte = clicsParPathEtJour.get(cleClic(link.path, aujourdhui)) ?? { human: 0, total: 0 };
    const { error } = await serviceSupabase.rpc('upsert_shortio_link_snapshot', {
      p_profile_id: profileId,
      p_link_id: link.id,
      p_path: link.path,
      p_short_url: link.shortUrl,
      p_original_url: link.originalUrl ?? null,
      p_date: aujourdhui,
      p_human_clicks: compte.human,
      p_total_clicks: compte.total,
      p_link_type: (() => { try { return new URL(link.originalUrl).searchParams.get('utm_medium'); } catch { return null; } })(),
      // `null` : la RPC fait COALESCE, donc les ventilations déjà collectées restent
      // intactes. Un tableau vide les effacerait.
      p_top_countries: null, p_top_referrers: null, p_top_browsers: null, p_top_os: null,
      p_top_social: null, p_top_cities: null, p_utm_sources: null, p_utm_mediums: null,
      p_backfill_source: source,
      p_link_category: resolveLinkCategory(link.path, link.shortUrl, link.originalUrl),
      p_ecraser: false,
    });
    if (error) errors.push(`upsert_${link.path}: ${error.message}`);
    else synced++;
  }

  return { synced, errors };
}
