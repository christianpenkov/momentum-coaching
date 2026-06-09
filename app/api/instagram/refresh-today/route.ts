import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { getIgCreds, fetchIgDayMetrics, upsertIgSnapshot, pollIgLeads } from '@/lib/ig-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/instagram/refresh-today
// Body: { profile_id: string }
// Appelé depuis le bouton Refresh du frontend (coach).
// Cooldown géré côté client (localStorage). Côté serveur : aucune restriction de fréquence.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const profileId: string = body.profile_id || user.id;

  // Vérifier que le coach a accès à ce profil
  if (profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const today = new Date().toISOString().split('T')[0];
  const errors: string[] = [];

  let leadsFound = 0;
  try {
    const creds = await getIgCreds(profileId);
    if (!creds) {
      errors.push('no_token');
    } else {
      // Snapshot métriques J-0
      const metrics = await fetchIgDayMetrics(creds, today);
      const err = await upsertIgSnapshot(profileId, { date: today, ...metrics }, 'refresh_partial');
      if (err) errors.push(`upsert: ${err}`);

      // Poll leads (DMs + commentaires depuis 24h)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const pollResult = await pollIgLeads(profileId, creds.token, creds.igAccountId, since);
      leadsFound = pollResult.leadsFound;
      if (pollResult.error) errors.push(`poll: ${pollResult.error}`);
    }
  } catch (e: any) {
    errors.push(`fetch_error: ${e?.message || 'unknown'}`);
  }

  return NextResponse.json({ ok: errors.length === 0, date: today, leadsFound, errors });
}
