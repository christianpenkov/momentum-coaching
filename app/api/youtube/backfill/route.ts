import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getYtToken, fetchYtDayMetrics, upsertYtSnapshot } from '@/lib/yt-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/youtube/backfill
// Body: { profile_id: string }
// Appelé en fire-and-forget depuis le callback OAuth YouTube.
// Guard atomique : une seule exécution par profil (race condition safe).
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const profileId: string | undefined = body.profile_id;
  if (!profileId) return NextResponse.json({ error: 'profile_id requis' }, { status: 400 });

  // Guard atomique
  const { data: claimed } = await serviceSupabase
    .from('integrations')
    .update({ backfill_started_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .eq('provider', 'youtube')
    .eq('backfill_done', false)
    .is('backfill_started_at', null)
    .select('id')
    .single();

  if (!claimed) {
    return NextResponse.json({ skipped: true, reason: 'already_started_or_done' });
  }

  const errors: string[] = [];

  try {
    const accessToken = await getYtToken(profileId);
    if (!accessToken) {
      errors.push('no_token');
    } else {
      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 30);
      const start = startDate.toISOString().split('T')[0];
      // J-2 comme endDate car J-1 et J-0 ne sont pas encore finalisés côté Google
      const endDay = new Date(today);
      endDay.setDate(endDay.getDate() - 2);
      const end = endDay.toISOString().split('T')[0];

      const rows = await fetchYtDayMetrics(accessToken, start, end);

      for (const row of rows) {
        const err = await upsertYtSnapshot(profileId, row, 'backfill');
        if (err) errors.push(`upsert_${row.date}: ${err}`);
      }
    }
  } catch (e: any) {
    errors.push(`backfill_error: ${e?.message || 'unknown'}`);
  }

  await serviceSupabase.from('integrations').update({
    backfill_done: true,
    last_snapshot_status: errors.length === 0 ? 'ok' : 'partial',
    last_snapshot_error: errors.length > 0 ? errors.join(', ') : null,
  }).eq('profile_id', profileId).eq('provider', 'youtube');

  return NextResponse.json({ ok: true, errors });
}
