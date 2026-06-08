import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PATCH /api/calls/[id]/rapport
// Body: { no_show?: boolean, deal_closed?: boolean, revenue?: number }
// Seul l'élève hôte du call (coach_id = user.id pour les calls Calendly) peut remplir.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  // Vérifie que ce call appartient à l'élève (coach_id = user.id pour Calendly)
  const { data: call } = await serviceSupabase
    .from('calls')
    .select('id, coach_id, client_id, calendly_event_uuid')
    .eq('id', id)
    .single();

  if (!call) return NextResponse.json({ error: 'Call introuvable' }, { status: 404 });

  const isOwner = call.coach_id === user.id || call.client_id === user.id;
  if (!isOwner) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (typeof body.no_show === 'boolean') patch.no_show = body.no_show;
  if (typeof body.deal_closed === 'boolean') patch.deal_closed = body.deal_closed;
  if (typeof body.revenue === 'number') patch.revenue = body.revenue;
  if (typeof body.outcome === 'string') patch.outcome = body.outcome;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucune donnée à mettre à jour' }, { status: 400 });
  }

  const { error } = await serviceSupabase
    .from('calls')
    .update(patch)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
