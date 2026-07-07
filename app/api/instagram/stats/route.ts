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
  // online_followers : fenêtre J-33→J-3 pour éviter les 48h de délai Meta (objets {} vides)
  const ofUntil = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
  const ofSince = Math.floor((Date.now() - 33 * 24 * 60 * 60 * 1000) / 1000);

  const safeJson = async (res: Response) => { try { return await res.json(); } catch { return {}; } };

  // reach/follower_count/accounts_engaged/total_interactions/posts : lus depuis
  // analytics_daily_snapshots / analytics_ig_posts_history (même DB que la vue
  // historique S-1+, alimentée par le cron toutes les 30 min — cf. lib/ig-fetch.ts /
  // supabase/functions/poll-leads/index.ts), pas depuis l'API Meta live.
  //
  // RÈGLE (pour éviter la récidive, cf. bug du 2026-07-07) : toute métrique Meta qui
  // n'existe qu'en `metric_type=total_value` agrégé sur toute la fenêtre demandée
  // (accounts_engaged, total_interactions — jamais une vraie série `values[]` par
  // jour, contrairement à reach/follower_count) NE DOIT JAMAIS être reconstruite
  // depuis un appel live dans cette route : soit la DB a la vraie valeur quotidienne
  // (le cron interroge Meta un jour à la fois), soit rien. Un appel live "total_value"
  // pour ce genre de métrique ne peut remplir qu'un seul point (l'agrégat), jamais
  // toute une série jour par jour — l'ancien bug venait exactement de ce genre de
  // confusion (résultat fetché puis jamais utilisable proprement).
  //
  // Champs qui restent en live Meta (bio/photo/username/heatmap/démographie/views
  // breakdown/reach dédupliqué 28j) : jamais collectés par le cron aujourd'hui,
  // migrer ça est un chantier de collecte séparé (cf. TODOS.md / plan).
  const sinceDateStr = new Date(since * 1000).toISOString().split('T')[0];
  const untilDateStr = new Date(until * 1000).toISOString().split('T')[0];
  const dbSnapshotsPromise = serviceSupabase
    .from('analytics_daily_snapshots')
    .select('date, ig_reach, ig_followers, ig_accounts_engaged, ig_total_interactions, ig_views, ig_website_clicks, ig_profile_taps, ig_reach_follower, ig_reach_non_follower')
    .eq('profile_id', targetProfileId)
    .gte('date', sinceDateStr)
    .lte('date', untilDateStr)
    .order('date', { ascending: true });
  const dbPostsPromise = serviceSupabase
    .from('analytics_ig_posts_history')
    .select('*')
    .eq('profile_id', targetProfileId)
    .gte('snapshot_date', sinceDateStr)
    .lte('snapshot_date', untilDateStr)
    .order('snapshot_date', { ascending: false });

  const [accountRes, demoRes, onlineFollowersRes, viewsBreakdownRes, reachDedupRes, dbSnapshotsRes, dbPostsRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=username,name,profile_picture_url,followers_count,follows_count,media_count,biography&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=follower_demographics&period=lifetime&breakdown=age,gender,country,city&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=online_followers&period=lifetime&since=${ofSince}&until=${ofUntil}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=views&metric_type=total_value&breakdown=follow_type,media_product_type&period=day&since=${since}&until=${until}&access_token=${token}`),
    // Reach RÉELLEMENT dédupliqué sur la fenêtre, ventilé abonnés/non-abonnés — pas une
    // somme de valeurs quotidiennes (qui recompte un même compte touché sur plusieurs
    // jours) — confirmé en testant l'API réelle : period=days_28 + metric_type=total_value
    // + breakdown=follow_type renvoie le VRAI nombre de comptes uniques distincts par
    // catégorie sur toute la fenêtre, calculé côté serveur par Meta. Fenêtre fixe 28j (pas
    // de since/until arbitraire possible pour reach en mode dédupliqué, contrairement à views).
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&period=days_28&metric_type=total_value&breakdown=follow_type&access_token=${token}`),
    dbSnapshotsPromise,
    dbPostsPromise,
  ]);

  const [accountData, demoData, onlineFollowersData, viewsBreakdownData, reachDedupData] = await Promise.all([
    safeJson(accountRes), safeJson(demoRes), safeJson(onlineFollowersRes), safeJson(viewsBreakdownRes), safeJson(reachDedupRes),
  ]);
  const dbSnaps = dbSnapshotsRes.data ?? [];

  if (accountData.error) {
    return NextResponse.json({
      error: accountData.error.message,
      code: accountData.error.code,
      type: accountData.error.type,
    }, { status: 400 });
  }

  const sum = (arr: (number | null)[]) => arr.reduce((a: number, b) => a + (b ?? 0), 0);

  const reach30d = sum(dbSnaps.map(r => r.ig_reach));
  // Nombre RÉEL de comptes abonnés uniques distincts touchés sur ~28j (pas un ratio
  // statistique ni une somme de reach quotidien qui recompte un même compte touché
  // plusieurs jours) — total_value + breakdown=follow_type de Meta renvoie le vrai
  // décompte de comptes uniques par catégorie sur toute la fenêtre, calculé côté
  // serveur. Utilisé pour "Followers reach rate" = abonnés uniques touchés / abonnés
  // total ; reach30d (somme quotidienne) reste utilisé pour le KPI "Reach · personnes"
  // et le graphique jour par jour, non concernés par ce biais.
  let reach28dDedupFollowers: number | null = null;
  let reach28dDedupNonFollowers: number | null = null;
  for (const metric of reachDedupData?.data || []) {
    if (metric.name === 'reach' && metric.total_value?.breakdowns) {
      reach28dDedupFollowers = 0;
      reach28dDedupNonFollowers = 0;
      for (const bd of metric.total_value.breakdowns) {
        for (const r of bd.results || []) {
          const key = r.dimension_values?.[0];
          if (key === 'FOLLOWER') reach28dDedupFollowers += r.value ?? 0;
          else if (key === 'NON_FOLLOWER') reach28dDedupNonFollowers += r.value ?? 0;
        }
      }
    }
  }
  const accountsEngaged30d = sum(dbSnaps.map(r => r.ig_accounts_engaged));
  const totalInteractions30d = sum(dbSnaps.map(r => r.ig_total_interactions));
  const profileLinksTaps30d = sum(dbSnaps.map(r => r.ig_profile_taps));
  const websiteClicks30d = sum(dbSnaps.map(r => r.ig_website_clicks));
  const views30d = sum(dbSnaps.map(r => r.ig_views));
  // follows_and_unfollows : pas de colonne dédiée fiable en DB actuellement — approximé
  // par le delta net d'abonnés sur la fenêtre (dernier - premier jour connu).
  const followsUnfollows30d = (() => {
    const withFollowers = dbSnaps.filter(r => r.ig_followers != null);
    if (withFollowers.length < 2) return 0;
    return (withFollowers[withFollowers.length - 1].ig_followers ?? 0) - (withFollowers[0].ig_followers ?? 0);
  })();

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

  // Heatmap abonnés en ligne — period=lifetime, clés PST converties en heure Paris (UTC+2 été)
  // PST offset : +7h en été (PDT), +8h en hiver (PST)
  const now2 = new Date();
  const yr = now2.getUTCFullYear();
  const dstS = new Date(Date.UTC(yr, 2, 1)); dstS.setUTCDate(1 + (7 - dstS.getUTCDay()) % 7 + 7);
  const dstE = new Date(Date.UTC(yr, 10, 1)); dstE.setUTCDate(1 + (7 - dstE.getUTCDay()) % 7);
  const pstOffset = now2 >= dstS && now2 < dstE ? 7 : 8;
  const localOffset = 2; // Paris UTC+2 été — à rendre dynamique quand on aura le TZ du coach

  const heatmapMatrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const heatmapCount: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const ofValues = onlineFollowersData?.data?.[0]?.values || [];
  for (const entry of ofValues) {
    if (!entry.value || typeof entry.value !== 'object' || Object.keys(entry.value).length === 0) continue;
    const day = new Date(entry.end_time).getUTCDay();
    for (let pstHour = 0; pstHour < 24; pstHour++) {
      const count = entry.value[String(pstHour)] ?? 0;
      const localHour = (pstHour + pstOffset + localOffset) % 24;
      heatmapMatrix[day][localHour] += count;
      heatmapCount[day][localHour]++;
    }
  }
  const onlineFollowers = {
    heatmap: heatmapMatrix.map((row, d) =>
      row.map((sum, h) => heatmapCount[d][h] > 0 ? Math.round(sum / heatmapCount[d][h]) : 0)
    ),
    maxValue: Math.max(...heatmapMatrix.flat().map((sum, i) => {
      const d = Math.floor(i / 24); const h = i % 24;
      return heatmapCount[d][h] > 0 ? Math.round(sum / heatmapCount[d][h]) : 0;
    }), 1),
    dataPointCount: ofValues.filter((e: any) => e.value && Object.keys(e.value).length > 0).length,
  };

  // Chart reach + followers + vues + interactions par jour — directement depuis dbSnaps
  // (déjà trié par date croissante). ig_followers est déjà un nombre ABSOLU par jour
  // (pas un delta à reconstruire) : le cron écrit accountData.followers_count "réel" à
  // chaque passage, sur la ligne du jour concerné (hier + aujourd'hui, cf. fix cron
  // 2026-07-07) — plus besoin de reconstruire à rebours depuis un delta Meta bruité.
  const chartData = dbSnaps.map(r => ({
    date: r.date,
    reach: r.ig_reach ?? 0,
    followerCount: r.ig_followers ?? null,
    views: r.ig_views ?? 0,
    accountsEngaged: r.ig_accounts_engaged ?? 0,
    totalInteractions: r.ig_total_interactions ?? 0,
    websiteClicks: r.ig_website_clicks ?? 0,
    reachFollower: r.ig_reach_follower ?? null,
    reachNonFollower: r.ig_reach_non_follower ?? null,
  }));

  // Posts individuels — depuis analytics_ig_posts_history (même table que le cron
  // snapshotIgPosts alimente quotidiennement, thumbnails déjà pérennisées dans un
  // bucket Storage permanent depuis le fix du 2026-07-07). Dédupliqué par post_id, on
  // garde le snapshot le plus récent (query triée snapshot_date descendant) — même
  // pattern que latestIgPost/igPosts dans components/analytics/PageClientStats.tsx.
  const dbPostRows = dbPostsRes.data ?? [];
  const latestPostByid = new Map<string, any>();
  for (const row of dbPostRows) {
    if (!latestPostByid.has(row.post_id)) latestPostByid.set(row.post_id, row);
  }
  const posts = [...latestPostByid.values()]
    .map((row: any) => ({
      id: row.post_id,
      caption: row.caption ?? '',
      type: row.post_type ?? 'IMAGE',
      thumbnail: row.thumbnail ?? null,
      timestamp: row.published_at ?? row.snapshot_date,
      permalink: row.permalink ?? null,
      likes: row.likes ?? null,
      comments: row.comments ?? null,
      reach: row.reach ?? null,
      saved: row.saves ?? null,
      shares: row.shares ?? null,
      views: row.views ?? null,
      totalInteractions: row.total_interactions ?? null,
      follows: row.follows ?? null,
      profileVisits: row.profile_visits ?? null,
      videoDuration: row.video_duration_sec ?? null,
      avgWatchTimeMs: row.avg_watch_time_ms ?? null,
      totalWatchTimeMs: row.total_watch_time_ms ?? null,
      skipRate: row.skip_rate ?? null,
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json({
    username: accountData.username,
    name: accountData.name,
    profilePicture: accountData.profile_picture_url || null,
    followers: accountData.followers_count || 0,
    following: accountData.follows_count || 0,
    mediaCount: accountData.media_count || 0,
    biography: accountData.biography || '',
    reach30d,
    reach28dDedupFollowers,
    reach28dDedupNonFollowers,
    accountsEngaged30d,
    totalInteractions30d,
    followsUnfollows30d,
    profileLinksTaps30d,
    websiteClicks30d,
    profileViews30d: 0,
    views30d,
    viewsFollowerBreakdown,
    chartData,
    posts,
    demographics,
    onlineFollowers,
  });
}
