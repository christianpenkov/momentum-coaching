// Edge Function Supabase — poll-leads
// Remplace la route Vercel /api/instagram/poll-leads pour tenir 20 élèves+
// Timeout 150s (vs 30s Vercel Hobby). Logique identique, imports Deno-native.
// Appelée par cron-job.org avec Authorization: Bearer CRON_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const YOUTUBE_CLIENT_ID = Deno.env.get('YOUTUBE_CLIENT_ID')!;
const YOUTUBE_CLIENT_SECRET = Deno.env.get('YOUTUBE_CLIENT_SECRET')!;
const PLATFORM_URL = Deno.env.get('NEXT_PUBLIC_PLATFORM_URL') || 'https://momentum-plateforme.vercel.app';

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

// Deno-native gunzip (remplace Node zlib.gunzipSync)
async function gunzip(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  // Vérifier le magic number gzip (0x1f 0x8b) avant de tenter la décompression
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return new TextDecoder().decode(buf);
  }
  try {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return new TextDecoder().decode(out);
  } catch {
    return new TextDecoder().decode(buf);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IG
// ─────────────────────────────────────────────────────────────────────────────

async function getIgCreds(profileId: string): Promise<{ token: string; igAccountId: string } | null> {
  const { data: integ } = await supa
    .from('integrations')
    .select('access_token, expires_at, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return null;

  const needsRefresh = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 24 * 60 * 60 * 1000;

  let token = integ.access_token;
  if (needsRefresh) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
    const d = await safeJson(r);
    if (d.access_token) {
      token = d.access_token;
      const expiresAt = d.expires_in ? new Date(Date.now() + d.expires_in * 1000).toISOString() : null;
      await supa.from('integrations').update({ access_token: token, expires_at: expiresAt })
        .eq('profile_id', profileId).eq('provider', 'instagram');
    }
  }

  const igAccountId: string | null = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return null;
  return { token, igAccountId };
}

async function fetchIgDayMetrics(token: string, igAccountId: string, date: string) {
  const d = new Date(date + 'T00:00:00Z');
  const since = Math.floor(d.getTime() / 1000);
  const until = since + 86400;

  const [accountRes, insightsRes, engagedRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=followers_count,follows_count&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach,follower_count,follows_and_unfollows,profile_links_taps,website_clicks,views&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${token}`),
  ]);

  const [accountData, insightsData, engagedData] = await Promise.all([
    safeJson(accountRes), safeJson(insightsRes), safeJson(engagedRes),
  ]);

  const insightMap: Record<string, number[]> = {};
  for (const metric of insightsData?.data || []) {
    insightMap[metric.name] = (metric.values || []).map((v: any) => v.value || 0);
  }
  const sum = (arr: number[]) => (arr || []).reduce((a: number, b: number) => a + b, 0);
  const engagedTotal = (engagedData?.data || []).reduce((acc: number, m: any) => acc + (m.total_value?.value || 0), 0);

  return {
    ig_reach:              sum(insightMap['reach'] || []) || null,
    ig_followers:          accountData.followers_count ?? null,
    ig_following:          accountData.follows_count ?? null,
    ig_views:              sum(insightMap['views'] || []) || null,
    ig_follows_unfollows:  sum(insightMap['follows_and_unfollows'] || []) || null,
    ig_profile_taps:       sum(insightMap['profile_links_taps'] || []) || null,
    ig_website_clicks:     sum(insightMap['website_clicks'] || []) || null,
    ig_accounts_engaged:   engagedTotal || null,
    ig_total_interactions: engagedTotal || null,
    ig_lead_count:         null,
    ig_response_rate:      null,
  };
}

async function pollIgComments(profileId: string, token: string, igAccountId: string, since: Date): Promise<{ leadsFound: number; error?: string }> {
  const { data: contentLinks } = await supa
    .from('content_links')
    .select('content_id, lm_keyword, lm_short_url, dm_opener_message, dm_lm_message')
    .eq('profile_id', profileId)
    .not('lm_keyword', 'is', null)
    .not('lm_short_url', 'is', null);

  if (!contentLinks?.length) return { leadsFound: 0 };

  const clByMedia = new Map<string, typeof contentLinks[0]>();
  for (const cl of contentLinks) if (cl.content_id) clByMedia.set(cl.content_id, cl);

  const sinceMs = Math.max(since.getTime(), Date.now() - 48 * 60 * 60 * 1000);
  const sinceDate = new Date(sinceMs);
  let leadsFound = 0;

  try {
    const mediaRes = await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,permalink,timestamp&limit=30&access_token=${token}`);
    const mediaData = await safeJson(mediaRes);
    const recentMedia = (mediaData.data || []).filter((m: any) => new Date(m.timestamp).getTime() > Date.now() - 90 * 24 * 60 * 60 * 1000);

    for (const media of recentMedia) {
      const cl = clByMedia.get(media.id);
      if (!cl) continue;

      const commRes = await fetch(`https://graph.instagram.com/v21.0/${media.id}/comments?fields=id,text,timestamp,from,username&limit=50&access_token=${token}`);
      const commData = await safeJson(commRes);
      if (commData.error) continue;

      for (const comment of commData.data || []) {
        if (!comment.text) continue;
        if (new Date(comment.timestamp).getTime() < sinceDate.getTime()) continue;
        const text = comment.text.toLowerCase().trim();
        if (!text.includes(cl.lm_keyword!.toLowerCase())) continue;

        const commenterId = comment.from?.id ? String(comment.from.id) : null;
        if (!commenterId) continue;
        const commenterUsername = comment.from?.username || comment.username || '';
        const detectedAt = new Date(comment.timestamp).toISOString();

        const { count } = await supa.from('instagram_lead_lm_history').insert({
          profile_id: profileId, ig_username: commenterUsername || '',
          ig_user_id: commenterId, keyword_matched: cl.lm_keyword,
          media_id: media.id, lm_url: cl.lm_short_url || null,
          lead_magnet_sent: false, detected_at: detectedAt,
        }, { count: 'exact' }).select();
        if (!count || count === 0) continue;

        leadsFound++;
        await supa.from('instagram_leads').upsert({
          profile_id: profileId, source: 'comment',
          ig_username: commenterUsername || null, ig_user_id: commenterId,
          message: comment.text.slice(0, 500), media_id: media.id,
          media_permalink: media.permalink || null, keyword_matched: cl.lm_keyword,
          detected_at: detectedAt, lead_magnet_sent: false, tracking_link: cl.lm_short_url || null,
        }, { onConflict: 'profile_id,ig_user_id', ignoreDuplicates: false });

        if (cl.lm_short_url && cl.dm_lm_message) {
          const dm1Text = (cl.dm_lm_message || '')
            .replace(/\{\{lien_lm\}\}/gi, cl.lm_short_url)
            .replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`);
          try {
            await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/messages`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recipient: { comment_id: comment.id }, message: { text: dm1Text }, access_token: token }),
            });
          } catch { /* non bloquant */ }
        }
      }
    }
  } catch (e: any) {
    return { leadsFound, error: e?.message };
  }

  if (leadsFound > 0) {
    await supa.from('integrations').update({ last_ig_poll: new Date().toISOString() })
      .eq('profile_id', profileId).eq('provider', 'instagram');
  }
  return { leadsFound };
}

async function pollIgHookReplied(profileId: string, token: string, igAccountId: string): Promise<{ updated: number; error?: string }> {
  let updated = 0;
  try {
    const threadsRes = await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/conversations?fields=id,updated_time,participants,message_count&limit=50&access_token=${token}`);
    const threadsData = await safeJson(threadsRes);
    const since48h = Date.now() - 48 * 60 * 60 * 1000;
    const recentThreads = (threadsData.data || []).filter((t: any) => new Date(t.updated_time).getTime() > since48h);

    await Promise.all(recentThreads.map(async (thread: any) => {
      const participant = thread.participants?.data?.find((p: any) => p.id !== igAccountId);
      if (!participant?.id) return;
      const participantId = String(participant.id);

      const { data: leadToUpdate } = await supa.from('instagram_leads')
        .select('id, hook_replied, hook_replied_at')
        .eq('profile_id', profileId).eq('ig_user_id', participantId)
        .eq('lead_magnet_sent', true).eq('hook_replied', false).maybeSingle();
      if (!leadToUpdate || leadToUpdate.hook_replied_at) return;

      const msgRes = await fetch(`https://graph.instagram.com/v21.0/${thread.id}/messages?fields=id,message,from,created_time&limit=20&access_token=${token}`);
      const msgData = await safeJson(msgRes);
      const leadMessages = (msgData?.data || [])
        .filter((m: any) => m.from?.id && String(m.from.id) !== igAccountId && m.message)
        .sort((a: any, b: any) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime());
      if (!leadMessages.length) return;

      const firstReply = leadMessages[0];
      await supa.from('instagram_leads').update({
        hook_replied: true,
        hook_reply_text: firstReply.message?.slice(0, 500) ?? null,
        hook_replied_at: new Date(firstReply.created_time).toISOString(),
      }).eq('id', leadToUpdate.id);
      updated++;
    }));
  } catch (e: any) {
    return { updated, error: e?.message };
  }
  return { updated };
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube
// ─────────────────────────────────────────────────────────────────────────────

async function getYtToken(profileId: string): Promise<string | null> {
  const { data: integ } = await supa.from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId).eq('provider', 'youtube').single();
  if (!integ?.access_token) return null;

  const expired = integ.expires_at && new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;
  if (!expired) return integ.access_token;
  if (!integ.refresh_token) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: integ.refresh_token, client_id: YOUTUBE_CLIENT_ID, client_secret: YOUTUBE_CLIENT_SECRET }),
  });
  const data = await safeJson(res);
  if (!data.access_token) return null;

  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
  await supa.from('integrations').update({ access_token: data.access_token, expires_at: expiresAt })
    .eq('profile_id', profileId).eq('provider', 'youtube');
  return data.access_token;
}

async function fetchYtDayMetrics(accessToken: string, startDate: string, endDate: string) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const [channelRes, analyticsRes] = await Promise.all([
    fetch('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', { headers: auth }),
    fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares,averageViewDuration&dimensions=day&sort=day`, { headers: auth }),
  ]);
  const [channelData, analyticsData] = await Promise.all([safeJson(channelRes), safeJson(analyticsRes)]);
  const subscribers = parseInt(channelData?.items?.[0]?.statistics?.subscriberCount || '0') || null;
  const rows: any[] = analyticsData?.rows || [];
  return rows.map((r: any) => ({
    date: r[0], yt_views: r[1] || null,
    yt_watch_time_min: Math.round((r[2] || 0) / 60) || null,
    yt_subscribers: subscribers, yt_subs_gained: r[3] || null, yt_subs_lost: r[4] || null,
    yt_net_subs: ((r[3] || 0) - (r[4] || 0)) || null, yt_likes: r[5] || null,
    yt_comments: r[6] || null, yt_shares: r[7] || null, yt_avg_view_duration_sec: r[8] || null,
  }));
}

function parseReachCsv(text: string): { video_id: string; impressions: number; clicks: number }[] {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const vidIdx = headers.indexOf('video_id');
  const impIdx = headers.indexOf('video_thumbnail_impressions');
  const ctrIdx = headers.indexOf('video_thumbnail_impressions_ctr');
  if (vidIdx < 0 || impIdx < 0 || ctrIdx < 0) return [];
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const impressions = parseFloat(vals[impIdx] || '0') || 0;
    const ctr = parseFloat(vals[ctrIdx] || '0') || 0;
    return { video_id: vals[vidIdx], impressions, clicks: impressions * ctr };
  }).filter(r => r.video_id);
}

async function syncYtCtr(profileId: string, accessToken: string): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  const auth = { Authorization: `Bearer ${accessToken}` };

  const jobsRes = await fetch('https://youtubereporting.googleapis.com/v1/jobs', { headers: auth });
  const jobsData = await safeJson(jobsRes);
  const reachJob = (jobsData.jobs || []).find((j: any) => j.reportTypeId === 'channel_reach_basic_a1');
  if (!reachJob) return { synced: 0, errors: [] };

  const { data: syncState } = await supa.from('youtube_ctr_sync_state')
    .select('last_report_id, reports_processed, job_created_at').eq('profile_id', profileId).single();

  if (!syncState?.job_created_at && reachJob.createTime) {
    await supa.from('youtube_ctr_sync_state').upsert({ profile_id: profileId, job_created_at: reachJob.createTime }, { onConflict: 'profile_id', ignoreDuplicates: false });
  }

  const reportsRes = await fetch(`https://youtubereporting.googleapis.com/v1/jobs/${reachJob.id}/reports`, { headers: auth });
  const reportsData = await safeJson(reportsRes);
  const allReports: any[] = (reportsData.reports || []).sort((a: any, b: any) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime());

  const lastReportId = syncState?.last_report_id ?? null;
  const lastIdx = lastReportId ? allReports.findIndex(r => r.id === lastReportId) : -1;
  const newReports = lastIdx >= 0 ? allReports.slice(lastIdx + 1) : allReports;
  if (newReports.length === 0) return { synced: 0, errors: [] };

  const perVideoMap: Record<string, { impressions: number; clicks: number }> = {};
  await Promise.all(newReports.map(async (report: any) => {
    try {
      const dlRes = await fetch(report.downloadUrl, { headers: auth });
      if (!dlRes.ok) { errors.push(`dl_${report.id}: HTTP ${dlRes.status}`); return; }
      const buf = await dlRes.arrayBuffer();
      const csv = await gunzip(buf);
      const rows = parseReachCsv(csv);
      for (const r of rows) {
        if (!perVideoMap[r.video_id]) perVideoMap[r.video_id] = { impressions: 0, clicks: 0 };
        perVideoMap[r.video_id].impressions += r.impressions;
        perVideoMap[r.video_id].clicks += r.clicks;
      }
    } catch (e: any) { errors.push(`parse_${report.id}: ${e?.message || 'unknown'}`); }
  }));

  const latestReport = newReports[newReports.length - 1];

  if (Object.keys(perVideoMap).length > 0) {
    const upsertRows = Object.entries(perVideoMap).map(([video_id, s]) => ({
      profile_id: profileId, video_id,
      impressions: Math.round(s.impressions),
      clicks: parseFloat(s.clicks.toFixed(4)),
      updated_at: new Date().toISOString(),
    }));
    const BATCH = 50;
    for (let i = 0; i < upsertRows.length; i += BATCH) {
      const batch = upsertRows.slice(i, i + BATCH);
      const { error } = await supa.rpc('upsert_yt_ctr', { rows: batch });
      if (error) {
        const { error: upsertErr } = await supa.from('youtube_video_ctr').upsert(batch, { onConflict: 'profile_id,video_id', ignoreDuplicates: false });
        if (upsertErr) errors.push(`upsert_batch_${i}: ${upsertErr.message}`);
      }
    }
  }

  await supa.from('youtube_ctr_sync_state').upsert({
    profile_id: profileId, last_report_id: latestReport.id,
    last_synced_at: new Date().toISOString(),
    reports_processed: (syncState?.reports_processed ?? 0) + newReports.length,
  }, { onConflict: 'profile_id' });

  return { synced: Object.keys(perVideoMap).length, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Short.io
// ─────────────────────────────────────────────────────────────────────────────

async function getShortioLinkCreds(profileId: string): Promise<{ apiKey: string; domain: string; domainId: string } | null> {
  const { data: integ } = await supa.from('integrations')
    .select('api_key, metadata').eq('profile_id', profileId).eq('provider', 'shortio').single();
  if (!integ?.api_key) return null;
  const domain = (integ.metadata as any)?.domain || null;
  const domainId = (integ.metadata as any)?.domain_id || null;
  if (!domain || !domainId) return null;
  return { apiKey: integ.api_key, domain, domainId: String(domainId) };
}

async function fetchShortioLinks(creds: { apiKey: string; domainId: string }) {
  const allLinks: any[] = [];
  let beforeId: string | null = null;
  const limit = 150;
  while (true) {
    const url = new URL('https://api.short.io/api/links');
    url.searchParams.set('domain_id', creds.domainId);
    url.searchParams.set('limit', String(limit));
    if (beforeId) url.searchParams.set('beforeId', beforeId);
    const res = await fetch(url.toString(), { headers: { authorization: creds.apiKey, accept: 'application/json' } });
    if (!res.ok) throw new Error(`Short.io links ${res.status}`);
    const data = await safeJson(res);
    const page: any[] = data?.links || [];
    allLinks.push(...page);
    if (page.length < limit) break;
    beforeId = String(page[page.length - 1].id);
  }
  return allLinks;
}

async function snapshotShortioLinks(profileId: string, creds: { apiKey: string; domain: string; domainId: string }): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  let links: any[];
  try { links = await fetchShortioLinks(creds); } catch (e: any) { return { errors: [`fetch_links: ${e?.message}`] }; }
  if (!links.length) return { errors: [] };

  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const dateYesterday = yesterday.toISOString().split('T')[0];
  const dateToday = new Date().toISOString().split('T')[0];

  // Helper : snapshot un lien pour une période donnée
  const snapshotLink = async (l: any, period: string, date: string) => {
    const linkId = String(l.id);
    const path = l.path || '';
    const shortUrl = l.secureShortURL || l.shortURL || `https://${creds.domain}/${path}`;
    const originalUrl = l.originalURL || '';
    let link_type: string | null = null;
    try { link_type = new URL(originalUrl).searchParams.get('utm_medium') || null; } catch {}

    const statsRes = await fetch(`https://api-v2.short.io/statistics/link/${linkId}?period=${period}`, { headers: { authorization: creds.apiKey, accept: 'application/json' } });
    const stats = statsRes.ok ? await safeJson(statsRes) : {};

    await supa.from('shortio_link_daily_snapshots').upsert({
      profile_id: profileId, link_id: linkId, path, short_url: shortUrl,
      original_url: originalUrl, date, link_type,
      human_clicks: Number(stats.humanClicks ?? 0),
      total_clicks: Number(stats.totalClicks ?? 0),
      top_countries: (stats.country || []).filter((c: any) => c.score > 0).slice(0, 8).map((c: any) => ({ label: c.countryName || c.country || 'Inconnu', code: c.country || '', value: Number(c.score) })),
      top_referrers: (stats.referer || []).filter((r: any) => r.score > 0).slice(0, 8).map((r: any) => ({ label: r.refhost || 'Direct', value: Number(r.score) })),
      top_browsers: (stats.browser || []).filter((b: any) => b.score > 0).slice(0, 8).map((b: any) => ({ label: b.browser || 'Inconnu', value: Number(b.score) })),
      top_os: (stats.os || []).filter((o: any) => o.score > 0).slice(0, 8).map((o: any) => ({ label: o.os || 'Inconnu', value: Number(o.score) })),
      top_social: (stats.social || []).filter((s: any) => s.score > 0).slice(0, 8).map((s: any) => ({ label: s.social || 'Direct', value: Number(s.score) })),
      top_cities: (stats.city || []).filter((c: any) => c.score > 0).slice(0, 8).map((c: any) => ({ label: `${c.name || '?'} (${c.countryCode || '?'})`, value: Number(c.score) })),
      utm_sources: (stats.utm_source || []).filter((u: any) => u.score > 0 && u.utm_source).slice(0, 8).map((u: any) => ({ label: u.utm_source, value: Number(u.score) })),
      utm_mediums: (stats.utm_medium || []).filter((u: any) => u.score > 0 && u.utm_medium).slice(0, 8).map((u: any) => ({ label: u.utm_medium, value: Number(u.score) })),
      backfill_source: 'cron',
    }, { onConflict: 'profile_id,link_id,date', ignoreDuplicates: false });
  };

  // Snapshot agrégat domaine J-1 + J-0 en parallèle
  await Promise.allSettled([
    fetch(`https://api-v2.short.io/statistics/domain/${creds.domainId}?period=yesterday`, { headers: { authorization: creds.apiKey, accept: 'application/json' } })
      .then(r => r.ok ? safeJson(r) : null)
      .then(domainStats => domainStats && supa.from('analytics_daily_snapshots').upsert({
        profile_id: profileId, date: dateYesterday,
        shortio_clicks: Number(domainStats.clicks ?? 0) || null,
        shortio_human_clicks: Number(domainStats.humanClicks ?? 0) || null,
        shortio_top_countries: (domainStats.country || []).filter((c: any) => c.score > 0).slice(0, 8).map((c: any) => ({ label: c.countryName || c.country, code: c.country, value: c.score })),
        shortio_top_referrers: (domainStats.referer || []).filter((r: any) => r.score > 0).slice(0, 8).map((r: any) => ({ label: r.refhost || 'Direct', value: r.score })),
      }, { onConflict: 'profile_id,date', ignoreDuplicates: false })),
    fetch(`https://api-v2.short.io/statistics/domain/${creds.domainId}?period=today`, { headers: { authorization: creds.apiKey, accept: 'application/json' } })
      .then(r => r.ok ? safeJson(r) : null)
      .then(domainStats => domainStats && supa.from('analytics_daily_snapshots').upsert({
        profile_id: profileId, date: dateToday,
        shortio_clicks: Number(domainStats.clicks ?? 0) || null,
        shortio_human_clicks: Number(domainStats.humanClicks ?? 0) || null,
        shortio_top_countries: (domainStats.country || []).filter((c: any) => c.score > 0).slice(0, 8).map((c: any) => ({ label: c.countryName || c.country, code: c.country, value: c.score })),
        shortio_top_referrers: (domainStats.referer || []).filter((r: any) => r.score > 0).slice(0, 8).map((r: any) => ({ label: r.refhost || 'Direct', value: r.score })),
      }, { onConflict: 'profile_id,date', ignoreDuplicates: false })),
  ]);

  // Snapshot par lien : J-1 + J-0 en parallèle
  const settled = await Promise.allSettled(links.flatMap((l: any) => [
    snapshotLink(l, 'yesterday', dateYesterday),
    snapshotLink(l, 'today', dateToday),
  ]));

  for (const s of settled) if (s.status === 'rejected') errors.push(String(s.reason?.message || 'link_snapshot_failed'));
  return { errors };
}

async function syncLmClickStream(profileId: string, creds: { apiKey: string; domainId: string }, afterDate: string): Promise<string[]> {
  const errors: string[] = [];
  try {
    const res = await fetch(`https://api-v2.short.io/statistics/domain/${creds.domainId}/last_clicks`, {
      method: 'POST',
      headers: { authorization: creds.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ limit: 500, afterDate }),
    });
    if (!res.ok) return [`click_stream_${res.status}`];

    const data = await safeJson(res);
    const rawClicks: { path: string; dt: string; human: boolean }[] = data?.clicks ?? data ?? [];
    const humanClicks = rawClicks.filter(c => c.human === true && c.path);

    // Mise à jour du compteur human_clicks dans shortio_link_daily_snapshots pour aujourd'hui
    // On agrège par path (un clic = +1) et on upsert via increment SQL
    const today = new Date().toISOString().split('T')[0];
    const clickCountByPath = new Map<string, number>();
    for (const click of humanClicks) {
      const clickDate = click.dt ? click.dt.split('T')[0] : today;
      if (clickDate === today) {
        const p = click.path.replace(/^\//, '');
        clickCountByPath.set(p, (clickCountByPath.get(p) ?? 0) + 1);
      }
    }
    // Pour chaque path cliqué aujourd'hui, upsert le snapshot du jour avec le bon compteur
    await Promise.allSettled([...clickCountByPath.entries()].map(async ([path, count]) => {
      const { data: existing } = await supa.from('shortio_link_daily_snapshots')
        .select('link_id, short_url, original_url, link_type, human_clicks')
        .eq('profile_id', profileId).eq('path', path).eq('date', today)
        .maybeSingle();
      if (existing) {
        await supa.from('shortio_link_daily_snapshots')
          .update({ human_clicks: Math.max(existing.human_clicks ?? 0, count), updated_at: new Date().toISOString() })
          .eq('profile_id', profileId).eq('path', path).eq('date', today);
      }
      // Si pas de ligne today, elle sera créée par snapshotShortioLinks (period=today) au prochain cron
    }));

    // LM clicks
    for (const click of humanClicks.filter(c => c.path.replace(/^\//, '').startsWith('lm-'))) {
      const clickedAt = click.dt ? new Date(click.dt).toISOString() : new Date().toISOString();
      const cleanPath = click.path.replace(/^\//, '');
      const { data: igLead } = await supa.from('instagram_leads').select('id, ig_username, detected_at').eq('profile_id', profileId).filter('tracking_link', 'like', `%/${cleanPath}`).maybeSingle();
      if (!igLead) continue;
      if (new Date(clickedAt) < new Date(igLead.detected_at)) continue;
      const { data: existing } = await supa.from('prospect_events').select('id, occurred_at').eq('ig_lead_id', igLead.id).eq('event_type', 'lm_clicked').maybeSingle();
      if (!existing) {
        const { error: evtErr } = await supa.from('prospect_events').insert({ profile_id: profileId, prospect_key: igLead.ig_username.toLowerCase(), platform: 'ig', event_type: 'lm_clicked', occurred_at: clickedAt, ig_lead_id: igLead.id });
        if (evtErr) errors.push(`lm_clicked_${cleanPath}: ${evtErr.message}`);
      } else if (existing.occurred_at?.includes('T12:00:00')) {
        await supa.from('prospect_events').update({ occurred_at: clickedAt }).eq('id', existing.id);
      }
    }

    // Calendly link clicks
    for (const click of humanClicks.filter(c => !c.path.replace(/^\//, '').startsWith('lm-'))) {
      const clickedAt = click.dt ? new Date(click.dt).toISOString() : new Date().toISOString();
      const cleanPath = click.path.replace(/^\//, '');
      const { data: pl } = await supa.from('prospect_links').select('id, ig_username, ig_lead_id, calendly_link_sent, calendly_link_sent_at, last_calendly_link_sent_at, first_click_at').eq('profile_id', profileId).filter('short_url', 'like', `%/${cleanPath}`).maybeSingle();
      if (!pl) continue;
      const sentRefAt = pl.last_calendly_link_sent_at ?? pl.calendly_link_sent_at;
      if (!pl.calendly_link_sent || !sentRefAt) continue;
      if (new Date(clickedAt) <= new Date(sentRefAt)) continue;
      if (!pl.first_click_at) await supa.from('prospect_links').update({ first_click_at: clickedAt }).eq('id', pl.id);
      const { data: existingEvt } = await supa.from('prospect_events').select('id').eq('prospect_link_id', pl.id).eq('event_type', 'link_clicked').maybeSingle();
      if (!existingEvt) {
        const { error: evtErr } = await supa.from('prospect_events').insert({ profile_id: profileId, prospect_key: pl.ig_username.toLowerCase(), platform: 'ig', event_type: 'link_clicked', occurred_at: clickedAt, ig_lead_id: pl.ig_lead_id, prospect_link_id: pl.id });
        if (evtErr) errors.push(`link_clicked_${cleanPath}: ${evtErr.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`click_stream: ${e?.message || 'unknown'}`);
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Posts IG individuels — snapshot quotidien
// ─────────────────────────────────────────────────────────────────────────────

async function snapshotIgPosts(profileId: string, token: string, igAccountId: string, yesterday: string): Promise<string[]> {
  const errors: string[] = [];
  try {
    // Guard : si des snapshots existent déjà pour hier, on ne refetch pas
    const { count } = await supa.from('analytics_ig_posts_history')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .eq('snapshot_date', yesterday);
    if (count && count > 0) return [];

    const mediaRes = await fetch(
      `https://graph.instagram.com/v22.0/${igAccountId}/media?fields=id,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count,permalink,video_duration&limit=15&access_token=${token}`
    );
    if (!mediaRes.ok) return [`ig_posts_media: HTTP ${mediaRes.status}`];
    const mediaData = await safeJson(mediaRes);
    const posts: any[] = mediaData.data || [];

    const snapshotAt = new Date().toISOString();

    // Helper : fetch insights isolés par groupe pour éviter qu'une métrique refusée invalide tout le call
    const safeInsights = async (postId: string, metrics: string): Promise<Record<string, number>> => {
      try {
        const r = await fetch(`https://graph.instagram.com/v22.0/${postId}/insights?metric=${metrics}&access_token=${token}`);
        const d = r.ok ? await safeJson(r) : {};
        if (d?.error || !d?.data) return {};
        const out: Record<string, number> = {};
        for (const m of d.data) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
        return out;
      } catch { return {}; }
    };

    await Promise.allSettled(posts.map(async (post: any) => {
      try {
        const isReel = post.media_product_type === 'REELS' || post.media_type === 'VIDEO';

        // 3 calls isolés comme l'API live — si un groupe échoue, les autres passent
        const m: Record<string, number> = {};
        Object.assign(m, await safeInsights(post.id, 'reach,saved,shares,total_interactions,views'));
        if (isReel) {
          Object.assign(m, await safeInsights(post.id, 'ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate'));
        } else {
          Object.assign(m, await safeInsights(post.id, 'follows,profile_visits'));
        }

        const row: Record<string, any> = {
          profile_id: profileId,
          post_id: post.id,
          post_type: post.media_product_type || post.media_type || 'IMAGE',
          caption: (post.caption || '').slice(0, 500),
          permalink: post.permalink || null,
          thumbnail: post.thumbnail_url || post.media_url || null,
          published_at: post.timestamp ? new Date(post.timestamp).toISOString() : null,
          reach: m['reach'] ?? null,
          views: m['views'] ?? null,
          likes: post.like_count ?? null,
          comments: post.comments_count ?? null,
          saves: m['saved'] ?? null,
          shares: m['shares'] ?? null,
          follows: m['follows'] ?? null,
          profile_visits: m['profile_visits'] ?? null,
          total_interactions: m['total_interactions'] ?? null,
          snapshot_date: yesterday,
          snapshot_at: snapshotAt,
        };
        if (isReel) {
          row.avg_watch_time_ms = m['ig_reels_avg_watch_time'] ?? null;
          row.total_watch_time_ms = m['ig_reels_video_view_total_time'] ?? null;
          row.video_duration_sec = post.video_duration ? Math.round(post.video_duration) : null;
        }

        const { error } = await supa.from('analytics_ig_posts_history').upsert(row, { onConflict: 'profile_id,post_id,snapshot_date', ignoreDuplicates: false });
        if (error) errors.push(`ig_post_upsert_${post.id}: ${error.message}`);
      } catch (e: any) { errors.push(`ig_post_${post.id}: ${e?.message || 'unknown'}`); }
    }));
  } catch (e: any) { errors.push(`ig_posts_snapshot: ${e?.message || 'unknown'}`); }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vidéos YT individuelles — snapshot quotidien
// ─────────────────────────────────────────────────────────────────────────────

async function snapshotYtVideos(profileId: string, accessToken: string, yesterday: string): Promise<string[]> {
  const errors: string[] = [];
  try {
    // Guard : si des snapshots existent déjà pour hier, on ne refetch pas
    const { count } = await supa.from('analytics_yt_videos_history')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .eq('snapshot_date', yesterday);
    if (count && count > 0) return [];

    const auth = { Authorization: `Bearer ${accessToken}` };

    // Récupère uploads playlist id
    const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet,statistics&mine=true', { headers: auth });
    if (!channelRes.ok) return [`yt_videos_channel: HTTP ${channelRes.status}`];
    const channelData = await safeJson(channelRes);
    const uploadsPlaylistId = channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return ['yt_videos_no_uploads_playlist'];

    // Récupère les 30 dernières vidéos
    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${uploadsPlaylistId}&maxResults=30&part=snippet&fields=items(snippet(resourceId,title,publishedAt,thumbnails))`,
      { headers: auth }
    );
    if (!playlistRes.ok) return [`yt_videos_playlist: HTTP ${playlistRes.status}`];
    const playlistData = await safeJson(playlistRes);
    const items: any[] = playlistData.items || [];
    if (!items.length) return [];

    const videoIds = items.map((i: any) => i.snippet?.resourceId?.videoId).filter(Boolean);

    // Détails vidéo (durée, statistiques lifetime)
    const BATCH = 10;
    const videoDetailsMap: Record<string, any> = {};
    for (let i = 0; i < videoIds.length; i += BATCH) {
      const batch = videoIds.slice(i, i + BATCH);
      const detailsRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${batch.join(',')}&fields=items(id,snippet(title,publishedAt,thumbnails),statistics,contentDetails(duration))`,
        { headers: auth }
      );
      if (detailsRes.ok) {
        const detailsData = await safeJson(detailsRes);
        for (const v of detailsData.items || []) videoDetailsMap[v.id] = v;
      }
    }

    // Analytics vidéo par batch de 10 (30 jours glissants)
    const startDate = isoDate(30);
    const analyticsMap: Record<string, any> = {};
    for (let i = 0; i < videoIds.length; i += BATCH) {
      const batch = videoIds.slice(i, i + BATCH);
      const analyticsRes = await fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&dimensions=video&filters=video==${batch.join(',')}&metrics=views,estimatedMinutesWatched,likes,comments,shares,averageViewPercentage,subscribersGained&startDate=${startDate}&endDate=${yesterday}`,
        { headers: auth }
      );
      if (analyticsRes.ok) {
        const analyticsData = await safeJson(analyticsRes);
        for (const row of analyticsData.rows || []) {
          analyticsMap[row[0]] = { views: row[1], watchMin: row[2], likes: row[3], comments: row[4], shares: row[5], avgViewPct: row[6], subsGained: row[7] };
        }
      }
    }

    // CTR depuis youtube_video_ctr
    const { data: ctrRows } = await supa.from('youtube_video_ctr')
      .select('video_id, impressions, clicks')
      .eq('profile_id', profileId)
      .in('video_id', videoIds);
    const ctrMap: Record<string, number | null> = {};
    for (const r of ctrRows || []) {
      ctrMap[r.video_id] = r.impressions > 0 ? r.clicks / r.impressions : null;
    }

    const snapshotAt = new Date().toISOString();

    // Upsert chaque vidéo
    for (const videoId of videoIds) {
      try {
        const detail = videoDetailsMap[videoId];
        const analytics = analyticsMap[videoId] || {};
        const isShort = detail?.contentDetails?.duration
          ? /^PT(?:\d+S|[0-5]?\dS|[0-5]?\d[Ss])$/.test(detail.contentDetails.duration) ||
            /^PT0?[0-5]?\d[Ss]$/.test(detail.contentDetails.duration)
          : false;

        const row: Record<string, any> = {
          profile_id: profileId,
          video_id: videoId,
          title: detail?.snippet?.title || null,
          thumbnail: detail?.snippet?.thumbnails?.medium?.url || detail?.snippet?.thumbnails?.default?.url || null,
          published_at: detail?.snippet?.publishedAt ? new Date(detail.snippet.publishedAt).toISOString() : null,
          duration_sec: null,
          is_short: isShort,
          views: parseInt(detail?.statistics?.viewCount || '0') || null,
          views_period: analytics.views ?? null,
          watch_time_min: analytics.watchMin ?? null,
          likes: parseInt(detail?.statistics?.likeCount || '0') || null,
          comments: parseInt(detail?.statistics?.commentCount || '0') || null,
          shares: analytics.shares ?? null,
          avg_view_pct: analytics.avgViewPct ?? null,
          subs_gained: analytics.subsGained ?? null,
          ctr: ctrMap[videoId] ?? null,
          url: `https://youtube.com/watch?v=${videoId}`,
          snapshot_date: yesterday,
          snapshot_at: snapshotAt,
        };

        const { error } = await supa.from('analytics_yt_videos_history').upsert(row, { onConflict: 'profile_id,video_id,snapshot_date', ignoreDuplicates: false });
        if (error) errors.push(`yt_video_upsert_${videoId}: ${error.message}`);
      } catch (e: any) { errors.push(`yt_video_${videoId}: ${e?.message || 'unknown'}`); }
    }
  } catch (e: any) { errors.push(`yt_videos_snapshot: ${e?.message || 'unknown'}`); }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot complet d'un profil
// ─────────────────────────────────────────────────────────────────────────────

async function snapshotProfile(profileId: string): Promise<string[]> {
  const errors: string[] = [];
  const yesterday = isoDate(1);

  // IG J-1 + posts individuels (en parallèle)
  const igCreds = await getIgCreds(profileId);
  if (igCreds) {
    const [igMetricsResult, igPostsResult] = await Promise.allSettled([
      (async () => {
        const metrics = await fetchIgDayMetrics(igCreds.token, igCreds.igAccountId, yesterday);
        const { error } = await supa.from('analytics_daily_snapshots').upsert({ profile_id: profileId, date: yesterday, ...metrics, backfill_source: 'cron' }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
        if (error) throw new Error(error.message);
      })(),
      snapshotIgPosts(profileId, igCreds.token, igCreds.igAccountId, yesterday),
    ]);
    if (igMetricsResult.status === 'rejected') errors.push(`ig_fetch: ${igMetricsResult.reason?.message || 'unknown'}`);
    if (igPostsResult.status === 'fulfilled') errors.push(...igPostsResult.value);
    else errors.push(`ig_posts: ${igPostsResult.reason?.message || 'unknown'}`);
  }

  // Short.io J-1 + click stream
  const shioCreds = await getShortioLinkCreds(profileId);
  if (shioCreds) {
    try {
      const { errors: shioErrors } = await snapshotShortioLinks(profileId, shioCreds);
      if (shioErrors.length) errors.push(...shioErrors.map(e => `shortio_link: ${e}`));
      const afterDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const csErrors = await syncLmClickStream(profileId, shioCreds, afterDate);
      if (csErrors.length) errors.push(...csErrors.map(e => `shortio_click_stream: ${e}`));
    } catch (e: any) { errors.push(`shortio_snapshot: ${e?.message || 'unknown'}`); }
  }

  // YouTube J-1, J-2, J-3 + CTR + vidéos individuelles (en parallèle)
  const ytToken = await getYtToken(profileId);
  if (ytToken) {
    const [ytMetricsResult, ytCtrResult, ytVideosResult] = await Promise.allSettled([
      (async () => {
        const ytRows = await fetchYtDayMetrics(ytToken, isoDate(3), yesterday);
        for (const row of ytRows) {
          const { error } = await supa.from('analytics_daily_snapshots').upsert({ profile_id: profileId, date: row.date, yt_views: row.yt_views, yt_watch_time_min: row.yt_watch_time_min, yt_subscribers: row.yt_subscribers, yt_subs_gained: row.yt_subs_gained, yt_subs_lost: row.yt_subs_lost, yt_net_subs: row.yt_net_subs, yt_likes: row.yt_likes, yt_comments: row.yt_comments, yt_shares: row.yt_shares, yt_avg_view_duration_sec: row.yt_avg_view_duration_sec, backfill_source: 'cron' }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
          if (error) throw new Error(`yt_upsert_${row.date}: ${error.message}`);
        }
      })(),
      syncYtCtr(profileId, ytToken),
      snapshotYtVideos(profileId, ytToken, yesterday),
    ]);
    if (ytMetricsResult.status === 'rejected') errors.push(`yt_fetch: ${ytMetricsResult.reason?.message || 'unknown'}`);
    if (ytCtrResult.status === 'fulfilled') { if (ytCtrResult.value.errors.length) errors.push(...ytCtrResult.value.errors.map(e => `yt_ctr: ${e}`)); }
    else errors.push(`yt_ctr: ${ytCtrResult.reason?.message || 'unknown'}`);
    if (ytVideosResult.status === 'fulfilled') errors.push(...ytVideosResult.value);
    else errors.push(`yt_videos: ${ytVideosResult.reason?.message || 'unknown'}`);
  }

  // Calls stats J-1
  const { data: callsData } = await supa.from('calls').select('status, scheduled_at, no_show, deal_closed, revenue, outcome').eq('coach_id', profileId).not('calendly_event_uuid', 'is', null).neq('ignored', true);
  const calls = callsData || [];
  const now = new Date();
  await supa.from('analytics_daily_snapshots').upsert({
    profile_id: profileId, date: yesterday,
    calls_booked:   calls.filter((c: any) => c.status === 'active').length,
    calls_honored:  calls.filter((c: any) => c.status === 'active' && new Date(c.scheduled_at) < now && c.outcome != null && !c.no_show).length,
    calls_canceled: calls.filter((c: any) => ['canceled', 'cancelled'].includes(c.status)).length,
    calls_no_show:  calls.filter((c: any) => c.no_show).length,
    deals_closed:   calls.filter((c: any) => c.deal_closed).length,
    revenue:        calls.reduce((s: number, c: any) => s + (c.revenue || 0), 0),
  }, { onConflict: 'profile_id,date', ignoreDuplicates: false });

  // Stripe J-1 (appel vers l'API Vercel — non bloquant, avec timeout)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const stripeRes = await fetch(`${PLATFORM_URL}/api/stripe/client-data?profile_id=${profileId}`, { headers: { authorization: `Bearer ${CRON_SECRET}` }, signal: controller.signal });
    clearTimeout(timeout);
    if (stripeRes.ok) {
      const stripe = await safeJson(stripeRes);
      if (stripe?.recentPayments?.length) {
        const stripeRows = stripe.recentPayments.filter((p: any) => p.status === 'succeeded').map((p: any) => ({ profile_id: profileId, payment_id: p.id, amount: p.amount, currency: p.currency ?? 'eur', description: p.description || null, date: p.date, status: p.status }));
        if (stripeRows.length) await supa.from('stripe_payments').upsert(stripeRows, { onConflict: 'profile_id,payment_id' });
      }
      if (stripe) await supa.from('analytics_daily_snapshots').upsert({ profile_id: profileId, date: yesterday, mrr: stripe.mrr ?? null, stripe_active_subs: stripe.activeSubscriptions ?? null }, { onConflict: 'profile_id,date', ignoreDuplicates: false });
    }
  } catch (e: any) { errors.push(`stripe_fetch: ${e?.message || 'unknown'}`); }

  const status = errors.length === 0 ? 'ok' : 'partial';
  await supa.from('integrations').update({ last_snapshot_status: status, last_snapshot_error: errors.length ? errors.join(', ') : null }).eq('profile_id', profileId).in('provider', ['instagram', 'youtube']);

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { data: integrations } = await supa.from('integrations').select('profile_id, provider, last_ig_poll').in('provider', ['instagram', 'youtube', 'shortio']);
  if (!integrations?.length) return new Response(JSON.stringify({ polled: 0, snapshots: 0 }), { headers: { 'Content-Type': 'application/json' } });

  const profileMap = new Map<string, { profile_id: string; last_ig_poll: string | null; hasIg: boolean }>();
  for (const row of integrations) {
    if (!profileMap.has(row.profile_id)) profileMap.set(row.profile_id, { profile_id: row.profile_id, last_ig_poll: row.last_ig_poll, hasIg: false });
    if (row.provider === 'instagram') {
      profileMap.get(row.profile_id)!.hasIg = true;
      profileMap.get(row.profile_id)!.last_ig_poll = row.last_ig_poll;
    }
  }
  const profiles = Array.from(profileMap.values());

  let polled = 0, leadsFound = 0, snapshots = 0;
  const allErrors: Record<string, string[]> = {};

  // Tous les profils en parallèle — Edge Function a 150s, pas de limite Vercel 30s
  await Promise.all(profiles.map(async (profile) => {
    const profileErrors: string[] = [];

    if (profile.hasIg) {
      try {
        const creds = await getIgCreds(profile.profile_id);
        if (creds) {
          const since = profile.last_ig_poll ? new Date(profile.last_ig_poll) : new Date(Date.now() - 24 * 60 * 60 * 1000);
          const [commentsResult, hookResult] = await Promise.all([
            pollIgComments(profile.profile_id, creds.token, creds.igAccountId, since),
            pollIgHookReplied(profile.profile_id, creds.token, creds.igAccountId),
          ]);
          if (commentsResult.error) profileErrors.push(`comment_poll: ${commentsResult.error}`);
          if (hookResult.error) profileErrors.push(`hook_poll: ${hookResult.error}`);
          leadsFound += commentsResult.leadsFound;
          polled++;
        }
      } catch { profileErrors.push('lead_poll_failed'); }
    }

    try {
      const snapErrors = await snapshotProfile(profile.profile_id);
      if (snapErrors.length === 0) snapshots++;
      else profileErrors.push(...snapErrors);
    } catch { profileErrors.push('snapshot_failed'); }

    if (profileErrors.length) allErrors[profile.profile_id] = profileErrors;
  }));

  // Notifications rapport post-call
  let rapportNotified = 0;
  try {
    const now = new Date();
    const { data: pendingCalls } = await supa.from('calls').select('id, coach_id, invitee_name, scheduled_at, duration').eq('status', 'active').is('no_show', null).eq('rapport_notif_sent', false).neq('ignored', true).not('calendly_event_uuid', 'is', null).not('scheduled_at', 'is', null).not('duration', 'is', null).lt('scheduled_at', now.toISOString());

    const eligibleCalls = (pendingCalls || []).filter(call => {
      const match = (call.duration as string).match(/(\d+)/);
      if (!match) return false;
      const durationMs = parseInt(match[1]) * 60 * 1000;
      return now.getTime() >= new Date(call.scheduled_at).getTime() + durationMs + 15 * 60 * 1000;
    });

    // Appel vers l'API push Vercel (webpush nécessite Node — Edge Function utilise l'API Vercel)
    await Promise.all(eligibleCalls.map(async (call) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`${PLATFORM_URL}/api/push/send`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${CRON_SECRET}` },
          body: JSON.stringify({ profileId: call.coach_id, title: 'Rapport de call', body: `Comment s'est passé ton appel${call.invitee_name ? ` avec ${call.invitee_name}` : ''} ? Remplis ton rapport.`, url: `/client/calls?rapport=${call.id}` }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          await supa.from('calls').update({ rapport_notif_sent: true }).eq('id', call.id);
          rapportNotified++;
        }
      } catch { /* non bloquant — retry au prochain cron */ }
    }));
  } catch { /* non bloquant */ }

  return new Response(JSON.stringify({ polled, leadsFound, snapshots, rapportNotified, errors: allErrors }), { headers: { 'Content-Type': 'application/json' } });
});
