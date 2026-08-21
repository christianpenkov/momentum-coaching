import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getYtToken } from '@/lib/yt-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getStartDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('videoId');
  const publishedAt = searchParams.get('publishedAt');
  if (!videoId) return NextResponse.json({ error: 'videoId requis' }, { status: 400 });

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

  const accessToken = await getYtToken(targetProfileId);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // Depuis la date de publication de la vidéo (ou 365j max si trop ancienne)
  const startDate = publishedAt
    ? publishedAt.split('T')[0]
    : getStartDate(365);

  // Courbe de rétention par vidéo (audienceWatchRatio par elapsedVideoTimeRatio)
  // sort=elapsedVideoTimeRatio demandé explicitement : l'API ne garantit pas un
  // ordre croissant par défaut. Le .sort() ci-dessous est une deuxième garantie
  // (défense en profondeur) indépendante de ce paramètre.
  const retentionRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${getToday()}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${videoId}&sort=elapsedVideoTimeRatio`,
    { headers: authHeader }
  );
  const retentionData = await retentionRes.json();

  const retentionCurve = (retentionData?.rows || [])
    .map((r: any) => ({ ratio: r[0], watchRatio: r[1] }))
    .sort((a: { ratio: number }, b: { ratio: number }) => a.ratio - b.ratio);

  // watch time / rétention doivent être "depuis publication" (lifetime), pas un
  // mélange avec les valeurs 30j du cron poll-leads — demande explicite de Chris.
  // likes/comments NE viennent PAS de ce rapport Analytics : ce rapport agrégé a une
  // latence de traitement côté Google (24-48h+), il divergeait donc du compteur
  // temps réel affiché avant chargement (Data API v3, voir plus bas), causant un
  // "saut" visuel (ex: 4→3) au moment où ce fetch remplaçait la valeur affichée.
  // shares n'a pas d'équivalent dans la Data API v3, reste donc sur Analytics.
  const summaryRes = await fetch(
    // views + engagedViews ajoutes a la requete EXISTANTE (pas d'appel supplementaire).
    // engagedViews = spectateurs qui ont vraiment regarde, par opposition a une vue
    // comptee des les premieres secondes. Metrique Shorts introduite par YouTube en
    // 2025, verifiee disponible sur cette chaine le 2026-08-20 (537 vues engagees sur
    // 2 012 vues pour awrGQJIdthA).
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${getToday()}&metrics=averageViewDuration,averageViewPercentage,estimatedMinutesWatched,shares,views,engagedViews&filters=video==${videoId}`,
    { headers: authHeader }
  );
  const summaryData = await summaryRes.json();
  const summaryRow = summaryData?.rows?.[0] || null;
  const avgViewDurationSec: number | null = summaryRow ? summaryRow[0] : null;
  const avgViewPercentage: number | null = summaryRow ? summaryRow[1] : null;
  const watchTimeMin: number | null = summaryRow ? summaryRow[2] : null;
  const shares: number | null = summaryRow ? summaryRow[3] : null;
  const viewsPeriod: number | null = summaryRow ? summaryRow[4] : null;
  const engagedViews: number | null = summaryRow ? summaryRow[5] : null;

  // likes/comments : même source que l'affichage "avant chargement" (Data API v3,
  // statistics.likeCount/commentCount) — compteur public temps quasi-réel, stable et
  // identique avant/après chargement, plus de saut visuel.
  let likes: number | null = null;
  let comments: number | null = null;
  const statsRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}`,
    { headers: authHeader }
  );
  const statsData = await statsRes.json();
  const statsItem = statsData?.items?.[0];
  if (statsItem?.statistics) {
    likes = statsItem.statistics.likeCount !== undefined ? Number(statsItem.statistics.likeCount) : null;
    comments = statsItem.statistics.commentCount !== undefined ? Number(statsItem.statistics.commentCount) : null;
  }

  return NextResponse.json({
    videoId, retentionCurve,
    avgViewDurationSec, avgViewPercentage, watchTimeMin, likes, comments, shares,
    viewsPeriod, engagedViews,
    debug: {
      startDate, endDate: getToday(), rowCount: retentionCurve.length,
      apiError: retentionData.error || summaryData.error || statsData.error || null,
      summaryColumnHeaders: summaryData.columnHeaders,
      summaryRawRow: summaryRow,
    },
  });
}
