import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushToProfile } from '@/lib/googleCalendarService';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/calls/notify-rapport
// Cron toutes les 30 min — détecte les calls terminés sans rapport et envoie une push.
// La notif est envoyée à l'heure exacte de fin du call (scheduled_at + duration).
// Appels Calendly uniquement (calendly_event_uuid IS NOT NULL).
// Calls annulés ou reprogrammés (status='canceled') → ignorés.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Récupère la date de connexion Calendly de chaque profil pour ne pas notifier sur les vieux calls
  const { data: integrations } = await serviceSupabase
    .from('integrations')
    .select('profile_id, connected_at')
    .eq('provider', 'calendly')
    .not('connected_at', 'is', null);

  // Map profileId → connected_at
  const connectedAtByProfile = new Map<string, string>();
  for (const row of integrations ?? []) {
    if (row.profile_id && row.connected_at) {
      connectedAtByProfile.set(row.profile_id, row.connected_at);
    }
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
    .eq('rescheduled', false)  // ne pas notifier les calls reportés
    .neq('ignored', true)
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

  // Filtre les calls éligibles avant de paralléliser
  const eligibleCalls = calls.filter(call => {
    const connectedAt = connectedAtByProfile.get(call.coach_id);
    if (connectedAt && new Date(call.scheduled_at) < new Date(connectedAt)) return false;
    const durationMin = parseDurationMinutes(call.duration);
    if (durationMin === null) return false;
    const triggerTime = new Date(call.scheduled_at).getTime() + durationMin * 60 * 1000;
    return now >= triggerTime;
  });

  await Promise.all(eligibleCalls.map(async (call) => {
    try {
      const delivered = await sendPushToProfile(
        call.coach_id,
        'Rapport de call',
        `Comment s'est passé ton appel${call.invitee_name ? ` avec ${call.invitee_name}` : ''} ? Remplis ton rapport.`,
        `/client/calls?rapport=${call.id}`
      );

      if (delivered) {
        const { error: updateError } = await serviceSupabase
          .from('calls')
          .update({ rapport_notif_sent: true })
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
