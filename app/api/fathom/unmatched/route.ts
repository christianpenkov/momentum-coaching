import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/fathom/unmatched — liste les enregistrements Fathom du coach non encore
// rattachés à un call.
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data, error } = await serviceSupabase
    .from('fathom_unmatched')
    .select('*')
    .eq('profile_id', user.id)
    .is('resolved_call_id', null)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data });
}

// POST /api/fathom/unmatched — rattache manuellement un enregistrement Fathom
// à un call existant. Body: { unmatchedId, callId }
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { unmatchedId, callId } = body;
  if (!unmatchedId || !callId) {
    return NextResponse.json({ error: 'unmatchedId et callId requis' }, { status: 400 });
  }

  const { data: unmatched } = await serviceSupabase
    .from('fathom_unmatched')
    .select('*')
    .eq('id', unmatchedId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!unmatched) {
    return NextResponse.json({ error: 'Enregistrement introuvable' }, { status: 404 });
  }

  // Vérifie que le call cible appartient bien au coach (soit coach_id, soit via
  // client_id → clients.coach_id) avant d'y écrire — le service role bypass RLS.
  const { data: call } = await serviceSupabase
    .from('calls')
    .select('id, coach_id, client_id, clients:client_id(coach_id)')
    .eq('id', callId)
    .maybeSingle();

  const callCoachId = call?.coach_id || (call as any)?.clients?.coach_id;
  if (!call || callCoachId !== user.id) {
    return NextResponse.json({ error: 'Call introuvable ou non autorisé' }, { status: 404 });
  }

  await serviceSupabase.from('calls').update({
    fathom_recording_id: unmatched.fathom_recording_id,
    fathom_share_url: unmatched.fathom_share_url,
    fathom_summary: unmatched.fathom_summary,
    fathom_action_items: unmatched.fathom_action_items,
    fathom_transcript: unmatched.fathom_transcript,
    fathom_status: 'matched',
    fathom_matched_at: new Date().toISOString(),
  }).eq('id', callId);

  await serviceSupabase.from('fathom_unmatched').update({
    resolved_call_id: callId,
    resolved_at: new Date().toISOString(),
  }).eq('id', unmatchedId);

  return NextResponse.json({ ok: true });
}
