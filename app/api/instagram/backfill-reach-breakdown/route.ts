import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { getIgCreds, fetchIgDayMetrics, upsertIgSnapshot } from '@/lib/ig-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/instagram/backfill-reach-breakdown
// Body: { profile_id: string }
// Rattrapage manuel, à déclencher une seule fois : remplit rétroactivement les 30
// derniers jours de analytics_daily_snapshots avec le breakdown reach follower/
// non-follower (ig_reach_follower/ig_reach_non_follower), absent avant la mise en
// place de la collecte quotidienne. Un appel Meta par jour (fenêtre 1 jour requise
// pour obtenir un vrai détail, pas un agrégat collapsé), en parallèle via
// fetchIgDayMetrics (qui refetch aussi les autres métriques du jour au passage —
// sans impact, upsert écrase avec les mêmes valeurs si déjà présentes).
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const profileId: string = body.profile_id || user.id;

  if (profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const creds = await getIgCreds(profileId);
  if (!creds) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const days: string[] = [];
  for (let i = 1; i <= 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const errors: string[] = [];
  let filled = 0;

  await Promise.all(days.map(async (date) => {
    try {
      const metrics = await fetchIgDayMetrics(creds, date);
      const err = await upsertIgSnapshot(profileId, { date, ...metrics }, 'backfill');
      if (err) errors.push(`${date}: ${err}`);
      else filled++;
    } catch (e: any) {
      errors.push(`${date}: ${e?.message || 'unknown'}`);
    }
  }));

  return NextResponse.json({ ok: errors.length === 0, filled, total: days.length, errors });
}
