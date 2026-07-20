import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PATCH /api/session-reports/by-call/[callId]/student-notes
// Body: { student_notes?: string, dismissed?: boolean } — au moins un des deux requis.
// Notes personnelles de l'élève sur un call de coaching (Google Meet), indépendantes
// du rapport du coach : la ligne session_reports est créée dès que le premier des deux
// (coach ou élève) interagit avec le call, peu importe lequel (upsert symétrique à
// /api/calls/[id]/session-rapport, voir A3/A4 du plan).
// dismissed=true (sans student_notes) marque explicitement "rien à ajouter" ; écrire du
// texte non vide annule cet état (l'élève a changé d'avis et veut finalement noter quelque chose).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const { callId } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: call } = await serviceSupabase
    .from('calls')
    .select('id, coach_id, client_id, call_type, calendly_event_uuid')
    .eq('id', callId)
    .single();

  if (!call) return NextResponse.json({ error: 'Call introuvable' }, { status: 404 });
  if (call.call_type !== 'google' || call.calendly_event_uuid !== null) {
    return NextResponse.json({ error: 'Ce call ne fait pas partie du flux coach-élève Google Meet' }, { status: 400 });
  }

  const { data: clientRow } = await serviceSupabase
    .from('clients')
    .select('id, profile_id')
    .eq('id', call.client_id)
    .single();

  if (!clientRow || clientRow.profile_id !== user.id) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const hasNotes = typeof body.student_notes === 'string';
  const hasDismissed = typeof body.dismissed === 'boolean';
  if (!hasNotes && !hasDismissed) {
    return NextResponse.json({ error: 'student_notes ou dismissed est obligatoire' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    call_id: callId,
    client_id: call.client_id,
    coach_id: call.coach_id,
  };
  if (hasNotes) {
    patch.student_notes = body.student_notes;
    // Écrire du contenu réel annule un "rien à ajouter" précédent, par cohérence.
    if (body.student_notes.trim().length > 0) patch.student_notes_dismissed = false;
  }
  if (hasDismissed) patch.student_notes_dismissed = body.dismissed;

  const { error } = await serviceSupabase
    .from('session_reports')
    .upsert(patch, { onConflict: 'call_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
