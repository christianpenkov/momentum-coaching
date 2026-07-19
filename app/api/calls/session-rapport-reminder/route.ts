import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushToProfile } from '@/lib/googleCalendarService';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/calls/session-rapport-reminder
// Cron toutes les 30 min — détecte les calls Google coach-élève terminés sans rapport
// de session et envoie une push PROACTIVE au coach (pas à l'élève, contrairement au
// reminder Calendly). La notif part à l'heure exacte de fin du call (scheduled_at + duration).
// Calls Google Meet uniquement (calendly_event_uuid IS NULL, call_type = 'google').
// Calls annulés/reportés (status != 'active') → ignorés, cf. décision produit (Partie A).
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // duration est stocké comme "30 min", "60 min", etc.
  const { data: calls, error } = await serviceSupabase
    .from('calls')
    .select('id, coach_id, client_id, scheduled_at, duration')
    .eq('status', 'active')
    .eq('call_type', 'google')
    .is('calendly_event_uuid', null)
    .eq('session_rapport_reminder_sent', false)
    .is('session_completed', null)
    .is('session_no_show', null)
    .not('scheduled_at', 'is', null)
    .not('duration', 'is', null);

  if (error) {
    console.error('[session-rapport-reminder] Erreur requête calls:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!calls?.length) {
    return NextResponse.json({ ok: true, notified: 0 });
  }

  const now = Date.now();
  let notified = 0;
  const errors: string[] = [];

  const eligibleCalls = calls.filter(call => {
    const durationMin = parseDurationMinutes(call.duration);
    if (durationMin === null) return false;
    const triggerTime = new Date(call.scheduled_at).getTime() + durationMin * 60 * 1000;
    return now >= triggerTime;
  });

  await Promise.all(eligibleCalls.map(async (call) => {
    try {
      const { data: clientRow } = await serviceSupabase
        .from('clients')
        .select('name')
        .eq('id', call.client_id)
        .single();

      const delivered = await sendPushToProfile(
        call.coach_id,
        'Rapport de session',
        `Comment s'est passée ta session${clientRow?.name ? ` avec ${clientRow.name}` : ''} ? Remplis ton rapport.`,
        `/clients/${call.client_id}?session-rapport=${call.id}`
      );

      if (delivered) {
        const { error: updateError } = await serviceSupabase
          .from('calls')
          .update({ session_rapport_reminder_sent: true })
          .eq('id', call.id);

        if (updateError) {
          errors.push(`update_${call.id}: ${updateError.message}`);
        } else {
          notified++;
        }
      } else {
        errors.push(`no_delivery_${call.id}: aucune subscription active`);
      }
    } catch (e: any) {
      errors.push(`call_${call.id}: ${e?.message || 'unknown'}`);
    }
  }));

  return NextResponse.json({ ok: true, notified, errors });
}

// Alias POST → même handler (cron-job.org envoie parfois POST par défaut)
export const POST = GET;

function parseDurationMinutes(duration: string | null): number | null {
  if (!duration) return null;
  const match = duration.match(/(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}
