import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getYtToken } from '@/lib/yt-fetch';
import { gunzipSync } from 'zlib';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

  const accessToken = await getYtToken(user.id);
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

  // 3. Télécharger TOUS les rapports disponibles et agréger
  const sortedReports = reports.sort((a: any, b: any) =>
    new Date(a.endTime).getTime() - new Date(b.endTime).getTime()
  );

  const allRows: Record<string, string>[] = [];
  const reportsMeta: { id: string; startTime: string; endTime: string; rows: number }[] = [];

  await Promise.all(sortedReports.map(async (report: any) => {
    const downloadRes = await fetch(report.downloadUrl, { headers: auth });
    if (!downloadRes.ok) return;
    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    let csvText: string;
    try { csvText = gunzipSync(buffer).toString('utf-8'); }
    catch { csvText = buffer.toString('utf-8'); }
    const rows = parseCSV(csvText);
    allRows.push(...rows);
    reportsMeta.push({ id: report.id, startTime: report.startTime, endTime: report.endTime, rows: rows.length });
  }));

  const rows = allRows;

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
    reports_downloaded: reportsMeta,
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
