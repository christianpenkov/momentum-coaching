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

  let totalSynced = 0;
  const allErrors: Record<string, string[]> = {};

  for (const integ of integrations) {
    const connectedAt = integ.connected_at || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { synced, errors } = await syncCalendlyEleve(integ.profile_id, connectedAt);
    totalSynced += synced;
    if (errors.length) allErrors[integ.profile_id] = errors;
  }

  return NextResponse.json({
    ok: true,
    synced: totalSynced,
    profiles: integrations.length,
    errors: allErrors,
  });
}

export const POST = GET;
