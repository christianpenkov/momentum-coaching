import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

// Route d'exploration exhaustive de l'API YouTube (Data API v3 + Analytics API v2),
// pour analyser toutes les données disponibles au niveau CHANNEL et au niveau VIDÉO.
// Usage : GET /api/youtube/full-export?videoId=XXX (videoId optionnel — si absent,
// prend la vidéo la plus vue du channel). ?profileId=XXX pour un client (vue coach).
//
// Contrairement à /api/youtube/test-metrics (route de debug historique avec des blocs
// ponctuels ajoutés au fil des investigations), celle-ci est pensée comme référence
// stable : deux sections claires, channel puis video, pas de bloc de diagnostic
// jetable.

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getFreshToken(profileId: string): Promise<string | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId)
    .eq('provider', 'youtube')
    .single();

  if (!integ?.access_token) return null;

  const expired = integ.expires_at && new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;
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

function getToday() { return new Date().toISOString().split('T')[0]; }
function getStartDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function fetchAnalytics(h: Record<string, string>, params: string) {
  const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&${params}`, { headers: h });
  const data = await res.json();
  return { error: data.error?.message || null, columnHeaders: data.columnHeaders?.map((c: any) => c.name), rows: data.rows ?? null };
}

// Pour les séries dimension=day sur lifetime : des milliers de lignes à 0 (chaîne
// jeune/petite) noient le JSON de réponse. Ne garde que les jours avec au moins une
// vue — assez pour analyser l'activité réelle sans traîner les zéros.
async function fetchAnalyticsByDayNonZero(h: Record<string, string>, params: string) {
  const full = await fetchAnalytics(h, params);
  if (!full.rows) return full;
  const nonZeroRows = full.rows.filter((r: any[]) => r.slice(1).some((v) => v !== 0));
  return { ...full, totalDaysInRange: full.rows.length, daysWithActivity: nonZeroRows.length, rows: nonZeroRows };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const rawProfileId = searchParams.get('profileId');
  let targetProfileId = user.id;
  if (rawProfileId && rawProfileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', rawProfileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = rawProfileId;
  }

  const accessToken = await getFreshToken(targetProfileId);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });
  const h = { Authorization: `Bearer ${accessToken}` };

  const lifetimeStart = '2020-01-01';
  const last30 = getStartDate(30);
  const today = getToday();

  // ═══════════════════════ CHANNEL ═══════════════════════
  const channel: Record<string, any> = {};

  const chRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings,contentDetails,status,topicDetails&mine=true',
    { headers: h }
  );
  const chData = await chRes.json();
  const chItem = chData?.items?.[0];
  channel.info = {
    id: chItem?.id,
    title: chItem?.snippet?.title,
    country: chItem?.snippet?.country,
    publishedAt: chItem?.snippet?.publishedAt,
    statistics: chItem?.statistics, // viewCount, subscriberCount, videoCount (lifetime, Data API)
    status: chItem?.status,
    topicCategories: chItem?.topicDetails?.topicCategories,
  };

  channel.analytics_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,dislikes,comments,shares`);

  // dimension=day sur lifetime (6+ ans) génère des milliers de lignes à 0 pour une
  // petite chaîne — ne garde que les jours avec activité (voir fetchAnalyticsByDayNonZero).
  channel.analytics_lifetime_by_day = await fetchAnalyticsByDayNonZero(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares&dimensions=day&sort=day`);

  channel.traffic_sources_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceType&sort=-views`);

  channel.demographics_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=viewerPercentage&dimensions=ageGroup,gender`);

  channel.geography_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,estimatedMinutesWatched,subscribersGained&dimensions=country&sort=-views&maxResults=25`);

  channel.devices_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=deviceType&sort=-views`);

  channel.operating_systems_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=operatingSystem&sort=-views`);

  channel.subscription_status_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=subscribedStatus`);

  channel.playback_locations_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=insightPlaybackLocationType&sort=-views`);

  channel.top_videos_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained&dimensions=video&sort=-views&maxResults=20`);

  channel.subs_gained_by_video_lifetime = await fetchAnalytics(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=views,subscribersGained,subscribersLost&dimensions=video&sort=-subscribersGained&maxResults=20`);

  // impressions/CTR : nécessite le scope yt-analytics-monetary ou peut échouer sans
  // monétisation activée sur la chaîne — erreur attendue et normale dans ce cas.
  channel.impressions_ctr_lifetime = await fetchAnalyticsByDayNonZero(h,
    `startDate=${lifetimeStart}&endDate=${today}&metrics=impressions,impressionClickThroughRate&dimensions=day&sort=day`);

  const playlistsRes = await fetch(
    'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=25',
    { headers: h }
  );
  const playlistsData = await playlistsRes.json();
  channel.playlists = {
    error: playlistsData.error?.message || null,
    items: playlistsData.items?.map((p: any) => ({ id: p.id, title: p.snippet?.title, videoCount: p.contentDetails?.itemCount })),
  };

  // Reporting API (bulk) — jobs existants, séparé de l'Analytics API (temps réel/proche).
  const jobsRes = await fetch('https://youtubereporting.googleapis.com/v1/jobs', { headers: h });
  const jobsData = await jobsRes.json();
  channel.reporting_api_jobs = { error: jobsData.error?.message || null, jobs: jobsData.jobs ?? [] };

  // ═══════════════════════ VIDEO ═══════════════════════
  // Vidéo ciblée par ?videoId=, ou par défaut la plus vue du channel (issue de
  // top_videos_lifetime ci-dessus) pour toujours avoir un exemple concret.
  let videoId = searchParams.get('videoId');
  if (!videoId) videoId = channel.top_videos_lifetime.rows?.[0]?.[0] ?? null;

  const video: Record<string, any> = { videoIdUsed: videoId };

  if (videoId) {
    const vDetailsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status,topicDetails,player&id=${videoId}`,
      { headers: h }
    );
    const vDetailsData = await vDetailsRes.json();
    const vItem = vDetailsData?.items?.[0];
    video.info = {
      title: vItem?.snippet?.title,
      publishedAt: vItem?.snippet?.publishedAt,
      duration: vItem?.contentDetails?.duration,
      tags: vItem?.snippet?.tags,
      categoryId: vItem?.snippet?.categoryId,
      statistics: vItem?.statistics, // viewCount, likeCount, commentCount (lifetime, Data API)
      status: vItem?.status,
    };

    const publishedStart = vItem?.snippet?.publishedAt ? vItem.snippet.publishedAt.split('T')[0] : lifetimeStart;

    video.analytics_lifetime = await fetchAnalytics(h,
      `startDate=${publishedStart}&endDate=${today}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,dislikes,comments,shares,subscribersGained,subscribersLost&filters=video==${videoId}`);

    video.analytics_lifetime_by_day = await fetchAnalyticsByDayNonZero(h,
      `startDate=${publishedStart}&endDate=${today}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares&dimensions=day&sort=day&filters=video==${videoId}`);

    // Courbe de rétention — seule combinaison supportée pour ce niveau de détail.
    video.retention_curve = await fetchAnalytics(h,
      `startDate=${publishedStart}&endDate=${today}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${videoId}`);

    // Rang comparatif vs vidéos similaires (0-1, 0.5=médiane) — pas un vrai %, voir
    // note dans video-retention/route.ts pour le détail de cette distinction.
    video.relative_retention_performance = await fetchAnalytics(h,
      `startDate=${lifetimeStart}&endDate=${today}&metrics=relativeRetentionPerformance&dimensions=elapsedVideoTimeRatio&filters=video==${videoId}`);

    // engagedViews : nouvelle métrique Shorts 2025 (spectateurs restés au-delà des
    // premières secondes, vs views = affichages dans le feed) — utile pour les Shorts.
    video.engaged_views = await fetchAnalytics(h,
      `startDate=${lifetimeStart}&endDate=${today}&metrics=views,engagedViews&filters=video==${videoId}`);

    video.traffic_sources_lifetime = await fetchAnalytics(h,
      `startDate=${publishedStart}&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceType&sort=-views&filters=video==${videoId}`);

    video.demographics_lifetime = await fetchAnalytics(h,
      `startDate=${publishedStart}&endDate=${today}&metrics=viewerPercentage&dimensions=ageGroup,gender&filters=video==${videoId}`);

    video.devices_lifetime = await fetchAnalytics(h,
      `startDate=${publishedStart}&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=deviceType&sort=-views&filters=video==${videoId}`);

    // impressions/CTR par vidéo — même limite que channel.impressions_ctr_lifetime.
    video.impressions_ctr = await fetchAnalytics(h,
      `startDate=${publishedStart}&endDate=${today}&metrics=videoThumbnailImpressions,videoThumbnailImpressionsClickRate&filters=video==${videoId}`);
  }

  return NextResponse.json({ channel, video, meta: { lifetimeStart, last30, today } }, { status: 200 });
}
