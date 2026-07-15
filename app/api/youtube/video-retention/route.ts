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

  // "Ont continué de regarder" (bandeau Studio) = relativeRetentionPerformance, la
  // performance de rétention de cette vidéo comparée aux autres vidéos YouTube de
  // durée similaire. Confirmé disponible via l'API uniquement avec la même dimension
  // elapsedVideoTimeRatio (pas de valeur agrégée directe) — donc récupéré comme 2e
  // courbe fusionnée avec audienceWatchRatio point par point (même dimension), pas
  // comme un rapport séparé.
  const relRetRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2020-01-01&endDate=${getToday()}&metrics=relativeRetentionPerformance&dimensions=elapsedVideoTimeRatio&filters=video==${videoId}`,
    { headers: authHeader }
  );
  const relRetData = await relRetRes.json();
  const relRetByRatio = new Map<number, number>((relRetData?.rows || []).map((r: any) => [r[0], r[1]]));

  const retentionCurve = (retentionData?.rows || []).map((r: any) => ({
    ratio: r[0],
    watchRatio: r[1],
    relativeRetention: relRetByRatio.get(r[0]) ?? null,
  }));

  // "Durée moyenne d'une vue" + "% moyen de vidéo regardé" (bandeau Studio) — pas de
  // dimension ici (une seule ligne agrégée sur toute la période filtrée par cette
  // vidéo), contrairement aux courbes ci-dessus qui ont besoin de elapsedVideoTimeRatio.
  const summaryRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate}&endDate=${getToday()}&metrics=averageViewDuration,averageViewPercentage&filters=video==${videoId}`,
    { headers: authHeader }
  );
  const summaryData = await summaryRes.json();
  const summaryRow = summaryData?.rows?.[0] || null;
  const avgViewDurationSec: number | null = summaryRow ? summaryRow[0] : null;
  const avgViewPercentage: number | null = summaryRow ? summaryRow[1] : null;
  // Moyenne de la courbe relativeRetentionPerformance — reproduit le chiffre unique
  // du bandeau Studio ("Ont continué de regarder") à partir des 100 points récupérés.
  const relRetValues = retentionCurve.map((p: any) => p.relativeRetention).filter((v: any): v is number => v !== null);
  const continuedWatchingPct = relRetValues.length > 0
    ? Math.round((relRetValues.reduce((s: number, v: number) => s + v, 0) / relRetValues.length) * 1000) / 10
    : null;

  return NextResponse.json({
    videoId, retentionCurve,
    avgViewDurationSec, avgViewPercentage, continuedWatchingPct,
    debug: { startDate, endDate: getToday(), rowCount: retentionCurve.length, apiError: retentionData.error || relRetData.error || summaryData.error || null },
  });
}
