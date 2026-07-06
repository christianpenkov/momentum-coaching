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

  const [accountRes, mediaRes, insightsRes, engagedRes, demoRes, onlineFollowersRes, viewsBreakdownRes, reachDedupRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=username,name,profile_picture_url,followers_count,follows_count,media_count,biography&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/media?fields=id,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count,permalink,is_shared_to_feed,video_duration&limit=100&access_token=${token}`),
    // reach, follower_count, website_clicks fonctionnent en period=day
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach,follower_count,follows_and_unfollows,profile_links_taps,website_clicks&period=day&since=${since}&until=${until}&access_token=${token}`),
    // accounts_engaged + total_interactions nécessitent metric_type=total_value (period=day sans ça retourne data:[])
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=follower_demographics&period=lifetime&breakdown=age,gender,country,city&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=online_followers&period=lifetime&since=${ofSince}&until=${ofUntil}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=views&metric_type=total_value&breakdown=follow_type,media_product_type&period=day&since=${since}&until=${until}&access_token=${token}`),
    // Reach RÉELLEMENT dédupliqué sur la fenêtre (pas une somme de valeurs quotidiennes,
    // qui recompte un même abonné touché sur plusieurs jours) — confirmé en testant l'API
    // réelle : period=days_28 + metric_type=total_value renvoie un seul total agrégé par
    // Meta côté serveur. Fenêtre fixe 28j (pas de since/until arbitraire possible pour
    // reach en mode dédupliqué, contrairement à views).
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&period=days_28&metric_type=total_value&access_token=${token}`),
  ]);

  const [accountData, mediaData, insightsData, engagedData, demoData, onlineFollowersData, viewsBreakdownData, reachDedupData] = await Promise.all([
    safeJson(accountRes), safeJson(mediaRes), safeJson(insightsRes), safeJson(engagedRes), safeJson(demoRes), safeJson(onlineFollowersRes), safeJson(viewsBreakdownRes), safeJson(reachDedupRes),
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
  // Reach dédupliqué réel sur ~28j (total_value Meta, pas une somme de reach quotidien
  // qui recompte un même abonné touché plusieurs jours) — utilisé pour "Followers reach
  // rate" uniquement ; reach30d (somme quotidienne) reste utilisé pour le KPI "Reach ·
  // personnes" et le graphique jour par jour, qui ne sont pas concernés par ce biais.
  const reach28dDedup: number | null = (() => {
    for (const metric of reachDedupData?.data || []) {
      if (metric.name === 'reach' && typeof metric.total_value?.value === 'number') return metric.total_value.value;
    }
    return null;
  })();
  // accounts_engaged/total_interactions via total_value sont non fiables (> reach, inclut stories/DMs)
  // On calcule les vraies interactions depuis les posts individuels après leur fetch (voir plus bas)
  const accountsEngaged30d = 0; // remplacé par postInteractions30d calculé depuis les posts
  const totalInteractions30d = 0;
  // follows_and_unfollows peut être vide sur certains comptes — on fall back sur follower_count (delta quotidien)
  const followsUnfollows30d = sum(insightMap['follows_and_unfollows'] || []) || sum(insightMap['follower_count'] || []);
  const profileLinksTaps30d = sum(insightMap['profile_links_taps'] || []);
  const websiteClicks30d = sum(insightMap['website_clicks'] || []);
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

  // Chart reach + followers + vues + interactions par jour
  const reachValues = insightMap['reach'] || [];
  const followerDeltaValues = insightMap['follower_count'] || [];
  const viewsValues = insightMap['views'] || [];
  const engagedValues = insightMap['accounts_engaged'] || [];
  const interactionsValues = insightMap['total_interactions'] || [];
  const websiteClicksValues = insightMap['website_clicks'] || [];

  // Reconstruit la série "Abonnés" en nombre ABSOLU (pas en delta) : follower_count
  // (insights) n'est qu'un delta quotidien et sujet au même ~48h de délai Meta que
  // online_followers (aucun contournement n'existait ici) — confirmé en pratique :
  // Meta renvoie 0 pour les jours les plus récents même quand un vrai gain a eu lieu,
  // car la donnée n'est pas encore stabilisée côté Meta. accountData.followers_count
  // est le compte réel, temps réel, déjà fetché dans le même Promise.all — on part de
  // ce nombre pour aujourd'hui et on remonte en arrière en soustrayant les deltas
  // connus, MAIS seulement au-delà de la fenêtre de retard (J-3 et avant) : inclure les
  // deltas non stabilisés des 3 derniers jours dans la reconstruction cumulative
  // propagerait leur bruit (souvent 0 à tort) à TOUTE la série historique en amont.
  const UNSTABLE_DAYS = 3;
  const todayAbsoluteFollowers: number | null = typeof accountData.followers_count === 'number' ? accountData.followers_count : null;
  const followerAbsoluteValues: (number | null)[] = new Array(followerDeltaValues.length).fill(null);
  if (todayAbsoluteFollowers !== null && followerDeltaValues.length > 0) {
    const lastIdx = followerDeltaValues.length - 1;
    // Le point du jour est toujours fiable (compte réel, pas un delta Meta) — les
    // UNSTABLE_DAYS jours juste avant restent null : leur delta officiel n'est pas
    // encore stabilisé chez Meta, l'inclure fausserait la reconstruction cumulative.
    followerAbsoluteValues[lastIdx] = todayAbsoluteFollowers;
    const stableStartIdx = Math.max(0, lastIdx - UNSTABLE_DAYS);
    // La reconstruction en arrière ne démarre qu'à partir de la frontière stable, en
    // n'utilisant que des deltas eux-mêmes situés dans la zone stable (jamais un delta
    // de la fenêtre de retard) : on ignore simplement le sous-total des derniers jours
    // en partant du principe qu'ils s'annulent globalement à ~0 (approximation admise,
    // équivalente à afficher "pas encore de donnée fiable" pour cette portion).
    followerAbsoluteValues[stableStartIdx] = todayAbsoluteFollowers;
    for (let i = stableStartIdx - 1; i >= 0; i--) {
      followerAbsoluteValues[i] = followerAbsoluteValues[i + 1] !== null
        ? followerAbsoluteValues[i + 1]! - (followerDeltaValues[i + 1] ?? 0)
        : null;
    }
  }

  const today = new Date();

  // Breakdown reach follower/non-follower JOUR PAR JOUR — Meta ne renvoie un vrai
  // détail (pas un agrégat collapsé sur toute la fenêtre) que sur une requête à
  // fenêtre d'UN jour (confirmé en testant l'API réelle) — même contrainte que
  // lib/ig-fetch.ts (fetchIgDayMetrics), un appel par jour affiché, en parallèle.
  const reachBreakdownByDate = new Map<string, { follower: number; nonFollower: number }>();
  await Promise.all(
    reachValues.map(async (_val: number, i: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (reachValues.length - 1 - i));
      const dayStart = Math.floor(new Date(d.toISOString().split('T')[0] + 'T00:00:00Z').getTime() / 1000);
      const dayEnd = dayStart + 86400;
      try {
        const res = await fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&metric_type=total_value&breakdown=follow_type&period=day&since=${dayStart}&until=${dayEnd}&access_token=${token}`);
        const data = await safeJson(res);
        for (const metric of data?.data || []) {
          if (metric.name === 'reach' && metric.total_value?.breakdowns) {
            let follower = 0, nonFollower = 0, found = false;
            for (const bd of metric.total_value.breakdowns) {
              for (const r of bd.results || []) {
                const key = r.dimension_values?.[0];
                if (key === 'FOLLOWER') { follower += r.value || 0; found = true; }
                else if (key === 'NON_FOLLOWER') { nonFollower += r.value || 0; found = true; }
              }
            }
            if (found) reachBreakdownByDate.set(d.toISOString().split('T')[0], { follower, nonFollower });
          }
        }
      } catch { /* jour ignoré si l'appel échoue — pas bloquant pour le reste */ }
    })
  );

  const chartData = reachValues.map((val: number, i: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (reachValues.length - 1 - i));
    const dateStr = d.toISOString().split('T')[0];
    const bd = reachBreakdownByDate.get(dateStr);
    return {
      date: dateStr,
      reach: val,
      followerCount: followerAbsoluteValues[i] ?? null,
      views: viewsValues[i] ?? 0,
      accountsEngaged: engagedValues[i] ?? 0,
      totalInteractions: interactionsValues[i] ?? 0,
      websiteClicks: websiteClicksValues[i] ?? 0,
      reachFollower: bd?.follower ?? null,
      reachNonFollower: bd?.nonFollower ?? null,
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

  // Interactions réelles = somme des totalInteractions lifetime des posts publiés dans la période
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const postInteractions30d = mediaWithInsights
    .filter(p => new Date(p.timestamp) >= cutoff30d)
    .reduce((s, p) => s + (p.totalInteractions ?? 0), 0);

  return NextResponse.json({
    username: accountData.username,
    name: accountData.name,
    profilePicture: accountData.profile_picture_url || null,
    followers: accountData.followers_count || 0,
    following: accountData.follows_count || 0,
    mediaCount: accountData.media_count || 0,
    biography: accountData.biography || '',
    reach30d,
    reach28dDedup,
    accountsEngaged30d: postInteractions30d,
    totalInteractions30d: postInteractions30d,
    followsUnfollows30d,
    profileLinksTaps30d,
    websiteClicks30d,
    profileViews30d: 0,
    views30d,
    viewsFollowerBreakdown,
    chartData,
    posts: mediaWithInsights,
    demographics,
    onlineFollowers,
  });
}
