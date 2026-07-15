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

  // Mêmes 3 chiffres que YouTube Studio ("Ont continué de regarder", "Durée moyenne
  // d'une vue", "% moyen de vidéo regardé") — pas de dimension ici (une seule ligne
  // agrégée sur toute la période filtrée par cette vidéo), contrairement à la courbe
  // de rétention ci-dessus qui a besoin de elapsedVideoTimeRatio comme dimension.
  const summaryRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${getToday()}&metrics=averageViewDuration,averageViewPercentage&filters=video==${videoId}`,
    { headers: authHeader }
  );
  const summaryData = await summaryRes.json();
  const summaryRow = summaryData?.rows?.[0] || null;
  const avgViewDurationSec: number | null = summaryRow ? summaryRow[0] : null;
  const avgViewPercentage: number | null = summaryRow ? summaryRow[1] : null;
  // "Ont continué de regarder" (relativeRetentionPerformance) n'a pas d'équivalent
  // direct côté API Reports — c'est calculé par YouTube Studio en comparant la courbe
  // de cette vidéo à des vidéos similaires (pas exposé). Ce qu'on peut donner de plus
  // proche : le point de la courbe de rétention à ratio proche de 1 (fin de vidéo).
  const continuedWatchingPct = retentionCurve.length > 0
    ? Math.round(retentionCurve[retentionCurve.length - 1].watchRatio * 1000) / 10
    : null;

  return NextResponse.json({
    videoId, retentionCurve,
    avgViewDurationSec, avgViewPercentage, continuedWatchingPct,
    debug: { startDate, endDate: getToday(), rowCount: retentionCurve.length, apiError: retentionData.error || summaryData.error || null },
  });
}
