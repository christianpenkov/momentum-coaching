import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getRefreshedToken(profileId: string): Promise<{ token: string; igAccountId: string } | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, expires_at, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return null;

  // Renouvelle le token si expiré dans moins de 5 jours (token FB long-terme = 60j)
  const needsRefresh = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 24 * 60 * 60 * 1000;

  let token = integ.access_token;

  if (needsRefresh) {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.INSTAGRAM_CLIENT_ID}&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&fb_exchange_token=${token}`
    );
    const data = await res.json();
    if (data.access_token) {
      token = data.access_token;
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null;
      await serviceSupabase.from('integrations').update({
        access_token: token,
        expires_at: expiresAt,
      }).eq('profile_id', profileId).eq('provider', 'instagram');
    }
  }

  const igAccountId: string | null = (integ.metadata as any)?.ig_account_id || null;

  if (!igAccountId) return null;
  return { token, igAccountId };
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

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

  const creds = await getRefreshedToken(targetProfileId);
  if (!creds) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const { token, igAccountId } = creds;

  // Stats du compte + médias récents en parallèle
  const [accountRes, mediaRes, insightsRes] = await Promise.all([
    fetch(
      `https://graph.facebook.com/v21.0/${igAccountId}?fields=username,name,profile_picture_url,followers_count,follows_count,media_count,biography&access_token=${token}`
    ),
    fetch(
      `https://graph.facebook.com/v21.0/${igAccountId}/media?fields=id,caption,media_type,thumbnail_url,media_url,timestamp,like_count,comments_count,permalink&limit=12&access_token=${token}`
    ),
    fetch(
      `https://graph.facebook.com/v21.0/${igAccountId}/insights?metric=reach,impressions,profile_views,follower_count&period=day&since=${Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000)}&until=${Math.floor(Date.now() / 1000)}&access_token=${token}`
    ),
  ]);

  const [accountData, mediaData, insightsData] = await Promise.all([
    accountRes.json(),
    mediaRes.json(),
    insightsRes.json(),
  ]);

  if (accountData.error) {
    return NextResponse.json({ error: accountData.error.message }, { status: 400 });
  }

  // Agrège les insights 30j
  const insightMap: Record<string, number[]> = {};
  for (const metric of insightsData?.data || []) {
    insightMap[metric.name] = (metric.values || []).map((v: any) => v.value || 0);
  }
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const reach30d = sum(insightMap['reach'] || []);
  const impressions30d = sum(insightMap['impressions'] || []);
  const profileViews30d = sum(insightMap['profile_views'] || []);
  const followerGrowth30d = sum(insightMap['follower_count'] || []);

  // Chart followers par jour (dernier 30j depuis insights)
  const followerValues = insightMap['follower_count'] || [];
  const today = new Date();
  const chartData = followerValues.map((val: number, i: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (followerValues.length - 1 - i));
    return { date: d.toISOString().split('T')[0], followers: val };
  });

  const posts = (mediaData?.data || []).map((p: any) => ({
    id: p.id,
    caption: p.caption ? p.caption.slice(0, 120) : '',
    type: p.media_type,
    thumbnail: p.thumbnail_url || p.media_url || null,
    timestamp: p.timestamp,
    likes: p.like_count || 0,
    comments: p.comments_count || 0,
    permalink: p.permalink,
  }));

  return NextResponse.json({
    username: accountData.username,
    name: accountData.name,
    profilePicture: accountData.profile_picture_url || null,
    followers: accountData.followers_count || 0,
    following: accountData.follows_count || 0,
    mediaCount: accountData.media_count || 0,
    reach30d,
    impressions30d,
    profileViews30d,
    followerGrowth30d,
    chartData,
    posts,
  });
}
