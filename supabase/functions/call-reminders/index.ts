// Edge Function poll-reminders — c'est CELLE-CI qui envoie réellement les rappels
// de call (24h/15min), confirmé le 2026-07-25 après une longue recherche : il existe
// AUSSI une route Next.js app/api/calls/reminders/route.ts qui fait la même chose
// mais dont le déclencheur réel reste introuvable (probablement morte/jamais
// appelée). Voir docs/fuseaux-horaires.md pour l'historique complet et l'explication de
// pourquoi il faut vérifier les DEUX si un bug de rappel/heure réapparaît.
// Déploiement séparé du reste du code (git push ne suffit pas) :
//   npx supabase functions deploy call-reminders --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// web-push via npm (Deno)
import webpush from 'npm:web-push';
import { formatTimeIn, formatDateIn, safeZone } from '../_shared/timezone.ts';
import { EMPREINTES_EDGE } from '../../../lib/empreintes-edge.generated.ts';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Formatage des heures : importé de _shared/timezone.ts, partagé avec poll-leads.
// Remplace une copie locale du calcul manuel d'offset Paris, qui n'avait plus lieu
// d'être — chaque notification s'affiche désormais dans le fuseau de son
// destinataire, ce qu'aucune formule manuelle ne peut couvrir (base IANA).

/** Issue d'un envoi : `webpush` etant sans types, l'annoter est le seul moyen de
 *  garder `deno check` vert et de distinguer succes et echec. */
type EnvoiPush = { livre: boolean; statusCode: number | undefined };

// Rend le NOMBRE de notifications reellement acceptees par le service de push.
//
// Le drapeau « rappel envoye » ne doit se poser que si quelque chose est parti.
// Avant, cette fonction ne rendait rien et l'appelant marquait le rappel envoye
// dans tous les cas — y compris quand l'eleve n'avait aucun abonnement. Le rappel
// etait alors perdu pour toujours, avec un drapeau qui affirmait le contraire.
// C'est le cas d'une PWA en cours de reinstallation : entre la desinscription et
// le nouvel endpoint, la table est vide pendant quelques secondes.
//
// `notify-rapport` verifiait deja `sent > 0` avant de poser son drapeau : la regle
// existait, elle etait juste ecrite a un seul des trois endroits.
//
// ⚠️ Un 201 comme un 410 portent tous deux un `statusCode` — web-push RESOUT avec
// un statusCode en cas de succes. On ne peut donc pas distinguer succes et echec
// par la presence du champ : il faut marquer la branche prise.
async function sendPushToProfile(
  profileId: string,
  title: string,
  body: string,
  url: string
): Promise<number> {
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', profileId);

  if (!subs || subs.length === 0) return 0;

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!.trim(),
    Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY')!.trim(),
    Deno.env.get('VAPID_PRIVATE_KEY')!.trim()
  );

  const payload = JSON.stringify({ title, body, url });

  // Envoi en parallèle — Promise.all pour éviter les timeouts
  const results: EnvoiPush[] = await Promise.all(
    subs.map((sub): Promise<EnvoiPush> =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        .then(() => ({ livre: true, statusCode: undefined }))
        .catch((err: { statusCode?: number }) => ({ livre: false, statusCode: err?.statusCode }))
    )
  );

  // Nettoyer les abonnements morts — 404 ET 410 (RFC 8030). Ne traiter que le
  // 410 laissait s'accumuler les endpoints repondant 404, reessayes a chaque
  // passage du cron.
  // Parametres annotes explicitement : `webpush` est un import npm sans types, donc
  // `results` retombe en `any[]` et les callbacks heritent d'un `any` implicite que
  // `deno check` refuse. Sans annotation cette fonction etait la seule des onze a
  // echouer la porte que AGENTS.md impose avant tout deploiement.
  const expiredEndpoints = results
    .map((r, i: number) => (!r.livre && [404, 410].includes(r.statusCode as number) ? subs[i].endpoint : null))
    .filter(Boolean) as string[];

  if (expiredEndpoints.length > 0) {
    await sb
      .from('push_subscriptions')
      .delete()
      .in('endpoint', expiredEndpoints);
  }

  return results.filter(r => r.livre).length;
}

Deno.serve(async (req: Request) => {
  // Vérification du secret cron
  const authHeader = req.headers.get('authorization');
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Filigrane de passage : la preuve que ce cron est encore INVOQUE.
  //
  // Pose AU PLUS TOT, juste apres l'authentification, et non a la fin — meme raison
  // que dans notify-rapport, dont ce bloc est la copie : `crons_sante` repond a « le
  // planificateur appelle-t-il encore cette URL ? », et un echec pendant l'execution
  // est deja couvert par `cron_runs`.
  //
  // ⚠️ POURQUOI CE CRON-CI AVAIT ETE OUBLIE. Il est declenche par pg_cron via
  // `net.http_post`, qui est ASYNCHRONE : il met la requete en file et rend son
  // identifiant immediatement. `cron.job_run_details` enregistre donc le succes de
  // l'INSTRUCTION SQL, jamais celui de l'appel HTTP. Mesure du 2026-09-03 : 724
  // passages, 100 % « succeeded », message uniforme « 1 row » — la valeur de retour de
  // net.http_post. Si cette fonction etait supprimee, repondait 500, ou si son secret
  // ne correspondait plus, ces lignes diraient EXACTEMENT la meme chose.
  //
  // `net._http_response` porte bien les vrais codes HTTP, mais pg_net la purge : 5 h 58
  // d'historique au moment de la mesure. Utilisable pour corroborer une enquete a
  // chaud, inutilisable pour une alerte quotidienne.
  //
  // Le seuil de silence vit sur la LIGNE (`crons_passages.silence_max`), pas ici.
  // Strictement non bloquant : un filigrane muet vaut mieux qu'un cron qui tombe.
  try {
    const { error: filigraneErr } = await sb.rpc('marquer_passage_cron', { p_nom: 'call-reminders', p_empreinte: EMPREINTES_EDGE['call-reminders'] });
    if (filigraneErr) console.error('[call-reminders] filigrane de passage:', filigraneErr.message);
  } catch (e) { console.error('[call-reminders] filigrane de passage:', e); }

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

  // ── Fenêtres LARGES, drapeaux étroits (audit du 2026-09-02) ────────────────
  //
  // Les fenêtres valaient ±8 min pour un cron aux 15 min : 16 min de couverture,
  // 1 min de marge. UN passage sauté (hoquet pg_cron, incident Supabase, deploy)
  // creusait un trou de 30 min > 16 min : tous les calls dont le rappel tombait
  // dedans n'étaient JAMAIS rappelés — drapeau jamais posé, aucun signal.
  //
  // La checklist (§6) dit : fenêtre de rattrapage PLUS LARGE que l'intervalle.
  // L'idempotence est déjà portée par les drapeaux reminder_*_sent : élargir la
  // borne basse ne coûte rien et absorbe des heures de panne. Seul le libellé
  // doit suivre — un « demain » envoyé 3 h avant le call mentirait, donc le titre
  // s'adapte à l'écart réel.
  const window24hEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 8 * 60 * 1000);
  // Plancher du rappel « demain » : sous 1 h d'écart, il n'a plus de sens — le
  // rappel 15 min prend le relais.
  const floor24h = new Date(now.getTime() + 60 * 60 * 1000);
  const window15mEnd = new Date(now.getTime() + 15 * 60 * 1000 + 8 * 60 * 1000);
  // Plancher du rappel court : l'instant présent — un call déjà commencé ne se
  // rappelle plus.
  const floor15m = now;

  // Appels actifs jusqu'à J+1 (couvre les deux fenêtres élargies)
  const { data: calls } = await sb
    .from('calls')
    .select('id, client_id, topic, scheduled_at, join_url, reminder_24h_sent, reminder_15min_sent')
    .eq('status', 'active')
    .gte('scheduled_at', floor15m.toISOString())
    .lte('scheduled_at', window24hEnd.toISOString());

  if (!calls || calls.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, checked: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let sent = 0;

  // Résolution GROUPÉE des destinataires et de leurs fuseaux.
  //
  // Avant : 2 requêtes séquentielles PAR CALL (clients puis profiles) à
  // l'intérieur de la boucle — un N+1 classique. Deux requêtes `.in()` donnent
  // exactement la même information, avec un coût constant quel que soit le nombre
  // de rappels dus.
  const clientIds = [...new Set(calls.map((c: any) => c.client_id).filter(Boolean))];

  const profileByClient = new Map<string, string>();
  if (clientIds.length) {
    const { data: clientRows } = await sb
      .from('clients')
      .select('id, profile_id')
      .in('id', clientIds);
    for (const row of clientRows || []) {
      if (row.profile_id) profileByClient.set(row.id, row.profile_id);
    }
  }

  // Fuseau du DESTINATAIRE (l'élève), jamais celui de l'émetteur ni Paris : la
  // notification atterrit sur SON écran verrouillé, elle doit donner SON heure.
  // profiles.timezone est écrit par lib/UserContext.tsx à chaque ouverture de
  // l'app ; il peut être en retard si l'élève a voyagé sans rouvrir Momentum —
  // limite connue, documentée dans docs/fuseaux-horaires.md.
  const tzByProfile = new Map<string, string | null>();
  const profileIds = [...new Set(profileByClient.values())];
  if (profileIds.length) {
    const { data: profileRows } = await sb
      .from('profiles')
      .select('id, timezone')
      .in('id', profileIds);
    for (const row of profileRows || []) {
      tzByProfile.set(row.id, row.timezone ?? null);
    }
  }

  for (const call of calls) {
    if (!call.client_id || !call.scheduled_at) continue;

    const recipientProfileId = profileByClient.get(call.client_id);
    if (!recipientProfileId) continue;
    const clientRow = { profile_id: recipientProfileId };

    const tz = safeZone(tzByProfile.get(recipientProfileId) ?? null);

    const scheduledAt = new Date(call.scheduled_at);
    const topic = call.topic || 'Call coaching';
    const timeStr = formatTimeIn(scheduledAt, tz);
    const dateStr = formatDateIn(scheduledAt, tz);
    const url = call.join_url || '/client/calls';

    // Rappel « la veille » — idempotent via reminder_24h_sent, fenêtre de
    // rattrapage large (voir le bloc des fenêtres). Le titre suit l'écart réel :
    // au-delà de 20 h il dit « demain », en deçà (rattrapage après panne) il dit
    // simplement que le call approche — le corps porte de toute façon la date et
    // l'heure exactes.
    if (
      !call.reminder_24h_sent &&
      scheduledAt >= floor24h &&
      scheduledAt <= window24hEnd
    ) {
      const ecartH = (scheduledAt.getTime() - now.getTime()) / 3600_000;
      const livres = await sendPushToProfile(
        clientRow.profile_id,
        ecartH > 20 ? 'Rappel — call demain' : 'Rappel — call à venir',
        `${topic} · ${dateStr} à ${timeStr}`,
        url
      );
      // Rien n'est parti : on ne pose pas le drapeau, le prochain passage reessaiera.
      if (livres > 0) {
        await sb.from('calls').update({ reminder_24h_sent: true }).eq('id', call.id);
        sent++;
      }
    }

    // Rappel court — idempotent via reminder_15min_sent, fenêtre de rattrapage
    // jusqu'à l'heure du call : mieux vaut un rappel à 5 min qu'aucun rappel.
    if (
      !call.reminder_15min_sent &&
      scheduledAt >= floor15m &&
      scheduledAt <= window15mEnd
    ) {
      const minutes = Math.max(1, Math.round((scheduledAt.getTime() - now.getTime()) / 60_000));
      const livres = await sendPushToProfile(
        clientRow.profile_id,
        `Ton call commence dans ${minutes} min`,
        `${topic} · ${timeStr}`,
        url
      );
      // Rien n'est parti : on ne pose pas le drapeau, le prochain passage reessaiera.
      if (livres > 0) {
        await sb.from('calls').update({ reminder_15min_sent: true }).eq('id', call.id);
        sent++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, checked: calls.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
