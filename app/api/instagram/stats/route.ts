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
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`
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

  const [accountRes, mediaRes, insightsRes, demoRes, onlineFollowersRes, viewsBreakdownRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=username,name,profile_picture_url,followers_count,follows_count,media_count,biography&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/media?fields=id,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count,permalink,is_shared_to_feed,video_duration&limit=100&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach,views,follower_count,accounts_engaged,total_interactions,follows_and_unfollows,profile_links_taps,website_clicks,profile_views&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=follower_demographics&period=lifetime&breakdown=age,gender,country,city&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=online_followers&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=views&period=day&since=${since}&until=${until}&breakdown=follow_type&access_token=${token}`),
  ]);

  const [accountData, mediaData, insightsData, demoData, onlineFollowersData, viewsBreakdownData] = await Promise.all([
    safeJson(accountRes), safeJson(mediaRes), safeJson(insightsRes), safeJson(demoRes), safeJson(onlineFollowersRes), safeJson(viewsBreakdownRes),
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
  // follows_and_unfollows peut être vide sur certains comptes — on fall back sur follower_count (delta quotidien)
  const followsUnfollows30d = sum(insightMap['follows_and_unfollows'] || []) || sum(insightMap['follower_count'] || []);
  const profileLinksTaps30d = sum(insightMap['profile_links_taps'] || []);
  const websiteClicks30d = sum(insightMap['website_clicks'] || []);
  const profileViews30d = sum(insightMap['profile_views'] || []);
  const views30d = sum(insightMap['views'] || []);

  // Views breakdown follower_type : part abonnés vs non-abonnés (viralité)
  let viewsFollowerBreakdown: { follower: number; nonFollower: number } | null = null;
  for (const metric of viewsBreakdownData?.data || []) {
    if (metric.name === 'views' && metric.total_value?.breakdowns) {
      let follower = 0, nonFollower = 0;
      for (const bd of metric.total_value.breakdowns) {
        for (const r of bd.results || []) {
          const key = r.dimension_values?.[0];
          if (key === 'FOLLOWER') follower += r.value || 0;
          else if (key === 'NON_FOLLOWER') nonFollower += r.value || 0;
        }
      }
      if (follower + nonFollower > 0) viewsFollowerBreakdown = { follower, nonFollower };
    }
  }

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

  // Abonnés en ligne par heure (online_followers period=day)
  let onlineFollowers: any = null;
  for (const metric of onlineFollowersData?.data || []) {
    if (metric.name === 'online_followers' && metric.total_value) {
      onlineFollowers = metric.total_value;
    }
  }

  // Chart reach + followers par jour
  const reachValues = insightMap['reach'] || [];
  // follower_count = delta quotidien (nouveaux abonnés), pas le cumulatif
  const followerDeltaValues = insightMap['follower_count'] || [];
  const today = new Date();
  const chartData = reachValues.map((val: number, i: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (reachValues.length - 1 - i));
    return {
      date: d.toISOString().split('T')[0],
      reach: val,
      followerCount: followerDeltaValues[i] ?? null,
    };
  });

  // Extrait duration_s depuis le token efg encodé dans l'URL media_url
  // Meta n'expose pas video_duration en champ direct — la durée est dans efg (base64 JSON)
  const extractDuration = (mediaUrl: string | null | undefined): number | null => {
    if (!mediaUrl) return null;
    try {
      const match = mediaUrl.match(/[?&]efg=([^&]+)/);
      if (!match) return null;
      const decoded = JSON.parse(Buffer.from(decodeURIComponent(match[1]), 'base64').toString('utf8'));
      return typeof decoded.duration_s === 'number' ? decoded.duration_s : null;
    } catch {
      return null;
    }
  };

  // Fetch insights par média en parallèle
  const mediaItems = mediaData?.data || [];
  const mediaWithInsights = await Promise.all(
    mediaItems.map(async (p: any) => {
      const isReel = p.media_type === 'VIDEO' || p.media_type === 'REEL';

      // 3 calls indépendants pour éviter qu'une métrique refusée fasse échouer les autres
      const safeInsights = async (metric: string) => {
        try {
          const r = await fetch(`https://graph.instagram.com/v22.0/${p.id}/insights?metric=${metric}&access_token=${token}`);
          const d = await r.json();
          if (d?.error || !d?.data) return {};
          const out: Record<string, number> = {};
          for (const m of d.data) out[m.name] = m.values?.[0]?.value ?? m.value ?? 0;
          return out;
        } catch { return {}; }
      };

      try {
        const ins: Record<string, number> = {};

        // Call 1 : métriques communes à tous les types
        Object.assign(ins, await safeInsights('likes,comments,reach,saved,shares,views,total_interactions'));

        if (isReel) {
          // Call 2 : watch time + skip rate (métriques reel uniquement)
          Object.assign(ins, await safeInsights('ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate'));
          // follows + profile_visits non supportés sur les reels (erreur API confirmée)
        } else {
          // Pour les images/carousels : follows + profile_visits supportés
          Object.assign(ins, await safeInsights('follows,profile_visits'));
        }

        // null = métrique non disponible pour ce type de média (≠ 0)
        const pick = (key: string, fallback?: number) =>
          key in ins ? ins[key] : (fallback !== undefined ? fallback : null);

        return {
          id: p.id,
          caption: p.caption ? p.caption.slice(0, 150) : '',
          type: p.media_type,
          thumbnail: p.thumbnail_url || p.media_url || null,
          timestamp: p.timestamp,
          permalink: p.permalink,
          likes: pick('likes', p.like_count),
          comments: pick('comments', p.comments_count),
          reach: pick('reach'),
          saved: pick('saved'),
          shares: pick('shares'),
          views: pick('views'),
          totalInteractions: pick('total_interactions'),
          follows: pick('follows'),
          profileVisits: pick('profile_visits'),
          videoDuration: extractDuration(p.media_url) ?? p.video_duration ?? null,
          avgWatchTimeMs: pick('ig_reels_avg_watch_time'),
          totalWatchTimeMs: pick('ig_reels_video_view_total_time'),
          skipRate: pick('reels_skip_rate'),
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
          videoDuration: extractDuration(p.media_url) ?? p.video_duration ?? null,
          reach: null, saved: null, shares: null, views: null,
          totalInteractions: null, follows: null, profileVisits: null,
          avgWatchTimeMs: null, totalWatchTimeMs: null, skipRate: null,
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
    websiteClicks30d,
    profileViews30d,
    views30d,
    viewsFollowerBreakdown,
    chartData,
    posts: mediaWithInsights,
    demographics,
    onlineFollowers,
  });
}
