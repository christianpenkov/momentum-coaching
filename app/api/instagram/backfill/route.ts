import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getIgCreds, fetchIgBackfill30d, upsertIgSnapshot } from '@/lib/ig-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/instagram/backfill
// Body: { profile_id: string }
// Appelé en fire-and-forget depuis le callback OAuth Instagram.
// Guard atomique : une seule exécution par profil (race condition safe).
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const profileId: string | undefined = body.profile_id;
  if (!profileId) return NextResponse.json({ error: 'profile_id requis' }, { status: 400 });

  // Guard atomique : marque backfill_started_at seulement si null et backfill_done=false
  const { data: claimed } = await serviceSupabase
    .from('integrations')
    .update({ backfill_started_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .eq('backfill_done', false)
    .is('backfill_started_at', null)
    .select('id')
    .single();

  if (!claimed) {
    return NextResponse.json({ skipped: true, reason: 'already_started_or_done' });
  }

  const errors: string[] = [];

  try {
    const creds = await getIgCreds(profileId);
    if (!creds) {
      errors.push('no_token');
    } else {
      const snapshots = await fetchIgBackfill30d(creds);

      for (const snap of snapshots) {
        const err = await upsertIgSnapshot(profileId, snap, 'backfill');
        if (err) errors.push(`upsert_${snap.date}: ${err}`);
      }
    }
  } catch (e: any) {
    errors.push(`backfill_error: ${e?.message || 'unknown'}`);
  }

  // Marque backfill_done=true même en cas d'erreur partielle pour ne pas retenté indéfiniment.
  // last_snapshot_error stocke les erreurs éventuelles.
  await serviceSupabase.from('integrations').update({
    backfill_done: true,
    last_snapshot_status: errors.length === 0 ? 'ok' : 'partial',
    last_snapshot_error: errors.length > 0 ? errors.join(', ') : null,
  }).eq('profile_id', profileId).eq('provider', 'instagram');

  return NextResponse.json({ ok: true, errors });
}
