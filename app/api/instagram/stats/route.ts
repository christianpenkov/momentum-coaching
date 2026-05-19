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

  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  const safeJson = async (res: Response) => { try { return await res.json(); } catch { return {}; } };

  const [accountRes, mediaRes, insightsRes, demoRes, activeTimesRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v21.0/${igAccountId}?fields=username,name,profile_picture_url,followers_count,follows_count,media_count,biography&access_token=${token}`),
    fetch(`https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,caption,media_type,thumbnail_url,media_url,timestamp,like_count,comments_count,permalink&limit=100&access_token=${token}`),
    fetch(`https://graph.instagram.com/v21.0/${igAccountId}/insights?metric=reach,accounts_engaged,total_interactions,follows_and_unfollows,profile_links_taps&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v21.0/${igAccountId}/insights?metric=follower_demographics&period=lifetime&breakdown=age,gender,country,city&access_token=${token}`),
    fetch(`https://graph.instagram.com/v21.0/${igAccountId}/insights?metric=follower_active_times&period=lifetime&access_token=${token}`),
  ]);

  const [accountData, mediaData, insightsData, demoData, activeTimesData] = await Promise.all([
    safeJson(accountRes), safeJson(mediaRes), safeJson(insightsRes), safeJson(demoRes), safeJson(activeTimesRes),
  ]);

  if (accountData.error) {
    return NextResponse.json({
      error: accountData.error.message,
      code: accountData.error.code,
      type: accountData.error.type,
      insightsError: insightsData?.error || null,
    }, { status: 400 });
  }

  // Agrège les insights compte 30j
  const insightMap: Record<string, number[]> = {};
  for (const metric of insightsData?.data || []) {
    insightMap[metric.name] = (metric.values || []).map((v: any) => v.value || 0);
  }
  const sum = (arr: number[]) => (arr || []).reduce((a, b) => a + b, 0);

  const reach30d = sum(insightMap['reach'] || []);
  const accountsEngaged30d = sum(insightMap['accounts_engaged'] || []);
  const totalInteractions30d = sum(insightMap['total_interactions'] || []);
  const followsUnfollows30d = sum(insightMap['follows_and_unfollows'] || []);
  const profileLinksTaps30d = sum(insightMap['profile_links_taps'] || []);

  // Démographie abonnés
  const demographics: Record<string, any> = {};
  for (const metric of demoData?.data || []) {
    if (metric.name === 'follower_demographics' && metric.total_value?.breakdowns) {
      for (const breakdown of metric.total_value.breakdowns) {
        const key = breakdown.dimension_keys?.[0];
        if (key) {
          demographics[key] = (breakdown.results || []).map((r: any) => ({
            label: r.dimension_values?.[0],
            value: r.value || 0,
          })).sort((a: any, b: any) => b.value - a.value).slice(0, 10);
        }
      }
    }
  }

  // Heures d'activité des abonnés
  let activeTimes: any = null;
  for (const metric of activeTimesData?.data || []) {
    if (metric.name === 'follower_active_times' && metric.total_value) {
      activeTimes = metric.total_value;
    }
  }

  // Chart reach par jour
  const reachValues = insightMap['reach'] || [];
  const today = new Date();
  const chartData = reachValues.map((val: number, i: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (reachValues.length - 1 - i));
    return { date: d.toISOString().split('T')[0], reach: val };
  });

  // Fetch insights par média en parallèle
  const mediaItems = mediaData?.data || [];
  const mediaWithInsights = await Promise.all(
    mediaItems.map(async (p: any) => {
      const isReel = p.media_type === 'VIDEO' || p.media_type === 'REEL';

      // Stratégie : appel de base commun à tous les types, puis appel reel séparé
      // pour éviter qu'une métrique non supportée fasse échouer tout l'appel
      const baseMetrics = 'likes,comments,reach,saved,shares,views,total_interactions';
      const reelMetrics = 'ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate,video_completion_rate';

      try {
        const insRes = await fetch(
          `https://graph.instagram.com/v21.0/${p.id}/insights?metric=${baseMetrics}&access_token=${token}`
        );
        const insData = await insRes.json();

        const ins: Record<string, number> = {};

        // Si erreur sur l'appel de base, on utilise les compteurs du feed comme fallback
        if (!insData?.error) {
          for (const m of insData?.data || []) {
            ins[m.name] = m.values?.[0]?.value ?? m.value ?? 0;
          }
        }

        // Appel séparé pour les métriques reel uniquement si c'est un reel
        if (isReel) {
          try {
            const reelRes = await fetch(
              `https://graph.instagram.com/v21.0/${p.id}/insights?metric=${reelMetrics}&access_token=${token}`
            );
            const reelData = await reelRes.json();
            if (!reelData?.error) {
              for (const m of reelData?.data || []) {
                ins[m.name] = m.values?.[0]?.value ?? m.value ?? 0;
              }
            }
          } catch { /* métriques reel optionnelles */ }
        }

        return {
          id: p.id,
          caption: p.caption ? p.caption.slice(0, 150) : '',
          type: p.media_type,
          thumbnail: p.thumbnail_url || p.media_url || null,
          timestamp: p.timestamp,
          permalink: p.permalink,
          likes: ins['likes'] ?? p.like_count ?? 0,
          comments: ins['comments'] ?? p.comments_count ?? 0,
          reach: ins['reach'] ?? 0,
          saved: ins['saved'] ?? 0,
          shares: ins['shares'] ?? 0,
          views: ins['views'] ?? 0,
          totalInteractions: ins['total_interactions'] ?? 0,
          avgWatchTimeMs: ins['ig_reels_avg_watch_time'] ?? 0,
          totalWatchTimeMs: ins['ig_reels_video_view_total_time'] ?? 0,
          skipRate: ins['reels_skip_rate'] ?? 0,
          completionRate: ins['video_completion_rate'] ?? 0,
        };
      } catch {
        return {
          id: p.id,
          caption: p.caption ? p.caption.slice(0, 150) : '',
          type: p.media_type,
          thumbnail: p.thumbnail_url || p.media_url || null,
          timestamp: p.timestamp,
          permalink: p.permalink,
          likes: p.like_count ?? 0,
          comments: p.comments_count ?? 0,
          reach: 0, saved: 0, shares: 0, views: 0,
          totalInteractions: 0, avgWatchTimeMs: 0, totalWatchTimeMs: 0, skipRate: 0, completionRate: 0,
        };
      }
    })
  );

  return NextResponse.json({
    username: accountData.username,
    name: accountData.name,
    profilePicture: accountData.profile_picture_url || null,
    followers: accountData.followers_count || 0,
    following: accountData.follows_count || 0,
    mediaCount: accountData.media_count || 0,
    biography: accountData.biography || '',
    reach30d,
    accountsEngaged30d,
    totalInteractions30d,
    followsUnfollows30d,
    profileLinksTaps30d,
    chartData,
    posts: mediaWithInsights,
    demographics,
    activeTimes,
  });
}
