import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/calls/[id]/next-rescheduled
// Cherche un call futur lié au même lead (ig_lead_id ou coach_id+invitee)
// Utilisé par RapportModal après un refresh Calendly silencieux.
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

  const now = new Date().toISOString();

  let query = supa
    .from('calls')
    .select('id, scheduled_at, invitee_name')
    .eq('coach_id', user.id)
    .neq('id', id)
    .eq('status', 'active')
    .is('outcome', null)
    .gt('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(1);

  // Priorité : même lead IG
  if (currentCall.ig_lead_id) {
    const { data: byLead } = await query.eq('ig_lead_id', currentCall.ig_lead_id);
    if (byLead && byLead.length > 0) {
      return NextResponse.json({ call: { id: byLead[0].id, scheduledAt: byLead[0].scheduled_at, inviteeName: byLead[0].invitee_name } });
    }
  }

  // Fallback : même email ou nom si pas de lead IG
  if (currentCall.invitee_email) {
    const { data: byEmail } = await supa
      .from('calls')
      .select('id, scheduled_at, invitee_name')
      .eq('coach_id', user.id)
      .neq('id', id)
      .eq('status', 'active')
      .is('outcome', null)
      .gt('scheduled_at', now)
      .eq('invitee_email', currentCall.invitee_email)
      .order('scheduled_at', { ascending: true })
      .limit(1);
    if (byEmail && byEmail.length > 0) {
      return NextResponse.json({ call: { id: byEmail[0].id, scheduledAt: byEmail[0].scheduled_at, inviteeName: byEmail[0].invitee_name } });
    }
  }

  return NextResponse.json({ call: null });
}
