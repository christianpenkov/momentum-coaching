import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Appelé par le webhook Supabase à chaque INSERT dans messages
// Le déclenchement côté serveur évite le problème visibilityState sur iOS
export async function POST(req: NextRequest) {
  // Vérification secret webhook pour sécuriser l'endpoint
  const secret = req.headers.get('x-webhook-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  // Supabase webhook payload : { type: 'INSERT', table: 'messages', record: {...} }
  const record = body.record;
  if (!record) return NextResponse.json({ ok: true });

  const { client_id, sender_id, text, type: msgType } = record;
  if (!client_id || !sender_id) return NextResponse.json({ ok: true });

  // Trouver le destinataire : si sender = client → notifier le coach, et vice versa
  const { data: clientRow } = await supabase
    .from('clients')
    .select('id, coach_id, profile_id')
    .eq('id', client_id)
    .single();

  if (!clientRow) return NextResponse.json({ ok: true });

  // Destinataire = l'autre personne (pas l'expéditeur)
  const recipientUserId = sender_id === clientRow.profile_id
    ? clientRow.coach_id   // client a envoyé → notifier le coach
    : clientRow.profile_id; // coach a envoyé → notifier le client

  if (!recipientUserId) return NextResponse.json({ ok: true });

  // Récupérer les subscriptions push du destinataire
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', recipientUserId);

  if (!subs || subs.length === 0) return NextResponse.json({ sent: 0 });

  // Nom de l'expéditeur pour le titre
  const { data: senderProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', sender_id)
    .maybeSingle();

  const senderName = senderProfile?.full_name || 'Nouveau message';
  const bodyText = msgType === 'audio' ? '🎤 Message vocal' : (text || 'Nouveau message');
  const url = sender_id === clientRow.profile_id ? '/messages' : '/client/messages';

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  const payload = JSON.stringify({ title: senderName, body: bodyText, url });

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  );

  // Nettoyer les subscriptions expirées
  const expired = results
    .map((r, i) => ({ r, sub: subs[i] }))
    .filter(({ r }) => r.status === 'rejected' && (r as PromiseRejectedResult).reason?.statusCode === 410);

  if (expired.length > 0) {
    await supabase.from('push_subscriptions')
      .delete()
      .in('endpoint', expired.map(({ sub }) => sub.endpoint));
  }

  return NextResponse.json({ sent: results.filter(r => r.status === 'fulfilled').length });
}
