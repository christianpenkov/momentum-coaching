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

  await serviceSupabase.from('integrations').update({
    access_token: data.access_token,
    expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  }).eq('profile_id', profileId).eq('provider', 'youtube');

  return data.access_token;
}

function getToday() { return new Date().toISOString().split('T')[0]; }
function getStartDate(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const accessToken = await getFreshToken(user.id);
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const auth = { Authorization: `Bearer ${accessToken}` };
  const safeJson = async (res: Response) => {
    const text = await res.text();
    try { return { status: res.status, ok: res.ok, data: JSON.parse(text) }; }
    catch { return { status: res.status, ok: res.ok, data: text }; }
  };

  // 1. Analytics API — impressions + CTR (disponible si scopes suffisants)
  const [analyticsImpressionsRes, analyticsVideoImpressionsRes, reportingJobsRes] = await Promise.all([
    // Canal entier — 30j
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${getStartDate(30)}&endDate=${getToday()}&metrics=views,impressions,impressionClickThroughRate&dimensions=day&sort=day`,
      { headers: auth }
    ),
    // Par vidéo — all-time
    fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2020-01-01&endDate=${getToday()}&metrics=views,impressions,impressionClickThroughRate&dimensions=video&sort=-impressions&maxResults=20`,
      { headers: auth }
    ),
    // Reporting API — liste des jobs existants
    fetch('https://youtubereporting.googleapis.com/v1/jobs', { headers: auth }),
  ]);

  const [analyticsImpressions, analyticsVideoImpressions, reportingJobs] = await Promise.all([
    safeJson(analyticsImpressionsRes),
    safeJson(analyticsVideoImpressionsRes),
    safeJson(reportingJobsRes),
  ]);

  // 2. Reporting API — liste des report types disponibles (pour savoir si channel_reach_basic_a1 est accessible)
  const reportTypesRes = await fetch('https://youtubereporting.googleapis.com/v1/reportTypes', { headers: auth });
  const reportTypes = await safeJson(reportTypesRes);

  // 3. Si des jobs existent, on récupère les rapports du premier job channel_reach
  let reachJobReports: any = null;
  const jobs: any[] = reportingJobs.data?.jobs || [];
  const reachJob = jobs.find((j: any) => j.reportTypeId?.includes('channel_reach'));
  if (reachJob) {
    const reportsRes = await fetch(
      `https://youtubereporting.googleapis.com/v1/jobs/${reachJob.id}/reports`,
      { headers: auth }
    );
    reachJobReports = await safeJson(reportsRes);
  }

  // 4. Télécharge le CSV du rapport reach le plus récent et parse les premières lignes
  let csvPreview: any = null;
  const reports: any[] = reachJobReports?.data?.reports || [];
  const latestReport = reports[0]; // trié par date desc par l'API
  if (latestReport?.downloadUrl) {
    const csvRes = await fetch(latestReport.downloadUrl, { headers: auth });
    if (csvRes.ok) {
      const text = await csvRes.text();
      const lines = text.split('\n').filter(Boolean);
      const headers = lines[0]?.split(',') || [];
      const rows = lines.slice(1, 6).map(l => {
        const vals = l.split(',');
        return Object.fromEntries(headers.map((h, i) => [h.trim(), vals[i]?.trim()]));
      });
      csvPreview = {
        report_id: latestReport.id,
        start_time: latestReport.startTime,
        end_time: latestReport.endTime,
        total_lines: lines.length - 1, // sans header
        headers,
        sample_rows: rows,
      };
    } else {
      csvPreview = { error: `HTTP ${csvRes.status}`, report_id: latestReport.id };
    }
  }

  return NextResponse.json({
    // Analytics API — impressions + CTR canal entier (30j)
    analytics_channel_ctr: {
      status: analyticsImpressions.status,
      ok: analyticsImpressions.ok,
      // colonnes : day, views, impressions, impressionClickThroughRate
      columnHeaders: analyticsImpressions.data?.columnHeaders || null,
      rowCount: analyticsImpressions.data?.rows?.length || 0,
      sample_rows: analyticsImpressions.data?.rows?.slice(0, 5) || null,
      error: analyticsImpressions.data?.error || null,
    },
    // Analytics API — impressions + CTR par vidéo
    analytics_video_ctr: {
      status: analyticsVideoImpressions.status,
      ok: analyticsVideoImpressions.ok,
      columnHeaders: analyticsVideoImpressions.data?.columnHeaders || null,
      rowCount: analyticsVideoImpressions.data?.rows?.length || 0,
      sample_rows: analyticsVideoImpressions.data?.rows?.slice(0, 5) || null,
      error: analyticsVideoImpressions.data?.error || null,
    },
    // Reporting API — jobs existants
    reporting_jobs: {
      status: reportingJobs.status,
      ok: reportingJobs.ok,
      jobs: jobs.map((j: any) => ({ id: j.id, reportTypeId: j.reportTypeId, name: j.name, createTime: j.createTime })),
      reach_job_found: !!reachJob,
      error: reportingJobs.data?.error || null,
    },
    // Reporting API — types disponibles (filtrés sur "reach")
    reporting_reach_types: {
      status: reportTypes.status,
      ok: reportTypes.ok,
      reach_types: (reportTypes.data?.reportTypes || []).filter((t: any) => t.id?.includes('reach')),
      error: reportTypes.data?.error || null,
    },
    // Rapports du job reach (si existant)
    reach_job_reports: reachJob ? {
      job_id: reachJob.id,
      status: reachJobReports?.status,
      reports: reachJobReports?.data?.reports?.slice(0, 3) || null,
      error: reachJobReports?.data?.error || null,
    } : null,
    // Contenu du CSV le plus récent
    csv_preview: csvPreview,
  });
}
