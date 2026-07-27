import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getYtToken } from '@/lib/yt-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('videoId');
  if (!videoId) return NextResponse.json({ error: 'videoId requis' }, { status: 400 });

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const accessToken = await getYtToken(user.id);
  if (!accessToken) return NextResponse.json({ error: 'no_token — pas de token YouTube en base' }, { status: 404 });

  const today = new Date().toISOString().split('T')[0];

  // Teste plusieurs plages de dates pour voir laquelle retourne des données
  const ranges = [
    { label: '30j', startDate: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] },
    { label: '90j', startDate: new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0] },
    { label: '365j', startDate: new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0] },
    { label: '2020-01-01', startDate: '2020-01-01' },
  ];

  const results: Record<string, any> = {};

  for (const range of ranges) {
    const url = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${range.startDate}&endDate=${today}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${videoId}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const d = await r.json();
    results[range.label] = {
      url,
      rowCount: d.rows?.length ?? 0,
      firstRows: d.rows?.slice(0, 3) ?? [],
      error: d.error ?? null,
    };
  }

  return NextResponse.json({ videoId, today, results });
}
