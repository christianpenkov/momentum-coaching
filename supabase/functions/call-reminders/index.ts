import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// web-push via npm (Deno)
import webpush from 'npm:web-push';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Offset Paris (+1h hiver / +2h été) — règle UE : dernier dimanche de mars 1h UTC
// (passage à +2h) → dernier dimanche d'octobre 1h UTC (retour à +1h). Dupliqué ici
// (pas d'import cross-runtime possible entre cette Edge Function Deno et
// lib/parisTime.ts côté Next.js) — même logique que poll-leads/index.ts.
// Remplace toLocaleTimeString/toLocaleDateString(timeZone:'Europe/Paris'), qui sur
// cette Edge Function retombait silencieusement sur UTC (aucun support ICU/Intl des
// fuseaux nommés dans ce runtime Deno) — cette fonction est la vraie cause du bug
// "call à 17:35 affiché comme 15:35" : elle tourne indépendamment de
// app/api/calls/reminders/route.ts (jamais identifiée avant faute de logs), avec sa
// propre copie du code jamais mise à jour lors des fixes précédents.
function lastSundayOfMonth(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lastDate = new Date(Date.UTC(year, month, lastDay));
  return lastDay - lastDate.getUTCDay();
}

function parisOffsetHours(utcDate: Date): number {
  const year = utcDate.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, lastSundayOfMonth(year, 2), 1, 0, 0);
  const dstEnd = Date.UTC(year, 9, lastSundayOfMonth(year, 9), 1, 0, 0);
  const t = utcDate.getTime();
  return t >= dstStart && t < dstEnd ? 2 : 1;
}

function toParisWallClock(utcDate: Date): Date {
  const offset = parisOffsetHours(utcDate);
  return new Date(utcDate.getTime() + offset * 3600_000);
}

const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function formatParisTime(utcDate: Date): string {
  const wall = toParisWallClock(utcDate);
  const h = String(wall.getUTCHours()).padStart(2, '0');
  const m = String(wall.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatParisDate(utcDate: Date): string {
  const wall = toParisWallClock(utcDate);
  const day = DAYS_FR[wall.getUTCDay()];
  const date = wall.getUTCDate();
  const month = MONTHS_FR[wall.getUTCMonth()];
  return `${day} ${date} ${month}`;
}

async function sendPushToProfile(
  profileId: string,
  title: string,
  body: string,
  url: string
) {
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', profileId);

  if (!subs || subs.length === 0) return;

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!.trim(),
    Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY')!.trim(),
    Deno.env.get('VAPID_PRIVATE_KEY')!.trim()
  );

  const payload = JSON.stringify({ title, body, url });

  // Envoi en parallèle — Promise.all pour éviter les timeouts
  const results = await Promise.all(
    subs.map(sub =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        .catch((err: { statusCode?: number }) => err)
    )
  );

  // Nettoyer les subscriptions expirées (410 Gone)
  const expiredEndpoints = results
    .map((r, i) => ({ r, sub: subs[i] }))
    .filter(({ r }) => r && typeof r === 'object' && 'statusCode' in r && r.statusCode === 410)
    .map(({ sub }) => sub.endpoint);

  if (expiredEndpoints.length > 0) {
    await sb
      .from('push_subscriptions')
      .delete()
      .in('endpoint', expiredEndpoints);
  }
}

Deno.serve(async (req: Request) => {
  // Vérification du secret cron
  const authHeader = req.headers.get('authorization');
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Trace de diagnostic — cette fonction n'était pas identifiée comme le vrai
  // déclencheur des rappels de call avant ce fix (table déjà créée pour
  // app/api/calls/reminders/route.ts, réutilisée ici pour confirmer laquelle des
  // deux routes tourne réellement en pratique).
  try {
    await sb.from('cron_invocation_logs').insert({
      route: 'edge-function:call-reminders',
      user_agent: req.headers.get('user-agent'),
      referer: req.headers.get('referer'),
      method: req.method,
      invoked_at: new Date().toISOString(),
    });
  } catch { /* table de debug optionnelle, non bloquant si absente */ }

  const now = new Date();

  // Fenêtres de rappel avec tolérance ±8 min pour absorber les variations du cron
  const window24hStart = new Date(now.getTime() + 24 * 60 * 60 * 1000 - 8 * 60 * 1000);
  const window24hEnd   = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 8 * 60 * 1000);
  const window15mStart = new Date(now.getTime() + 15 * 60 * 1000 - 8 * 60 * 1000);
  const window15mEnd   = new Date(now.getTime() + 15 * 60 * 1000 + 8 * 60 * 1000);

  // Appels actifs dans la prochaine heure (couvre les deux fenêtres)
  const { data: calls } = await sb
    .from('calls')
    .select('id, client_id, topic, scheduled_at, join_url, reminder_24h_sent, reminder_15min_sent')
    .eq('status', 'active')
    .gte('scheduled_at', window15mStart.toISOString())
    .lte('scheduled_at', window24hEnd.toISOString());

  if (!calls || calls.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, checked: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
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
    const timeStr = formatParisTime(scheduledAt);
    const dateStr = formatParisDate(scheduledAt);
    const url = call.join_url || '/client/calls';

    // Rappel 24h avant — idempotent via reminder_24h_sent
    if (
      !call.reminder_24h_sent &&
      scheduledAt >= window24hStart &&
      scheduledAt <= window24hEnd
    ) {
      await sendPushToProfile(
        clientRow.profile_id,
        'Rappel — call demain',
        `${topic} · ${dateStr} à ${timeStr}`,
        url
      );
      await sb.from('calls').update({ reminder_24h_sent: true }).eq('id', call.id);
      sent++;
    }

    // Rappel 15 min avant — idempotent via reminder_15min_sent
    if (
      !call.reminder_15min_sent &&
      scheduledAt >= window15mStart &&
      scheduledAt <= window15mEnd
    ) {
      await sendPushToProfile(
        clientRow.profile_id,
        'Ton call commence dans 15 min',
        `${topic} · ${timeStr}`,
        url
      );
      await sb.from('calls').update({ reminder_15min_sent: true }).eq('id', call.id);
      sent++;
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, checked: calls.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
