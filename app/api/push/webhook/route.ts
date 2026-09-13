import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { TAG_MESSAGERIE } from '@/lib/notifications';
import { decrireErreur, signalerIncident } from '@/lib/incidents';
import { normaliserMessage } from '@/lib/incidentsClassement';

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
      // Appelée par un trigger de la base, jamais par un inconnu : un secret refusé veut
      // dire que le Vault (`push_webhook_secret`) et `CRON_SECRET` ne concordent plus —
      // cas réel après la rotation du 2026-09-12. Plus AUCUNE notification de message ne
      // part, et pg_net ne lit pas la réponse. Signalé seulement si l'en-tête est présent.
      if (secret) {
        await signalerIncident({
          source: 'vercel-serveur',
          gravite: 'critique',
          titre: 'Notifications de messagerie coupées : le secret envoyé par la base ne correspond plus à CRON_SECRET',
          empreinte: ['push-webhook-secret'],
          detail: {
            type: 'push_webhook_secret',
            a_faire: 'Aligner le secret `push_webhook_secret` du Vault Supabase sur la valeur de CRON_SECRET (Vercel). Procédure : docs/transfert-de-compte.md §5 bis.',
          },
        });
      }
      return NextResponse.json({ error: 'unauthorized', logs }, { status: 401 });
    }

    const body = JSON.parse(rawText);
    // Deux formes de payload : `record` pour un nouveau message (trigger INSERT),
    // `reaction_record` pour une réaction posée sur un message existant (trigger UPDATE).
    // Le destinataire et l'auteur de l'action sont inversés entre les deux cas — pour une
    // réaction, sender_id du message reste l'auteur ORIGINAL (le destinataire de la notif),
    // et reaction_by est la personne qui vient de réagir (l'auteur de l'action à notifier).
    const isReaction = !!body?.reaction_record;
    const record = body?.record ?? body?.reaction_record;
    log(`[WEBHOOK] record: ${JSON.stringify(record).slice(0, 150)}`);

    if (!record?.client_id || !record?.sender_id) {
      return NextResponse.json({ ok: true, reason: 'no_record', logs });
    }
    if (isReaction && !record.reaction_by) {
      return NextResponse.json({ ok: true, reason: 'no_reactor', logs });
    }

    const { data: clientRow } = await supabase
      .from('clients').select('id, coach_id, profile_id').eq('id', record.client_id).single();
    log(`[WEBHOOK] client: ${JSON.stringify(clientRow)}`);
    if (!clientRow) return NextResponse.json({ ok: true, reason: 'no_client', logs });

    // Nouveau message : destinataire = l'autre participant. Réaction : destinataire =
    // l'auteur du message original (sender_id), qui n'a pas forcément posé la réaction.
    const actorId = isReaction ? record.reaction_by : record.sender_id;
    const recipientUserId = isReaction
      ? record.sender_id
      : (record.sender_id === clientRow.profile_id ? clientRow.coach_id : clientRow.profile_id);
    log(`[WEBHOOK] destinataire: ${recipientUserId}`);

    if (actorId === recipientUserId) {
      return NextResponse.json({ ok: true, reason: 'self_action', logs });
    }

    const { data: subs } = await supabase
      .from('push_subscriptions').select('endpoint, p256dh, auth').eq('profile_id', recipientUserId);
    log(`[WEBHOOK] subs: ${subs?.length ?? 0}`);
    if (!subs?.length) return NextResponse.json({ ok: true, reason: 'no_subs', logs });

    subs.forEach((s, i) => log(`[WEBHOOK] sub[${i}] endpoint: ${s.endpoint.slice(0, 50)}`));

    const { data: actor } = await supabase
      .from('profiles').select('full_name, avatar_url').eq('id', actorId).maybeSingle();

    const title = actor?.full_name || 'Momentum';
    const bodyText = isReaction
      ? `A réagi ${record.reaction_emoji} à votre message`
      : record.type === 'audio' ? '🎤 Message vocal'
      : record.type === 'image' ? '📷 Photo'
      : record.type === 'document' ? '📄 Document'
      : (record.text || 'Nouveau message');
    // Miniature affichée dans la notification (Android + certaines PWA iOS) — l'image
    // elle-même pour un message image, la miniature générée pour un PDF, rien pour le reste.
    const notifImage = isReaction ? undefined
      : record.type === 'image' ? record.audio_url
      : record.type === 'document' ? record.thumbnail_url
      : undefined;
    const url = recipientUserId === clientRow.profile_id ? '/client/messages' : '/messages';

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

    const payload = JSON.stringify({
      title, body: bodyText.substring(0, 100), url, unreadCount: unreadCount ?? 1,
      // Tag PARTAGÉ, et c'est le seul endroit où on le veut : un nouveau message
      // remplace le précédent pour ne laisser qu'un badge de conversation.
      // Désormais explicite — c'était le défaut du service worker, donc hérité
      // par tous les autres émetteurs, qui s'effaçaient les uns les autres.
      tag: TAG_MESSAGERIE,
      image: notifImage,
      // Photo de profil de l'expéditeur affichée en icône de la notification (au lieu
      // du logo Momentum générique) — comportement WhatsApp/iMessage. Fallback géré
      // côté service worker si absente.
      icon: actor?.avatar_url || undefined,
    });

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

    // 404 ET 410 : les deux désignent un abonnement à jeter (RFC 8030). Ne
    // traiter que le 410 laissait s'accumuler les endpoints répondant 404,
    // réessayés à chaque envoi.
    const expired = results
      .map((r, i) => ({ r, sub: subs[i] }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(({ r }) => r.status === 'rejected' && [404, 410].includes((r.reason as any)?.statusCode));
    if (expired.length) {
      await supabase.from('push_subscriptions').delete()
        .in('endpoint', expired.map(({ sub }) => sub.endpoint));
    }

    // Un refus du service push qui n'est ni 404 ni 410 ne dit pas « abonnement périmé » :
    // c'est la plateforme qui est refusée (clés VAPID désaccordées → 401/403, charge
    // trop lourde → 413). Il touche alors TOUS les destinataires, et ne laissait qu'un
    // console.log. Une empreinte par statut : un seul e-mail par cause.
    const refusPlateforme = results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(r => (r.status === 'rejected' ? (r.reason as any) : null))
      .filter(e => e && ![404, 410].includes(e.statusCode));
    if (refusPlateforme.length) {
      const e = refusPlateforme[0];
      await signalerIncident({
        source: 'vercel-serveur',
        // Normal et non critique (relecture adversariale du 2026-09-13) : un seul
        // abonnement créé avec d'anciennes clés VAPID répond 403 à chaque message, sans
        // que la plateforme soit en panne. Une empreinte par statut → une ligne dans le
        // récapitulatif ; si les clés sont vraiment désaccordées, TOUS les envois
        // refusent et le compteur d'occurrences le montre.
        gravite: 'normale',
        titre: `Notifications push refusées par le service push (HTTP ${e.statusCode ?? 'inconnu'}) : ${String(e.message ?? '').slice(0, 120)}`,
        empreinte: ['push-refus', String(e.statusCode ?? 'sans-statut')],
        detail: {
          type: 'push_refus',
          statut: e.statusCode ?? null,
          message: String(e.message ?? ''),
          corps: String(e.body ?? '').slice(0, 1_000),
          refus: refusPlateforme.length,
          abonnements: subs.length,
          a_faire: '401/403 : les clés VAPID (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) ne correspondent plus à celles des abonnements — vérifier qu’aucune n’a de retour à la ligne (mémoire « Vercel env vars sans newline »). Diagnostic de la chaîne push : docs/pastille-et-sauts-accueil.md.',
        },
      });
    }

    const sent = results.filter(r => r.status === 'fulfilled').length;
    log(`[WEBHOOK] terminé, envoyé: ${sent}`);
    // Retourner tous les logs dans la réponse pour debug
    return NextResponse.json({ sent, logs });

  } catch (err) {
    logs.push(`[WEBHOOK] 💥 crash: ${String(err)}`);
    console.log(logs.join(' | '));
    const e = decrireErreur(err);
    await signalerIncident({
      source: 'vercel-serveur',
      gravite: 'critique',
      titre: `Notification de messagerie en échec : ${e.message.slice(0, 140)}`,
      empreinte: ['push-webhook-crash', e.nom, normaliserMessage(e.message)],
      detail: { type: 'push_webhook_crash', erreur: e, journal: logs.slice(-15) },
    });
    return NextResponse.json({ error: String(err), logs }, { status: 500 });
  }
}
