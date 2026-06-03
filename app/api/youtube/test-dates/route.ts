import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/youtube/test-dates
// Vérifie jusqu'à quelle date l'API YouTube Analytics retourne des données
// Pour expliquer pourquoi les graphiques s'arrêtent avant aujourd'hui
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', user.id)
    .eq('provider', 'youtube')
    .single();

  if (!integ?.access_token) return NextResponse.json({ error: 'YouTube non connecté' }, { status: 404 });

  const token = integ.access_token;
  const today = new Date().toISOString().split('T')[0];
  const start30d = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const safeJson = async (r: Response) => { try { return await r.json(); } catch { return { error: 'parse_failed' }; } };

  // Test 1 : chartData vues jour par jour — on regarde jusqu'où ça va
  const viewsRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${start30d}&endDate=${today}&metrics=views&dimensions=day&sort=day`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(safeJson);

  const rows: [string, number][] = viewsRes?.rows || [];
  const lastDate = rows.length > 0 ? rows[rows.length - 1][0] : null;
  const firstDate = rows.length > 0 ? rows[0][0] : null;
  const todayHasData = rows.some(([d]) => d === today);
  const yesterdayHasData = rows.some(([d]) => d === new Date(Date.now() - 86400000).toISOString().split('T')[0]);

  // Test 2 : subs par jour — même vérification
  const subsRes = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${start30d}&endDate=${today}&metrics=subscribersGained,subscribersLost&dimensions=day&sort=day`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(safeJson);

  const subsRows: any[] = subsRes?.rows || [];
  const subsLastDate = subsRows.length > 0 ? subsRows[subsRows.length - 1][0] : null;

  return NextResponse.json({
    today,
    start30d,
    views: {
      firstDate,
      lastDate,
      totalRows: rows.length,
      todayHasData,
      yesterdayHasData,
      gapDays: lastDate ? Math.round((new Date(today).getTime() - new Date(lastDate).getTime()) / 86400000) : null,
      last5Rows: rows.slice(-5),
    },
    subs: {
      lastDate: subsLastDate,
      totalRows: subsRows.length,
      last3Rows: subsRows.slice(-3),
    },
    rawError: viewsRes?.error ?? null,
  });
}
