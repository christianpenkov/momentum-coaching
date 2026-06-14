import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const PLATFORM_URL = Deno.env.get('NEXT_PUBLIC_PLATFORM_URL') || 'https://momentum-plateforme.vercel.app';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseDurationMinutes(duration: string | null): number | null {
  if (!duration) return null;
  const match = duration.match(/(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 });
  }

  // Map profileId → connected_at pour filtrer les vieux calls
  const { data: integrations } = await supabase
    .from('integrations')
    .select('profile_id, connected_at')
    .eq('provider', 'calendly')
    .not('connected_at', 'is', null);

  const connectedAtByProfile = new Map<string, string>();
  for (const row of integrations ?? []) {
    if (row.profile_id && row.connected_at) {
      connectedAtByProfile.set(row.profile_id, row.connected_at);
    }
  }

  const { data: calls, error } = await supabase
    .from('calls')
    .select('id, coach_id, invitee_name, scheduled_at, duration')
    .eq('status', 'active')
    .is('no_show', null)
    .eq('rapport_notif_sent', false)
    .eq('rescheduled', false)
    .neq('ignored', true)
    .not('calendly_event_uuid', 'is', null)
    .not('scheduled_at', 'is', null)
    .not('duration', 'is', null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!calls?.length) {
    return new Response(JSON.stringify({ ok: true, notified: 0 }), { status: 200 });
  }

  const now = Date.now();

  const eligibleCalls = calls.filter((call: any) => {
    const connectedAt = connectedAtByProfile.get(call.coach_id);
    if (connectedAt && new Date(call.scheduled_at) < new Date(connectedAt)) return false;
    const durationMin = parseDurationMinutes(call.duration);
    if (durationMin === null) return false;
    const triggerTime = new Date(call.scheduled_at).getTime() + durationMin * 60 * 1000;
    return now >= triggerTime;
  });

  let notified = 0;
  const errors: string[] = [];

  await Promise.all(eligibleCalls.map(async (call: any) => {
    try {
      const res = await fetch(`${PLATFORM_URL}/api/push/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({
          profileId: call.coach_id,
          title: 'Rapport de call',
          body: `Comment s'est passé ton appel${call.invitee_name ? ` avec ${call.invitee_name}` : ''} ? Remplis ton rapport.`,
          url: `/client/calls?rapport=${call.id}`,
        }),
      });

      if (res.ok) {
        const { sent } = await res.json();
        if (sent > 0) {
          const { error: updateError } = await supabase
            .from('calls')
            .update({ rapport_notif_sent: true })
            .eq('id', call.id);

          if (updateError) errors.push(`update_${call.id}: ${updateError.message}`);
          else notified++;
        } else {
          errors.push(`no_delivery_${call.id}: aucune subscription active`);
        }
      } else {
        errors.push(`push_${call.id}: HTTP ${res.status}`);
      }
    } catch (e: any) {
      errors.push(`call_${call.id}: ${e?.message || 'unknown'}`);
    }
  }));

  return new Response(JSON.stringify({ ok: true, notified, errors }), { status: 200 });
});
