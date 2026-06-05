import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushToProfile } from '@/lib/googleCalendarService';

// GET /api/calls/reminders — appelé par Vercel Cron toutes les 15 min
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in24h5 = new Date(in24h.getTime() + 5 * 60 * 1000); // fenêtre ±5 min
  const in15m = new Date(now.getTime() + 15 * 60 * 1000);
  const in15m5 = new Date(in15m.getTime() + 5 * 60 * 1000);

  // Calls actifs dans les prochaines 24h + 15 min
  const { data: calls } = await sb
    .from('calls')
    .select('id, client_id, topic, scheduled_at, join_url, reminder_24h_sent, reminder_15min_sent')
    .eq('status', 'active')
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', in24h5.toISOString());

  if (!calls || calls.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  let sent = 0;

  for (const call of calls) {
    if (!call.client_id || !call.scheduled_at) continue;

    const { data: clientRow } = await sb
      .from('clients')
      .select('profile_id')
      .eq('id', call.client_id)
      .single();

    if (!clientRow?.profile_id) continue;

    const scheduledAt = new Date(call.scheduled_at);
    const topic = call.topic || 'Call coaching';
    const timeStr = scheduledAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const dateStr = scheduledAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const url = call.join_url || '/client/calls';

    // Rappel 24h avant
    if (
      !call.reminder_24h_sent &&
      scheduledAt >= in24h &&
      scheduledAt <= in24h5
    ) {
      await sendPushToProfile(
        clientRow.profile_id,
        'Rappel — call demain',
        `${topic} · demain ${dateStr} à ${timeStr}`,
        url
      );
      await sb
        .from('calls')
        .update({ reminder_24h_sent: true })
        .eq('id', call.id);
      sent++;
    }

    // Rappel 15 min avant
    if (
      !call.reminder_15min_sent &&
      scheduledAt >= in15m &&
      scheduledAt <= in15m5
    ) {
      await sendPushToProfile(
        clientRow.profile_id,
        'Ton call commence dans 15 min',
        `${topic} · ${timeStr}${url !== '/client/calls' ? ' — Rejoindre' : ''}`,
        url
      );
      await sb
        .from('calls')
        .update({ reminder_15min_sent: true })
        .eq('id', call.id);
      sent++;
    }
  }

  return NextResponse.json({ ok: true, sent, checked: calls.length });
}
