import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushToProfile } from '@/lib/googleCalendarService';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/calls/notify-rapport
// Cron Vercel toutes les 15 min — détecte les calls terminés sans rapport et envoie une push.
// Appels Calendly uniquement (calendly_event_uuid IS NOT NULL).
// Calls annulés ou reprogrammés (status='canceled') → ignorés.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Récupère tous les calls actifs Calendly dont la fin théorique + 15 min est passée
  // et pour lesquels la notif n'a pas encore été envoyée.
  // duration est stocké comme "30 min", "60 min", etc.
  const { data: calls, error } = await serviceSupabase
    .from('calls')
    .select('id, coach_id, invitee_name, scheduled_at, duration')
    .eq('status', 'active')
    .is('no_show', null)
    .eq('rapport_notif_sent', false)
    .not('calendly_event_uuid', 'is', null)
    .not('scheduled_at', 'is', null)
    .not('duration', 'is', null);

  if (error) {
    console.error('[notify-rapport] Erreur requête calls:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!calls?.length) {
    return NextResponse.json({ ok: true, notified: 0 });
  }

  const now = Date.now();
  let notified = 0;
  const errors: string[] = [];

  for (const call of calls) {
    try {
      const durationMin = parseDurationMinutes(call.duration);
      if (durationMin === null) continue;

      const scheduledAt = new Date(call.scheduled_at).getTime();
      const endTime = scheduledAt + durationMin * 60 * 1000;
      const triggerTime = endTime + 15 * 60 * 1000; // +15 min après la fin

      if (now < triggerTime) continue; // Pas encore l'heure

      // Envoie la push à l'élève (coach_id = profileId de l'élève pour les calls Calendly)
      await sendPushToProfile(
        call.coach_id,
        'Rapport de call',
        `Comment s'est passé ton appel${call.invitee_name ? ` avec ${call.invitee_name}` : ''} ? Remplis ton rapport.`,
        `/client/calls?rapport=${call.id}`
      );

      // Marque comme envoyé (idempotence)
      const { error: updateError } = await serviceSupabase
        .from('calls')
        .update({ rapport_notif_sent: true })
        .eq('id', call.id);

      if (updateError) {
        errors.push(`update_${call.id}: ${updateError.message}`);
      } else {
        notified++;
      }
    } catch (e: any) {
      errors.push(`call_${call.id}: ${e?.message || 'unknown'}`);
    }
  }

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
