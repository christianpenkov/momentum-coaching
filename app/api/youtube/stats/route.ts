import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

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

function parseDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '0:00';
  const h = parseInt(m[1] || '0');
  const min = parseInt(m[2] || '0');
  const sec = parseInt(m[3] || '0');
  if (h > 0) return `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getStartDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  // Si profileId fourni (coach consultant un client) — vérifier autorisation
  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  const accessToken = await getFreshToken(targetProfileId);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // Étape 1 : channel + analytics 30j + sources trafic + devices + démographie — tout en parallèle
  const [channelRes, analyticsRes, trafficRes, devicesRes, demoRes, searchTermsRes] = await Promise.all([
    fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true', {
      headers: authHeader,
    }),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares,averageViewDuration&dimensions=day&sort=day`,
      { headers: authHeader }
    ),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceType&sort=-views`,
      { headers: authHeader }
    ),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched&dimensions=deviceType&sort=-views`,
      { headers: authHeader }
    ),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=viewerPercentage&dimensions=ageGroup,gender`,
      { headers: authHeader }
    ),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views&dimensions=insightTrafficSourceDetail&filters=insightTrafficSourceType==YT_SEARCH&sort=-views&maxResults=10`,
      { headers: authHeader }
    ),
  ]);

  const [channelData, analyticsData, trafficData, devicesData, demoData, searchTermsData] = await Promise.all([
    channelRes.json(), analyticsRes.json(), trafficRes.json(),
    devicesRes.json(), demoRes.json(), searchTermsRes.json(),
  ]);

  const channel = channelData?.items?.[0];
  if (!channel) return NextResponse.json({ error: 'Chaîne introuvable' }, { status: 404 });

  const stats = channel.statistics;
  const rows: any[] = analyticsData?.rows || [];

  // colonnes : day(0), views(1), estMinutesWatched(2), subsGained(3), subsLost(4), likes(5), comments(6), shares(7), avgViewDuration(8)
  const views30d = rows.reduce((sum: number, r: any) => sum + (r[1] || 0), 0);
  const watchTime30d = rows.reduce((sum: number, r: any) => sum + (r[2] || 0), 0);
  const subsGained30d = rows.reduce((sum: number, r: any) => sum + (r[3] || 0), 0);
  const subsLost30d = rows.reduce((sum: number, r: any) => sum + (r[4] || 0), 0);
  const likes30d = rows.reduce((sum: number, r: any) => sum + (r[5] || 0), 0);
  const comments30d = rows.reduce((sum: number, r: any) => sum + (r[6] || 0), 0);
  const shares30d = rows.reduce((sum: number, r: any) => sum + (r[7] || 0), 0);
  // avgViewDuration : moyenne pondérée par les vues (col 8), fallback watchTime/views
  const avgViewDurationWeighted = views30d > 0
    ? Math.round(rows.reduce((sum: number, r: any) => sum + (r[8] || 0) * (r[1] || 0), 0) / views30d)
    : 0;
  const avgViewDurationSec = avgViewDurationWeighted > 0
    ? avgViewDurationWeighted
    : (views30d > 0 ? Math.round((watchTime30d * 60) / views30d) : 0);

  const chartData = rows.map((r: any) => ({
    date: r[0],
    views: r[1] || 0,
    watchTime: r[2] || 0,
    subsGained: r[3] || 0,
    subsLost: r[4] || 0,
    netSubs: (r[3] || 0) - (r[4] || 0),
  }));

  // Sources de trafic
  const trafficSources = (trafficData?.rows || []).map((r: any) => ({
    source: r[0] as string,
    views: r[1] || 0,
    watchMinutes: r[2] || 0,
  }));

  // Appareils
  const devices = (devicesData?.rows || []).map((r: any) => ({
    device: r[0] as string,
    views: r[1] || 0,
    watchMinutes: r[2] || 0,
  }));

  // Démographie âge/genre
  const demographics = (demoData?.rows || []).map((r: any) => ({
    ageGroup: r[0] as string,
    gender: r[1] as string,
    viewerPct: parseFloat((r[2] || 0).toFixed(1)),
  }));

  // Mots-clés de recherche top 10
  const searchKeywords = (searchTermsData?.rows || []).map((r: any) => ({
    term: r[0] as string,
    views: r[1] || 0,
  }));

  // Étape 2 : playlist "uploads" pour récupérer TOUTES les vidéos (jusqu'à 50)
  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
  const videoIds: string[] = [];

  if (uploadsPlaylistId) {
    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=50`,
      { headers: authHeader }
    );
    const playlistData = await playlistRes.json();
    for (const item of playlistData?.items || []) {
      const id = item.contentDetails?.videoId;
      if (id) videoIds.push(id);
    }
  }

  let videos: any[] = [];

  if (videoIds.length > 0) {
    const videoIdsStr = videoIds.join(',');
    const [detailsRes, analyticsVideosRes] = await Promise.all([
      fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIdsStr}`,
        { headers: authHeader }
      ),
      // Métriques par vidéo ciblées (filtre sur les IDs exacts)
      fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2020-01-01&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,averageViewPercentage,likes,comments,shares&dimensions=video&filters=video==${videoIdsStr}&maxResults=50`,
        { headers: authHeader }
      ),
    ]);

    const detailsData = await detailsRes.json();
    const analyticsVideosData = await analyticsVideosRes.json();

    // Map analytics par videoId : [video, views, watchTime, avgViewPct, likes, comments, shares]
    const analyticsByVideo: Record<string, { views30d: number; watchTime30d: number; avgViewPct: number; likes30d: number; comments30d: number; shares30d: number }> = {};
    for (const row of analyticsVideosData?.rows || []) {
      analyticsByVideo[row[0]] = {
        views30d: row[1] || 0,
        watchTime30d: Math.round((row[2] || 0) / 60),
        avgViewPct: parseFloat(((row[3] || 0)).toFixed(1)),
        likes30d: row[4] || 0,
        comments30d: row[5] || 0,
        shares30d: row[6] || 0,
      };
    }

    const retentionCurve: any[] = [];

    videos = (detailsData?.items || []).map((v: any) => {
      const a = analyticsByVideo[v.id] || { views30d: 0, watchTime30d: 0, avgViewPct: 0, likes30d: 0, comments30d: 0, shares30d: 0 };
      const rawDuration = v.contentDetails?.duration || 'PT0S';
      const durMatch = rawDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const durSecs = (parseInt(durMatch?.[1] || '0') * 3600) + (parseInt(durMatch?.[2] || '0') * 60) + parseInt(durMatch?.[3] || '0');
      const isShort = durSecs <= 60;
      return {
        id: v.id,
        title: v.snippet?.title,
        thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
        publishedAt: v.snippet?.publishedAt,
        duration: parseDuration(rawDuration),
        isShort,
        views: parseInt(v.statistics?.viewCount || '0'),
        likes: parseInt(v.statistics?.likeCount || '0'),
        comments: parseInt(v.statistics?.commentCount || '0'),
        views30d: a.views30d,
        watchTime30d: a.watchTime30d,
        avgViewPct: a.avgViewPct,
        likes30d: a.likes30d,
        comments30d: a.comments30d,
        shares30d: a.shares30d,
        url: `https://www.youtube.com/watch?v=${v.id}`,
      };
    });

    return NextResponse.json({
      channelName: channel.snippet?.title,
      channelThumbnail: channel.snippet?.thumbnails?.default?.url,
      subscribers: parseInt(stats?.subscriberCount || '0'),
      totalViews: parseInt(stats?.viewCount || '0'),
      videoCount: parseInt(stats?.videoCount || '0'),
      views30d, watchTime30d: Math.round(watchTime30d / 60), avgViewDurationSec,
      likes30d, comments30d, shares30d,
      subsGained30d, subsLost30d, netSubs30d: subsGained30d - subsLost30d,
      chartData, videos, retentionCurve,
      trafficSources, devices, demographics, searchKeywords,
    });
  }

  return NextResponse.json({
    channelName: channel.snippet?.title,
    channelThumbnail: channel.snippet?.thumbnails?.default?.url,
    subscribers: parseInt(stats?.subscriberCount || '0'),
    totalViews: parseInt(stats?.viewCount || '0'),
    videoCount: parseInt(stats?.videoCount || '0'),
    views30d, watchTime30d: Math.round(watchTime30d / 60), avgViewDurationSec,
    likes30d, comments30d, shares30d,
    subsGained30d, subsLost30d, netSubs30d: subsGained30d - subsLost30d,
    chartData, videos: [], retentionCurve: [],
    trafficSources, devices, demographics, searchKeywords,
  });
}
