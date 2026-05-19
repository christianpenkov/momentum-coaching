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

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const accessToken = await getFreshToken(user.id);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const [channelRes, analyticsRes] = await Promise.all([
    fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost&dimensions=day&sort=day`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    ),
  ]);

  const channelData = await channelRes.json();
  const channel = channelData?.items?.[0];

  if (!channel) return NextResponse.json({ error: 'Chaîne introuvable' }, { status: 404 });

  const stats = channel.statistics;
  const analyticsData = await analyticsRes.json();
  const rows: any[] = analyticsData?.rows || [];

  // Calcule les totaux sur 30 jours
  const views30d = rows.reduce((sum: number, r: any) => sum + (r[1] || 0), 0);
  const watchTime30d = rows.reduce((sum: number, r: any) => sum + (r[2] || 0), 0);
  const subsGained30d = rows.reduce((sum: number, r: any) => sum + (r[3] || 0), 0);
  const subsLost30d = rows.reduce((sum: number, r: any) => sum + (r[4] || 0), 0);

  // Données pour graphique (vues par jour)
  const chartData = rows.map((r: any) => ({
    date: r[0],
    views: r[1] || 0,
    watchTime: r[2] || 0,
  }));

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
  });
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getStartDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}
