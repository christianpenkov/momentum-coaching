import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VALID_TOPICS = ['strategie_contenu', 'closing_vente', 'mindset_blocage', 'technique_outils', 'autre'];

// PATCH /api/calls/[id]/session-rapport
// Body: { attended: boolean, topic?: string, notes?: string }
// Rapport de fin d'appel pour le flux coach-élève (Google Meet uniquement).
// Distinct de /api/calls/[id]/rapport (flux Calendly élève-prospect, ne pas toucher).
// Seul le coach du call peut remplir ce rapport.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: call } = await serviceSupabase
    .from('calls')
    .select('id, coach_id, client_id, call_type, calendly_event_uuid, session_completed, session_no_show')
    .eq('id', id)
    .single();

  if (!call) return NextResponse.json({ error: 'Call introuvable' }, { status: 404 });
  if (call.coach_id !== user.id) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }
  if (call.call_type !== 'google' || call.calendly_event_uuid !== null) {
    return NextResponse.json({ error: 'Ce call ne fait pas partie du flux coach-élève Google Meet' }, { status: 400 });
  }
  if (call.session_completed || call.session_no_show) {
    return NextResponse.json({ error: 'Un rapport a déjà été rempli pour ce call' }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body.attended !== 'boolean') {
    return NextResponse.json({ error: 'Le champ attended est obligatoire' }, { status: 400 });
  }

  let topic: string | null = null;
  if (body.attended) {
    if (typeof body.topic !== 'string' || !VALID_TOPICS.includes(body.topic)) {
      return NextResponse.json({ error: 'Sujet de session invalide ou manquant' }, { status: 400 });
    }
    topic = body.topic;
  }
  const notes: string | null = body.attended && typeof body.notes === 'string' ? body.notes : null;

  const { error: callErr } = await serviceSupabase
    .from('calls')
    .update({
      session_completed: body.attended === true,
      session_no_show: body.attended === false,
    })
    .eq('id', id);

  if (callErr) return NextResponse.json({ error: callErr.message }, { status: 500 });

  // Upsert sur session_reports — ne fournit que les colonnes "coach" du payload,
  // pour ne jamais écraser student_notes déjà renseigné par l'élève (voir A2/A4).
  const { error: reportErr } = await serviceSupabase
    .from('session_reports')
    .upsert({
      call_id: id,
      client_id: call.client_id,
      coach_id: call.coach_id,
      attended: body.attended,
      topic,
      notes,
    }, { onConflict: 'call_id' });

  if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
