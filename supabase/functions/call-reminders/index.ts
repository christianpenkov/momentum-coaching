// Edge Function poll-reminders — c'est CELLE-CI qui envoie réellement les rappels
// de call (24h/15min), confirmé le 2026-07-25 après une longue recherche : il existe
// AUSSI une route Next.js app/api/calls/reminders/route.ts qui fait la même chose
// mais dont le déclencheur réel reste introuvable (probablement morte/jamais
// appelée). Voir docs/fuseaux-horaires.md pour l'historique complet et l'explication de
// pourquoi il faut vérifier les DEUX si un bug de rappel/heure réapparaît.
// Déploiement séparé du reste du code (git push ne suffit pas) :
//   npx supabase functions deploy call-reminders --no-verify-jwt

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// web-push via npm (Deno)
import webpush from 'npm:web-push';
import { formatTimeIn, formatDateIn, safeZone } from '../_shared/timezone.ts';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Formatage des heures : importé de _shared/timezone.ts, partagé avec poll-leads.
// Remplace une copie locale du calcul manuel d'offset Paris, qui n'avait plus lieu
// d'être — chaque notification s'affiche désormais dans le fuseau de son
// destinataire, ce qu'aucune formule manuelle ne peut couvrir (base IANA).

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

    // Fuseau du DESTINATAIRE (l'élève), jamais celui de l'émetteur ni Paris : la
    // notification atterrit sur SON écran verrouillé, elle doit donner SON heure.
    // profiles.timezone est écrit par lib/UserContext.tsx à chaque ouverture de
    // l'app ; il peut être en retard si l'élève a voyagé sans rouvrir Momentum —
    // limite connue, documentée dans docs/fuseaux-horaires.md.
    const { data: recipient } = await sb
      .from('profiles')
      .select('timezone')
      .eq('id', clientRow.profile_id)
      .single();
    const tz = safeZone(recipient?.timezone);

    const scheduledAt = new Date(call.scheduled_at);
    const topic = call.topic || 'Call coaching';
    const timeStr = formatTimeIn(scheduledAt, tz);
    const dateStr = formatDateIn(scheduledAt, tz);
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
