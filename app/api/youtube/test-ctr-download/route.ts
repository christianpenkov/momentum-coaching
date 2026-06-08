import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { gunzipSync } from 'zlib';

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

  await serviceSupabase.from('integrations').update({
    access_token: data.access_token,
    expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  }).eq('profile_id', profileId).eq('provider', 'youtube');

  return data.access_token;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const accessToken = await getFreshToken(user.id);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const auth = { Authorization: `Bearer ${accessToken}` };

  // 1. Récupérer le job channel_reach_basic_a1
  const jobsRes = await fetch('https://youtubereporting.googleapis.com/v1/jobs', { headers: auth });
  const jobsData = await jobsRes.json();
  const jobs: any[] = jobsData.jobs || [];
  const reachJob = jobs.find((j: any) => j.reportTypeId === 'channel_reach_basic_a1');

  if (!reachJob) {
    return NextResponse.json({ error: 'Aucun job channel_reach_basic_a1 trouvé' }, { status: 404 });
  }

  // 2. Lister les rapports disponibles
  const reportsRes = await fetch(
    `https://youtubereporting.googleapis.com/v1/jobs/${reachJob.id}/reports`,
    { headers: auth }
  );
  const reportsData = await reportsRes.json();
  const reports: any[] = reportsData.reports || [];

  if (reports.length === 0) {
    return NextResponse.json({ error: 'Aucun rapport disponible', job: reachJob }, { status: 404 });
  }

  // 3. Télécharger le rapport le plus récent
  const latestReport = reports.sort((a: any, b: any) =>
    new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
  )[0];

  const downloadRes = await fetch(latestReport.downloadUrl, { headers: auth });

  if (!downloadRes.ok) {
    return NextResponse.json({
      error: `Erreur téléchargement: ${downloadRes.status}`,
      report: latestReport,
    }, { status: 500 });
  }

  // 4. Décompresser (gzip) et parser le CSV
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  let csvText: string;
  try {
    csvText = gunzipSync(buffer).toString('utf-8');
  } catch {
    // Parfois le fichier n'est pas gzippé
    csvText = buffer.toString('utf-8');
  }

  const rows = parseCSV(csvText);

  // 5. Agréger par video_id — CTR pondéré : totalClics / totalImpressions
  // colonnes réelles : video_thumbnail_impressions, video_thumbnail_impressions_ctr
  const byVideo: Record<string, { impressions: number; clicks: number }> = {};
  let channelImpressions = 0;
  let channelClicks = 0;

  for (const row of rows) {
    const videoId = row['video_id'] || '';
    const impressions = parseFloat(row['video_thumbnail_impressions'] || '0') || 0;
    const ctr = parseFloat(row['video_thumbnail_impressions_ctr'] || '0') || 0;
    const clicks = impressions * ctr;

    channelImpressions += impressions;
    channelClicks += clicks;

    if (videoId) {
      if (!byVideo[videoId]) byVideo[videoId] = { impressions: 0, clicks: 0 };
      byVideo[videoId].impressions += impressions;
      byVideo[videoId].clicks += clicks;
    }
  }

  const videoStats = Object.entries(byVideo)
    .map(([videoId, s]) => ({
      videoId,
      impressions: Math.round(s.impressions),
      // CTR pondéré correct (pas une moyenne)
      ctrPct: s.impressions > 0 ? parseFloat((s.clicks / s.impressions * 100).toFixed(2)) : null,
    }))
    .sort((a, b) => b.impressions - a.impressions);

  return NextResponse.json({
    job: { id: reachJob.id, reportTypeId: reachJob.reportTypeId },
    report: {
      id: latestReport.id,
      startTime: latestReport.startTime,
      endTime: latestReport.endTime,
    },
    csv_columns: rows.length > 0 ? Object.keys(rows[0]) : [],
    channel_totals: {
      impressions: Math.round(channelImpressions),
      ctrPct: channelImpressions > 0
        ? parseFloat((channelClicks / channelImpressions * 100).toFixed(2))
        : null,
    },
    by_video: videoStats,
  });
}
