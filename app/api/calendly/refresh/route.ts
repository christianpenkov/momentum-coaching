import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { syncCalendlyEleve } from '@/lib/calendly-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/calendly/refresh
// Body: { profile_id?: string, connected_at?: string }
// Deux usages :
//   1. Bouton Refresh du coach → profile_id = l'élève ciblé, auth cookie présent
//   2. Fire-and-forget au callback OAuth → authorization: Bearer CRON_SECRET
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const authHeader = request.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  let profileId: string;
  let connectedAt: string;

  if (isCron) {
    // Appelé depuis le callback OAuth ou le cron — profile_id fourni dans le body
    if (!body.profile_id) return NextResponse.json({ error: 'profile_id requis' }, { status: 400 });
    profileId = body.profile_id;
    connectedAt = body.connected_at || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    // Appelé depuis le frontend (bouton Refresh du coach)
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const targetProfileId: string = body.profile_id || user.id;

    // Vérifier que le coach a accès à ce profil
    if (targetProfileId !== user.id) {
      const { data: clientRow } = await serviceSupabase
        .from('clients')
        .select('id')
        .eq('profile_id', targetProfileId)
        .eq('coach_id', user.id)
        .single();
      if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    profileId = targetProfileId;

    // Récupère connected_at depuis integrations pour respecter la date-limite
    const { data: integ } = await serviceSupabase
      .from('integrations')
      .select('connected_at')
      .eq('profile_id', profileId)
      .eq('provider', 'calendly')
      .single();

    connectedAt = integ?.connected_at || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const { synced, errors } = await syncCalendlyEleve(profileId, connectedAt);

  return NextResponse.json({ ok: errors.length === 0, synced, errors });
}
