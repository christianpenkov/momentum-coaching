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

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const accessToken = await getFreshToken(user.id);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // Requêtes parallèles : channel + analytics + vidéos récentes (search + details)
  const [channelRes, analyticsRes, searchRes] = await Promise.all([
    fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
      headers: authHeader,
    }),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost&dimensions=day&sort=day`,
      { headers: authHeader }
    ),
    fetch(
      'https://www.googleapis.com/youtube/v3/search?part=id,snippet&forMine=true&type=video&order=date&maxResults=20',
      { headers: authHeader }
    ),
  ]);

  const channelData = await channelRes.json();
  const channel = channelData?.items?.[0];
  if (!channel) return NextResponse.json({ error: 'Chaîne introuvable' }, { status: 404 });

  const stats = channel.statistics;
  const analyticsData = await analyticsRes.json();
  const rows: any[] = analyticsData?.rows || [];

  const views30d = rows.reduce((sum: number, r: any) => sum + (r[1] || 0), 0);
  const watchTime30d = rows.reduce((sum: number, r: any) => sum + (r[2] || 0), 0);
  const subsGained30d = rows.reduce((sum: number, r: any) => sum + (r[3] || 0), 0);
  const subsLost30d = rows.reduce((sum: number, r: any) => sum + (r[4] || 0), 0);

  const chartData = rows.map((r: any) => ({
    date: r[0],
    views: r[1] || 0,
    watchTime: r[2] || 0,
  }));

  // Récupère les IDs des vidéos pour fetcher leurs stats détaillées
  const searchData = await searchRes.json();
  const videoIds: string[] = (searchData?.items || [])
    .map((item: any) => item.id?.videoId)
    .filter(Boolean);

  let videos: any[] = [];

  if (videoIds.length > 0) {
    const videoIdsStr = videoIds.join(',');
    const [detailsRes, analyticsVideosRes, ctrRetentionRes] = await Promise.all([
      fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIdsStr}`,
        { headers: authHeader }
      ),
      // Vues + watch time + impressions + CTR par vidéo sur 30j
      fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,impressions,impressionClickThroughRate,averageViewPercentage&dimensions=video&filters=video==${videoIdsStr}&maxResults=20`,
        { headers: authHeader }
      ),
      // Rétention globale de la chaîne sur 30j (courbe audience par % de la vidéo)
      fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio`,
        { headers: authHeader }
      ),
    ]);

    const detailsData = await detailsRes.json();
    const analyticsVideosData = await analyticsVideosRes.json();
    const ctrRetentionData = await ctrRetentionRes.json();

    // Map analytics par videoId : [views, watchTime, impressions, ctr, avgViewPct]
    const analyticsByVideo: Record<string, { views30d: number; watchTime30d: number; impressions: number; ctr: number; avgViewPct: number }> = {};
    for (const row of analyticsVideosData?.rows || []) {
      analyticsByVideo[row[0]] = {
        views30d: row[1] || 0,
        watchTime30d: Math.round((row[2] || 0) / 60), // minutes → heures
        impressions: row[3] || 0,
        ctr: parseFloat(((row[4] || 0) * 100).toFixed(1)), // ratio → %
        avgViewPct: parseFloat(((row[5] || 0)).toFixed(1)),
      };
    }

    // Courbe de rétention globale de la chaîne : [{ratio: 0.05, watchRatio: 0.9}, ...]
    const retentionCurve = (ctrRetentionData?.rows || []).map((r: any) => ({
      ratio: parseFloat((r[0] * 100).toFixed(0)), // % de la vidéo écoulé
      watchRatio: parseFloat((r[1] * 100).toFixed(1)), // % d'audience restante
    }));

    videos = (detailsData?.items || []).map((v: any) => {
      const a = analyticsByVideo[v.id] || { views30d: 0, watchTime30d: 0, impressions: 0, ctr: 0, avgViewPct: 0 };
      return {
        id: v.id,
        title: v.snippet?.title,
        thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
        publishedAt: v.snippet?.publishedAt,
        duration: parseDuration(v.contentDetails?.duration || 'PT0S'),
        views: parseInt(v.statistics?.viewCount || '0'),
        likes: parseInt(v.statistics?.likeCount || '0'),
        comments: parseInt(v.statistics?.commentCount || '0'),
        views30d: a.views30d,
        watchTime30d: a.watchTime30d,
        impressions: a.impressions,
        ctr: a.ctr,
        avgViewPct: a.avgViewPct,
        url: `https://www.youtube.com/watch?v=${v.id}`,
      };
    });

    return NextResponse.json({
      channelName: channel.snippet?.title,
      channelThumbnail: channel.snippet?.thumbnails?.default?.url,
      subscribers: parseInt(stats?.subscriberCount || '0'),
      totalViews: parseInt(stats?.viewCount || '0'),
      videoCount: parseInt(stats?.videoCount || '0'),
      views30d,
      watchTime30d: Math.round(watchTime30d / 60),
      subsGained30d,
      subsLost30d,
      netSubs30d: subsGained30d - subsLost30d,
      chartData,
      videos,
      retentionCurve,
    });
  }

  return NextResponse.json({
    channelName: channel.snippet?.title,
    channelThumbnail: channel.snippet?.thumbnails?.default?.url,
    subscribers: parseInt(stats?.subscriberCount || '0'),
    totalViews: parseInt(stats?.viewCount || '0'),
    videoCount: parseInt(stats?.videoCount || '0'),
    views30d,
    watchTime30d: Math.round(watchTime30d / 60),
    subsGained30d,
    subsLost30d,
    netSubs30d: subsGained30d - subsLost30d,
    chartData,
    videos: [],
    retentionCurve: [],
  });
}
