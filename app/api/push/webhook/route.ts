import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  console.log('[PUSH-WEBHOOK] Appel reçu');

  const secret = req.headers.get('x-webhook-secret');
  if (secret !== process.env.CRON_SECRET) {
    console.log('[PUSH-WEBHOOK] ❌ Secret invalide');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  console.log('[PUSH-WEBHOOK] Body reçu:', JSON.stringify(body).slice(0, 200));

  const record = body.record;
  if (!record) {
    console.log('[PUSH-WEBHOOK] ⚠️ Pas de record dans le body');
    return NextResponse.json({ ok: true });
  }

  const { client_id, sender_id, text, type: msgType } = record;
  console.log('[PUSH-WEBHOOK] Message:', { client_id, sender_id, msgType, text: text?.slice(0, 50) });

  if (!client_id || !sender_id) {
    console.log('[PUSH-WEBHOOK] ⚠️ client_id ou sender_id manquant');
    return NextResponse.json({ ok: true });
  }

  const { data: clientRow, error: clientError } = await supabase
    .from('clients')
    .select('id, coach_id, profile_id')
    .eq('id', client_id)
    .single();

  if (!clientRow) {
    console.log('[PUSH-WEBHOOK] ❌ Client introuvable:', clientError?.message);
    return NextResponse.json({ ok: true });
  }

  console.log('[PUSH-WEBHOOK] Client trouvé:', { profile_id: clientRow.profile_id, coach_id: clientRow.coach_id });

  const recipientUserId = sender_id === clientRow.profile_id
    ? clientRow.coach_id
    : clientRow.profile_id;

  console.log('[PUSH-WEBHOOK] Destinataire:', recipientUserId, '| Expéditeur:', sender_id);

  if (!recipientUserId) {
    console.log('[PUSH-WEBHOOK] ⚠️ recipientUserId null');
    return NextResponse.json({ ok: true });
  }

  const { data: subs, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', recipientUserId);

  console.log('[PUSH-WEBHOOK] Subscriptions trouvées:', subs?.length ?? 0, subsError?.message ?? '');

  if (!subs || subs.length === 0) {
    console.log('[PUSH-WEBHOOK] ⚠️ Aucune subscription pour', recipientUserId);
    return NextResponse.json({ sent: 0, reason: 'no_subscriptions' });
  }

  // Log endpoint partiel pour identifier le device (pas le full endpoint pour sécurité)
  subs.forEach((s, i) => {
    console.log(`[PUSH-WEBHOOK] Sub[${i}] endpoint:`, s.endpoint.slice(0, 60) + '...');
  });

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

  const payload = JSON.stringify({
    title: senderName,
    body: bodyText.substring(0, 100),
    url,
  });

  console.log('[PUSH-WEBHOOK] Envoi payload:', payload);

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400 }
      )
    )
  );

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const res = r.value as { statusCode: number };
      console.log(`[PUSH-WEBHOOK] ✅ Sub[${i}] envoyé, statusCode:`, res?.statusCode);
    } else {
      const err = r.reason as { statusCode?: number; message?: string; body?: string };
      console.log(`[PUSH-WEBHOOK] ❌ Sub[${i}] erreur:`, err?.statusCode, err?.message, err?.body);
    }
  });

  const expired = results
    .map((r, i) => ({ r, sub: subs[i] }))
    .filter(({ r }) => r.status === 'rejected' && (r as PromiseRejectedResult).reason?.statusCode === 410);

  if (expired.length > 0) {
    console.log('[PUSH-WEBHOOK] Nettoyage', expired.length, 'subscriptions expirées');
    await supabase.from('push_subscriptions')
      .delete()
      .in('endpoint', expired.map(({ sub }) => sub.endpoint));
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log('[PUSH-WEBHOOK] Terminé. Envoyé:', sent, '/', subs.length);
  return NextResponse.json({ sent });
}
