import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(msg); };

  try {
    log('[WEBHOOK] début');

    const rawText = await req.text();
    log(`[WEBHOOK] body: ${rawText.slice(0, 200)}`);

    const secret = req.headers.get('x-webhook-secret');
    log(`[WEBHOOK] secret ok: ${secret === process.env.CRON_SECRET}`);
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized', logs }, { status: 401 });
    }

    const body = JSON.parse(rawText);
    const record = body?.record;
    log(`[WEBHOOK] record: ${JSON.stringify(record).slice(0, 150)}`);

    if (!record?.client_id || !record?.sender_id) {
      return NextResponse.json({ ok: true, reason: 'no_record', logs });
    }

    const { data: clientRow } = await supabase
      .from('clients').select('id, coach_id, profile_id').eq('id', record.client_id).single();
    log(`[WEBHOOK] client: ${JSON.stringify(clientRow)}`);
    if (!clientRow) return NextResponse.json({ ok: true, reason: 'no_client', logs });

    const recipientUserId = record.sender_id === clientRow.profile_id
      ? clientRow.coach_id : clientRow.profile_id;
    log(`[WEBHOOK] destinataire: ${recipientUserId}`);

    const { data: subs } = await supabase
      .from('push_subscriptions').select('endpoint, p256dh, auth').eq('profile_id', recipientUserId);
    log(`[WEBHOOK] subs: ${subs?.length ?? 0}`);
    if (!subs?.length) return NextResponse.json({ ok: true, reason: 'no_subs', logs });

    subs.forEach((s, i) => log(`[WEBHOOK] sub[${i}] endpoint: ${s.endpoint.slice(0, 50)}`));

    const { data: sender } = await supabase
      .from('profiles').select('full_name').eq('id', record.sender_id).maybeSingle();

    const title = sender?.full_name || 'Momentum';
    const bodyText = record.type === 'audio' ? '🎤 Message vocal' : (record.text || 'Nouveau message');
    const url = record.sender_id === clientRow.profile_id ? '/messages' : '/client/messages';

    // Badge PWA (pastille iOS avec chiffre) — compte tous les messages non lus adressés
    // au destinataire, tous clients confondus (un coach a plusieurs élèves).
    const { data: recipientClients } = await supabase
      .from('clients').select('id').or(`coach_id.eq.${recipientUserId},profile_id.eq.${recipientUserId}`);
    const clientIds = (recipientClients ?? []).map(c => c.id);
    // read_at (pas read) est la vraie source de vérité — read n'est pas fiable,
    // désynchronisé de read_at sur des messages déjà lus en base (vérifié).
    const { count: unreadCount } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('client_id', clientIds)
      .neq('sender_id', recipientUserId)
      .is('read_at', null);
    log(`[WEBHOOK] unreadCount: ${unreadCount}`);

    log(`[WEBHOOK] VAPID public: ${process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.slice(0, 20)}`);
    log(`[WEBHOOK] VAPID private: ${!!process.env.VAPID_PRIVATE_KEY}`);
    log(`[WEBHOOK] VAPID subject: ${process.env.VAPID_SUBJECT}`);

    // trim() sur toutes les clés VAPID — les env vars Vercel peuvent avoir un \n résiduel
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!.trim(),
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
      process.env.VAPID_PRIVATE_KEY!.trim()
    );
    log('[WEBHOOK] VAPID ok');

    const payload = JSON.stringify({ title, body: bodyText.substring(0, 100), url, unreadCount: unreadCount ?? 1 });

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
        log(`[WEBHOOK] ✅ sub[${i}] status: ${(r.value as any)?.statusCode}`);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = r.reason as any;
        log(`[WEBHOOK] ❌ sub[${i}]: ${e?.statusCode} ${e?.message} ${e?.body}`);
      }
    });

    const expired = results
      .map((r, i) => ({ r, sub: subs[i] }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(({ r }) => r.status === 'rejected' && (r.reason as any)?.statusCode === 410);
    if (expired.length) {
      await supabase.from('push_subscriptions').delete()
        .in('endpoint', expired.map(({ sub }) => sub.endpoint));
    }

    const sent = results.filter(r => r.status === 'fulfilled').length;
    log(`[WEBHOOK] terminé, envoyé: ${sent}`);
    // Retourner tous les logs dans la réponse pour debug
    return NextResponse.json({ sent, logs });

  } catch (err) {
    logs.push(`[WEBHOOK] 💥 crash: ${String(err)}`);
    console.log(logs.join(' | '));
    return NextResponse.json({ error: String(err), logs }, { status: 500 });
  }
}
