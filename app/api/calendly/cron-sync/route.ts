import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncCalendlyEleve } from '@/lib/calendly-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/calendly/cron-sync
// Cron Vercel 6h — sync les events Calendly de tous les élèves connectés.
// Ne remonte que les events depuis connected_at (évite les anciens calls pré-Momentum).
// Le Calendly du coach (ses propres leads) est traité séparément — pas encore implémenté.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Récupère uniquement les élèves (role = 'client') avec Calendly connecté
  const { data: integrations } = await serviceSupabase
    .from('integrations')
    .select('profile_id, connected_at, profiles!inner(role)')
    .eq('provider', 'calendly')
    .eq('profiles.role', 'client');

  if (!integrations?.length) {
    return NextResponse.json({ ok: true, synced: 0, profiles: 0 });
  }

  const results = await Promise.all(
    integrations.map(integ => {
      const connectedAt = integ.connected_at || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      return syncCalendlyEleve(integ.profile_id, connectedAt)
        .then(r => ({ profile_id: integ.profile_id, ...r }))
        .catch(e => ({ profile_id: integ.profile_id, synced: 0, errors: [e?.message || 'unknown'] }));
    })
  );

  const totalSynced = results.reduce((acc, r) => acc + r.synced, 0);
  const allErrors: Record<string, string[]> = {};
  for (const r of results) {
    if (r.errors.length) allErrors[r.profile_id] = r.errors;
  }

  return NextResponse.json({
    ok: true,
    synced: totalSynced,
    profiles: integrations.length,
    errors: allErrors,
  });
}

export const POST = GET;
