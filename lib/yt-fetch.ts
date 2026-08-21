import { createClient } from '@supabase/supabase-js';
import { gunzipSync } from 'zlib';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface YtDaySnapshot {
  date: string; // ISO YYYY-MM-DD
  yt_views: number | null;
  yt_watch_time_min: number | null;
  yt_subscribers: number | null;
  yt_subs_gained: number | null;
  yt_subs_lost: number | null;
  yt_net_subs: number | null;
  yt_likes: number | null;
  yt_comments: number | null;
  yt_shares: number | null;
  yt_avg_view_duration_sec: number | null;
  // Ventilation Shorts / vidéos longues (dimension creatorContentType). Sert la courbe
  // « Watch time moyen », qui distingue les deux formats — distinction que
  // yt_avg_view_duration_sec (tous formats confondus) ne permet pas, et qui était donc
  // simulée jusqu'au 2026-08-20.
  yt_avg_duration_shorts_sec: number | null;
  yt_avg_duration_long_sec: number | null;
  yt_views_shorts: number | null;
  yt_views_long: number | null;
  /** Watch time par format, en minutes. Vient directement de l'API : le reconstituer
   *  par « vues × durée moyenne » donne un résultat faux, `averageViewDuration` étant
   *  arrondi à la seconde (1,25 min calculée contre 0,00 réelle, vérifié le 2026-08-21). */
  yt_watch_time_shorts_min: number | null;
  yt_watch_time_long_min: number | null;
}

// ── Token (avec refresh OAuth) ────────────────────────────────────────────────

export async function getYtToken(profileId: string): Promise<string | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId)
    .eq('provider', 'youtube')
    .single();

  if (!integ?.access_token) return null;

  const expired = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;

  if (!expired) return integ.access_token;
  if (!integ.refresh_token) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integ.refresh_token,
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
    }),
  });

  const data = await res.json();
  if (!data.access_token) return null;

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  await serviceSupabase.from('integrations').update({
    access_token: data.access_token,
    expires_at: expiresAt,
  }).eq('profile_id', profileId).eq('provider', 'youtube');

  return data.access_token;
}

// ── Fetch métriques par plage de dates ───────────────────────────────────────
// Retourne un snapshot par jour dans la plage [startDate, endDate].
// Utilisé par le cron (J-1, J-2, J-3) et backfill (30j).

export async function fetchYtDayMetrics(
  accessToken: string,
  startDate: string, // ISO YYYY-MM-DD
  endDate: string    // ISO YYYY-MM-DD
): Promise<YtDaySnapshot[]> {
  const auth = { Authorization: `Bearer ${accessToken}` };

  const [channelRes, analyticsRes, byTypeRes] = await Promise.all([
    fetch('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', { headers: auth }),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares,averageViewDuration&dimensions=day&sort=day`,
      { headers: auth }
    ),
    // Même fenêtre, ventilée par format (creatorContentType : shorts | videoOnDemand |
    // liveStream | story). Vérifié sur une vraie chaîne le 2026-08-20 : HTTP 200, et la
    // somme des vues par format égale exactement le total du rapport `day` seul.
    // Requête séparée car mélanger les deux dimensions dans un seul appel renverrait des
    // lignes par (jour × format) pour TOUTES les métriques, dont certaines n'ont pas de
    // sens ventilées (subscribers est un total de chaîne).
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}&metrics=views,averageViewDuration,estimatedMinutesWatched&dimensions=day,creatorContentType&sort=day`,
      { headers: auth }
    ),
  ]);

  const [channelData, analyticsData, byTypeData] = await Promise.all([
    channelRes.json().catch(() => ({})),
    analyticsRes.json().catch(() => ({})),
    byTypeRes.json().catch(() => ({})),
  ]);

  // day -> { shorts, long } — l'API n'émet une ligne que pour les formats ayant eu des
  // vues ce jour-là, d'où le null quand le format est absent (pas de faux zéro).
  const byType = new Map<string, { shortsDur: number | null; longDur: number | null; shortsViews: number | null; longViews: number | null; shortsWatch: number | null; longWatch: number | null }>();
  for (const r of (byTypeData?.rows ?? []) as any[]) {
    // colonnes : day, creatorContentType, views, averageViewDuration,
    // estimatedMinutesWatched — deja en MINUTES, pas de division.
    const [day, type, views, avgDur, watchMin] = r;
    const cur = byType.get(day) ?? { shortsDur: null, longDur: null, shortsViews: null, longViews: null, shortsWatch: null, longWatch: null };
    if (type === 'shorts') { cur.shortsDur = avgDur ?? null; cur.shortsViews = views ?? null; cur.shortsWatch = watchMin ?? null; }
    else if (type === 'videoOnDemand') { cur.longDur = avgDur ?? null; cur.longViews = views ?? null; cur.longWatch = watchMin ?? null; }
    byType.set(day, cur);
  }

  const subscribers = parseInt(channelData?.items?.[0]?.statistics?.subscriberCount || '0') || null;
  const rows: any[] = analyticsData?.rows || [];

  // colonnes : day(0), views(1), estMinutesWatched(2), subsGained(3), subsLost(4), likes(5), comments(6), shares(7), avgViewDuration(8)
  return rows.map((r: any) => {
    const views = r[1] || 0;
    // Déjà en minutes — voir commentaire équivalent dans poll-leads/index.ts.
    // Pas d'arrondi : colonne numeric(12,2), voir poll-leads/index.ts.
    const watchMin = r[2] || 0;
    const subsGained = r[3] || 0;
    const subsLost = r[4] || 0;
    const avgDur = r[8] || 0;

    // Chaque ligne de `rows` est un jour confirmé par l'API YouTube Analytics — views,
    // watchMin etc. sont toujours de vraies valeurs numériques (potentiellement 0, ex:
    // aucune vue ce jour-là sur une petite chaîne), jamais "absentes" pour cette ligne.
    // `valeur || null` effacerait ces vrais 0 à tort.
    return {
      date:                    r[0],
      yt_views:                views,
      yt_watch_time_min:       watchMin,
      yt_subscribers:          subscribers,
      yt_subs_gained:          subsGained,
      yt_subs_lost:            subsLost,
      yt_net_subs:             subsGained - subsLost,
      yt_likes:                r[5] || 0,
      yt_comments:             r[6] || 0,
      yt_shares:               r[7] || 0,
      yt_avg_view_duration_sec: avgDur,
      // null (pas 0) quand le format n'a eu aucune vue ce jour-là : une durée moyenne
      // de 0 s se lirait « personne n'a regardé », alors que la réalité est « aucune
      // vue sur ce format », ce que la courbe doit rendre par un trou.
      yt_avg_duration_shorts_sec: byType.get(r[0])?.shortsDur ?? null,
      yt_avg_duration_long_sec:   byType.get(r[0])?.longDur ?? null,
      yt_views_shorts:            byType.get(r[0])?.shortsViews ?? null,
      yt_views_long:              byType.get(r[0])?.longViews ?? null,
      yt_watch_time_shorts_min:   byType.get(r[0])?.shortsWatch ?? null,
      yt_watch_time_long_min:     byType.get(r[0])?.longWatch ?? null,
    };
  });
}

// ── Upsert snapshot dans Supabase ────────────────────────────────────────────

export async function upsertYtSnapshot(
  profileId: string,
  snapshot: YtDaySnapshot,
  source: 'backfill' | 'cron' | 'refresh_partial'
): Promise<string | null> {
  const { error } = await serviceSupabase
    .from('analytics_daily_snapshots')
    .upsert({
      profile_id: profileId,
      date: snapshot.date,
      yt_views:                 snapshot.yt_views,
      yt_watch_time_min:        snapshot.yt_watch_time_min,
      yt_subscribers:           snapshot.yt_subscribers,
      yt_subs_gained:           snapshot.yt_subs_gained,
      yt_subs_lost:             snapshot.yt_subs_lost,
      yt_net_subs:              snapshot.yt_net_subs,
      yt_likes:                 snapshot.yt_likes,
      yt_comments:              snapshot.yt_comments,
      yt_shares:                snapshot.yt_shares,
      yt_avg_view_duration_sec: snapshot.yt_avg_view_duration_sec,
      yt_avg_duration_shorts_sec: snapshot.yt_avg_duration_shorts_sec,
      yt_avg_duration_long_sec:   snapshot.yt_avg_duration_long_sec,
      yt_views_shorts:            snapshot.yt_views_shorts,
      yt_views_long:              snapshot.yt_views_long,
      yt_watch_time_shorts_min:   snapshot.yt_watch_time_shorts_min,
      yt_watch_time_long_min:     snapshot.yt_watch_time_long_min,
      backfill_source:          source,
    }, { onConflict: 'profile_id,date', ignoreDuplicates: false });

  return error?.message ?? null;
}

// ── Sync CTR vidéos via YouTube Reporting API ─────────────────────────────────
// Télécharge les rapports channel_reach_basic_a1 non encore traités,
// agrège impressions + clics par vidéo (CTR pondéré), upsert dans youtube_video_ctr.
// Idempotent : skip les reports déjà traités via youtube_ctr_sync_state.

function parseReachCsv(text: string): Array<{ video_id: string; impressions: number; clicks: number }> {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const vidIdx  = headers.indexOf('video_id');
  const impIdx  = headers.indexOf('video_thumbnail_impressions');
  const ctrIdx  = headers.indexOf('video_thumbnail_impressions_ctr');
  if (vidIdx < 0 || impIdx < 0 || ctrIdx < 0) return [];

  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const impressions = parseFloat(vals[impIdx] || '0') || 0;
    const ctr         = parseFloat(vals[ctrIdx]  || '0') || 0;
    return { video_id: vals[vidIdx], impressions, clicks: impressions * ctr };
  }).filter(r => r.video_id);
}

export async function syncYtCtr(profileId: string, accessToken: string): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  const auth = { Authorization: `Bearer ${accessToken}` };

  // 1. Trouve le job channel_reach_basic_a1
  const jobsRes = await fetch('https://youtubereporting.googleapis.com/v1/jobs', { headers: auth });
  const jobsData = await jobsRes.json().catch(() => ({}));
  const reachJob = (jobsData.jobs || []).find((j: any) => j.reportTypeId === 'channel_reach_basic_a1');
  if (!reachJob) return { synced: 0, errors: [] }; // Pas encore de job — pas d'erreur

  // 2. Récupère le dernier report_id traité + job_created_at
  const { data: syncState } = await serviceSupabase
    .from('youtube_ctr_sync_state')
    .select('last_report_id, reports_processed, job_created_at')
    .eq('profile_id', profileId)
    .single();

  // Stocke job_created_at si pas encore fait (pour les profils connectés avant cette feature)
  if (!syncState?.job_created_at && reachJob.createTime) {
    await serviceSupabase.from('youtube_ctr_sync_state').upsert({
      profile_id: profileId,
      job_created_at: reachJob.createTime,
    }, { onConflict: 'profile_id', ignoreDuplicates: false });
  }

  const lastReportId = syncState?.last_report_id ?? null;

  // 3. Liste tous les rapports disponibles
  const reportsRes = await fetch(
    `https://youtubereporting.googleapis.com/v1/jobs/${reachJob.id}/reports`,
    { headers: auth }
  );
  const reportsData = await reportsRes.json().catch(() => ({}));
  const allReports: any[] = (reportsData.reports || []).sort(
    (a: any, b: any) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime()
  );

  // 4. Filtre uniquement les nouveaux rapports (après le dernier traité)
  const lastIdx = lastReportId ? allReports.findIndex(r => r.id === lastReportId) : -1;
  const newReports = lastIdx >= 0 ? allReports.slice(lastIdx + 1) : allReports;

  if (newReports.length === 0) return { synced: 0, errors: [] };

  // 5. Télécharge + parse tous les nouveaux rapports en parallèle
  const perVideoMap: Record<string, { impressions: number; clicks: number }> = {};

  await Promise.all(newReports.map(async (report: any) => {
    try {
      const dlRes = await fetch(report.downloadUrl, { headers: auth });
      if (!dlRes.ok) { errors.push(`dl_${report.id}: HTTP ${dlRes.status}`); return; }
      const buf = Buffer.from(await dlRes.arrayBuffer());
      let csv: string;
      try { csv = gunzipSync(buf).toString('utf-8'); } catch { csv = buf.toString('utf-8'); }
      const rows = parseReachCsv(csv);
      for (const r of rows) {
        if (!perVideoMap[r.video_id]) perVideoMap[r.video_id] = { impressions: 0, clicks: 0 };
        perVideoMap[r.video_id].impressions += r.impressions;
        perVideoMap[r.video_id].clicks      += r.clicks;
      }
    } catch (e: any) {
      errors.push(`parse_${report.id}: ${e?.message || 'unknown'}`);
    }
  }));

  if (Object.keys(perVideoMap).length === 0) {
    // Quand même mettre à jour le sync state même si les CSV étaient vides
    const latestReport = newReports[newReports.length - 1];
    await serviceSupabase.from('youtube_ctr_sync_state').upsert({
      profile_id:        profileId,
      last_report_id:    latestReport.id,
      last_synced_at:    new Date().toISOString(),
      reports_processed: (syncState?.reports_processed ?? 0) + newReports.length,
    }, { onConflict: 'profile_id' });
    return { synced: 0, errors };
  }

  // 6. Upsert dans youtube_video_ctr — additionne aux valeurs existantes
  const upsertRows = Object.entries(perVideoMap).map(([video_id, s]) => ({
    profile_id:  profileId,
    video_id,
    impressions: Math.round(s.impressions),
    clicks:      parseFloat(s.clicks.toFixed(4)),
    updated_at:  new Date().toISOString(),
  }));

  // Upsert par batch de 50 pour éviter les limites Supabase
  const BATCH = 50;
  for (let i = 0; i < upsertRows.length; i += BATCH) {
    const batch = upsertRows.slice(i, i + BATCH);
    const { error } = await serviceSupabase.rpc('upsert_yt_ctr', { rows: batch });
    if (error) {
      // Fallback : upsert direct sans accumulation si la RPC n'existe pas encore
      const { error: upsertErr } = await serviceSupabase
        .from('youtube_video_ctr')
        .upsert(batch, { onConflict: 'profile_id,video_id', ignoreDuplicates: false });
      if (upsertErr) errors.push(`upsert_batch_${i}: ${upsertErr.message}`);
    }
  }

  // 7. Met à jour le sync state avec le dernier report_id traité
  const latestReport = newReports[newReports.length - 1];
  await serviceSupabase.from('youtube_ctr_sync_state').upsert({
    profile_id:        profileId,
    last_report_id:    latestReport.id,
    last_synced_at:    new Date().toISOString(),
    reports_processed: (syncState?.reports_processed ?? 0) + newReports.length,
  }, { onConflict: 'profile_id' });

  return { synced: upsertRows.length, errors };
}
