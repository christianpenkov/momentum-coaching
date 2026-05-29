import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getToday() { return new Date().toISOString().split('T')[0]; }
function getStartDate(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', user.id)
    .eq('provider', 'youtube')
    .single();

  if (!integ?.access_token) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const token = integ.access_token;
  const h = { Authorization: `Bearer ${token}` };
  const results: Record<string, any> = {};

  // 1 — Chaîne complète (tous les champs disponibles)
  const chRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings,contentDetails,status,topicDetails&mine=true',
    { headers: h }
  );
  const chData = await chRes.json();
  results.channel = {
    id: chData?.items?.[0]?.id,
    title: chData?.items?.[0]?.snippet?.title,
    description: chData?.items?.[0]?.snippet?.description?.slice(0, 100),
    country: chData?.items?.[0]?.snippet?.country,
    publishedAt: chData?.items?.[0]?.snippet?.publishedAt,
    statistics: chData?.items?.[0]?.statistics,
    status: chData?.items?.[0]?.status,
    topicCategories: chData?.items?.[0]?.topicDetails?.topicCategories,
  };

  // 2 — Analytics canal 30j (impressions/CTR non dispo sans monétisation)
  const analyticsRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,dislikes,comments,shares&dimensions=day&sort=day`,
    { headers: h }
  );
  const analyticsData = await analyticsRes.json();
  results.analytics_30d = {
    error: analyticsData.error || null,
    columnHeaders: analyticsData.columnHeaders,
    rowCount: analyticsData.rows?.length,
    sample_row: analyticsData.rows?.[analyticsData.rows?.length - 1],
    totals: analyticsData.rows ? {
      views: analyticsData.rows.reduce((s: number, r: any) => s + (r[1] || 0), 0),
      watchMinutes: analyticsData.rows.reduce((s: number, r: any) => s + (r[2] || 0), 0),
      avgViewDuration: analyticsData.rows.reduce((s: number, r: any) => s + (r[3] || 0), 0) / (analyticsData.rows.length || 1),
      subsGained: analyticsData.rows.reduce((s: number, r: any) => s + (r[5] || 0), 0),
      subsLost: analyticsData.rows.reduce((s: number, r: any) => s + (r[6] || 0), 0),
      likes: analyticsData.rows.reduce((s: number, r: any) => s + (r[7] || 0), 0),
      comments: analyticsData.rows.reduce((s: number, r: any) => s + (r[9] || 0), 0),
      shares: analyticsData.rows.reduce((s: number, r: any) => s + (r[10] || 0), 0),
      impressions: analyticsData.rows.reduce((s: number, r: any) => s + (r[11] || 0), 0),
    } : null,
  };

  // 3 — Analytics par traffic source (30j)
  const trafficRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceType&sort=-views`,
    { headers: h }
  );
  results.traffic_sources = await trafficRes.json().then(d => ({ error: d.error || null, rows: d.rows }));

  // 4 — Analytics démographiques (âge + genre)
  const demoRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=viewerPercentage&dimensions=ageGroup,gender`,
    { headers: h }
  );
  results.demographics = await demoRes.json().then(d => ({ error: d.error || null, rows: d.rows }));

  // 5 — Analytics géographiques (pays)
  const geoRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,subscribersGained&dimensions=country&sort=-views&maxResults=10`,
    { headers: h }
  );
  results.geography = await geoRes.json().then(d => ({ error: d.error || null, rows: d.rows }));

  // 6 — Analytics par type d'appareil
  const deviceRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched&dimensions=deviceType&sort=-views`,
    { headers: h }
  );
  results.devices = await deviceRes.json().then(d => ({ error: d.error || null, rows: d.rows }));

  // 7 — Analytics par vidéo (toutes métriques)
  const videoAnalyticsRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2020-01-01&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained&dimensions=video&sort=-views&maxResults=10`,
    { headers: h }
  );
  const vaData = await videoAnalyticsRes.json();
  results.video_analytics = {
    error: vaData.error || null,
    columnHeaders: vaData.columnHeaders,
    rows: vaData.rows?.slice(0, 3),
  };

  // 8 — Rétention par vidéo spécifique (retention globale non supportée)
  // Note: audienceWatchRatio nécessite dimension=video avec un videoId spécifique
  results.retention_curve = { note: 'Rétention disponible uniquement par vidéo individuelle via dimensions=video&filters=video==VIDEO_ID' };

  // 9 — Vidéos récentes avec tous les champs
  const videosRes = await fetch(
    'https://www.googleapis.com/youtube/v3/search?part=id,snippet&forMine=true&type=video&order=date&maxResults=3',
    { headers: h }
  );
  const videosData = await videosRes.json();
  const videoIds = videosData?.items?.map((i: any) => i.id?.videoId).filter(Boolean).join(',');

  if (videoIds) {
    const detailsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status,topicDetails&id=${videoIds}`,
      { headers: h }
    );
    const detailsData = await detailsRes.json();
    results.video_details = detailsData?.items?.map((v: any) => ({
      id: v.id,
      title: v.snippet?.title,
      publishedAt: v.snippet?.publishedAt,
      duration: v.contentDetails?.duration,
      statistics: v.statistics,
      status: v.status,
      tags: v.snippet?.tags?.slice(0, 5),
      categoryId: v.snippet?.categoryId,
    }));
  }

  // 10 — Playlists
  const playlistsRes = await fetch(
    'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=5',
    { headers: h }
  );
  results.playlists = await playlistsRes.json().then(d => ({
    error: d.error || null,
    count: d.items?.length,
    items: d.items?.map((p: any) => ({ id: p.id, title: p.snippet?.title, videoCount: p.contentDetails?.itemCount })),
  }));

  // 11 — TEST CTR : impressionClickThroughRate (Analytics API scope standard)
  const ctrRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=impressions,impressionClickThroughRate&dimensions=day&sort=day`,
    { headers: h }
  );
  const ctrData = await ctrRes.json();
  results.ctr_standard = {
    note: 'impressionClickThroughRate via Analytics API — scope yt-analytics.readonly',
    error: ctrData.error || null,
    columnHeaders: ctrData.columnHeaders,
    rows: ctrData.rows?.slice(0, 3),
  };

  // 12 — TEST CTR par vidéo (méthode alternative suggérée par l'IA)
  const ctrVideoRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=videoThumbnailImpressions,videoThumbnailImpressionsClickRate&dimensions=video&maxResults=5`,
    { headers: h }
  );
  const ctrVideoData = await ctrVideoRes.json();
  results.ctr_video_method = {
    note: 'videoThumbnailImpressionsClickRate — méthode alternative (IA)',
    error: ctrVideoData.error || null,
    columnHeaders: ctrVideoData.columnHeaders,
    rows: ctrVideoData.rows?.slice(0, 3),
  };

  // 13 — TEST CTR via Reporting API (autre méthode suggérée)
  const reportingRes = await fetch(
    'https://youtubereporting.googleapis.com/v1/reportTypes',
    { headers: h }
  );
  const reportingData = await reportingRes.json();
  results.reporting_api = {
    note: 'Reporting API — liste des types de rapports disponibles',
    error: reportingData.error || null,
    reportTypes: reportingData.reportTypes?.map((r: any) => r.id),
  };

  return NextResponse.json(results, { status: 200 });
}
