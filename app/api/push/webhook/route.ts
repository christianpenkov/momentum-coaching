import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  // Log tout ce qu'on reçoit AVANT tout traitement
  const rawText = await req.text();
  console.log('[WEBHOOK] raw body:', rawText.slice(0, 500));
  console.log('[WEBHOOK] secret header:', req.headers.get('x-webhook-secret')?.slice(0, 20));
  console.log('[WEBHOOK] CRON_SECRET défini:', !!process.env.CRON_SECRET);
  console.log('[WEBHOOK] VAPID_PUBLIC défini:', !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  console.log('[WEBHOOK] VAPID_PRIVATE défini:', !!process.env.VAPID_PRIVATE_KEY);

  // Vérif secret
  const secret = req.headers.get('x-webhook-secret');
  if (secret !== process.env.CRON_SECRET) {
    console.log('[WEBHOOK] ❌ secret invalide');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Parse JSON
  let body: { record?: { client_id?: string; sender_id?: string; text?: string; type?: string } };
  try {
    body = JSON.parse(rawText);
  } catch (e) {
    console.log('[WEBHOOK] ❌ JSON invalide:', String(e));
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const record = body?.record;
  if (!record?.client_id || !record?.sender_id) {
    console.log('[WEBHOOK] ⚠️ record manquant ou incomplet');
    return NextResponse.json({ ok: true, reason: 'no_record' });
  }

  console.log('[WEBHOOK] record:', JSON.stringify(record).slice(0, 200));

  // Trouver client
  const { data: clientRow } = await supabase
    .from('clients').select('id, coach_id, profile_id').eq('id', record.client_id).single();

  if (!clientRow) {
    console.log('[WEBHOOK] ❌ client introuvable');
    return NextResponse.json({ ok: true, reason: 'no_client' });
  }

  const recipientUserId = record.sender_id === clientRow.profile_id
    ? clientRow.coach_id : clientRow.profile_id;

  console.log('[WEBHOOK] destinataire:', recipientUserId);

  const { data: subs } = await supabase
    .from('push_subscriptions').select('endpoint, p256dh, auth').eq('profile_id', recipientUserId);

  console.log('[WEBHOOK] subscriptions trouvées:', subs?.length ?? 0);
  if (!subs?.length) return NextResponse.json({ ok: true, reason: 'no_subs' });

  // Expéditeur
  const { data: sender } = await supabase
    .from('profiles').select('full_name').eq('id', record.sender_id).maybeSingle();

  const title = sender?.full_name || 'Momentum';
  const body2 = record.type === 'audio' ? '🎤 Message vocal' : (record.text || 'Nouveau message');
  const url = record.sender_id === clientRow.profile_id ? '/messages' : '/client/messages';

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  const payload = JSON.stringify({ title, body: body2.substring(0, 100), url });
  console.log('[WEBHOOK] envoi payload:', payload);

  const results = await Promise.allSettled(
    subs.map(sub => webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 86400 }
    ))
  );

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log(`[WEBHOOK] ✅ sub[${i}] statusCode:`, (r.value as any)?.statusCode);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = r.reason as any;
      console.log(`[WEBHOOK] ❌ sub[${i}] erreur:`, e?.statusCode, e?.message, e?.body);
    }
  });

  // Cleanup 410
  const expired = results
    .map((r, i) => ({ r, sub: subs[i] }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter(({ r }) => r.status === 'rejected' && (r.reason as any)?.statusCode === 410);
  if (expired.length) {
    await supabase.from('push_subscriptions').delete()
      .in('endpoint', expired.map(({ sub }) => sub.endpoint));
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log('[WEBHOOK] terminé, envoyé:', sent);
  return NextResponse.json({ sent });
}
