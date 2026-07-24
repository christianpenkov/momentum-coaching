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

  const accessToken = await getFreshToken(targetProfileId);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // Depuis la date de publication de la vidéo (ou 365j max si trop ancienne)
  const startDate = publishedAt
    ? publishedAt.split('T')[0]
    : getStartDate(365);

  // Courbe de rétention par vidéo (audienceWatchRatio par elapsedVideoTimeRatio)
  const retentionRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${getToday()}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${videoId}`,
    { headers: authHeader }
  );
  const retentionData = await retentionRes.json();

  const retentionCurve = (retentionData?.rows || []).map((r: any) => ({
    ratio: r[0],
    watchRatio: r[1],
  }));

  // watch time / rétention doivent être "depuis publication" (lifetime), pas un
  // mélange avec les valeurs 30j du cron poll-leads — demande explicite de Chris.
  // likes/comments NE viennent PAS de ce rapport Analytics : ce rapport agrégé a une
  // latence de traitement côté Google (24-48h+), il divergeait donc du compteur
  // temps réel affiché avant chargement (Data API v3, voir plus bas), causant un
  // "saut" visuel (ex: 4→3) au moment où ce fetch remplaçait la valeur affichée.
  // shares n'a pas d'équivalent dans la Data API v3, reste donc sur Analytics.
  const summaryRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${getToday()}&metrics=averageViewDuration,averageViewPercentage,estimatedMinutesWatched,shares&filters=video==${videoId}`,
    { headers: authHeader }
  );
  const summaryData = await summaryRes.json();
  const summaryRow = summaryData?.rows?.[0] || null;
  const avgViewDurationSec: number | null = summaryRow ? summaryRow[0] : null;
  const avgViewPercentage: number | null = summaryRow ? summaryRow[1] : null;
  const watchTimeMin: number | null = summaryRow ? summaryRow[2] : null;
  const shares: number | null = summaryRow ? summaryRow[3] : null;

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
    debug: {
      startDate, endDate: getToday(), rowCount: retentionCurve.length,
      apiError: retentionData.error || summaryData.error || statsData.error || null,
      summaryColumnHeaders: summaryData.columnHeaders,
      summaryRawRow: summaryRow,
    },
  });
}
