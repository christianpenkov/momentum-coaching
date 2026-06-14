import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/calls/[id]/next-rescheduled
// Cherche le prochain call lié au même lead (ig_lead_id ou email).
// Fenêtre : scheduled_at > now - 4h (pour attraper les calls du jour déjà passés).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: currentCall } = await supa
    .from('calls')
    .select('id, ig_lead_id, coach_id, invitee_name, invitee_email, scheduled_at')
    .eq('id', id)
    .maybeSingle();

  if (!currentCall) return NextResponse.json({ call: null });
  if (currentCall.coach_id !== user.id) return NextResponse.json({ call: null });

  // Fenêtre élargie : on accepte les calls qui ont démarré il y a moins de 4h
  const windowStart = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  const baseQuery = () => supa
    .from('calls')
    .select('id, scheduled_at, invitee_name')
    .eq('coach_id', user.id)
    .neq('id', id)
    .eq('status', 'active')
    .is('outcome', null)
    .neq('ignored', true)
    .gt('scheduled_at', windowStart)
    .order('scheduled_at', { ascending: true })
    .limit(1);

  // 1. Priorité : même ig_lead_id (direct)
  if (currentCall.ig_lead_id) {
    const { data } = await baseQuery().eq('ig_lead_id', currentCall.ig_lead_id);
    if (data && data.length > 0) {
      return NextResponse.json({ call: { id: data[0].id, scheduledAt: data[0].scheduled_at, inviteeName: data[0].invitee_name } });
    }
  }

  // 2. Même email → cherche aussi les calls dont ig_lead_id est lié à cet email
  if (currentCall.invitee_email) {
    const { data } = await baseQuery().eq('invitee_email', currentCall.invitee_email);
    if (data && data.length > 0) {
      return NextResponse.json({ call: { id: data[0].id, scheduledAt: data[0].scheduled_at, inviteeName: data[0].invitee_name } });
    }
  }

  return NextResponse.json({ call: null });
}
