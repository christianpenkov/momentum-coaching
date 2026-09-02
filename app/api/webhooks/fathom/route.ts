import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function logDebug(message: string, data: Record<string, unknown>) {
  await serviceSupabase.from('webhook_debug_log').insert({ message, data });
}

// Fenêtre de tolérance pour le fallback email+créneau (Fathom peut démarrer
// l'enregistrement quelques minutes après scheduled_at, ou le call peut avoir
// légèrement dérivé côté organisateur).
const MATCH_WINDOW_MINUTES = 30;

interface FathomInvitee {
  name?: string;
  email?: string;
}

// Profil de la personne dont le compte Fathom a enregistré, à partir de son email.
//
// RPC get_profile_id_by_email : lookup indexé direct sur auth.users, contrairement
// à auth.admin.listUsers() qui ne retourne que les 50 premiers utilisateurs.
//
// Le passage par `integrations` ne change pas le résultat (il retombe sur le même
// id) mais atteste que ce profil a bien Fathom relié — donc qu'on pourra demander
// la vidéo avec son jeton. Null = personne extérieure à la plateforme : sans
// conséquence, on retombe sur « essayer le jeton de chaque participant ».
async function resoudreProfil(email: string | undefined): Promise<string | null> {
  if (!email) return null;
  const { data: profilId } = await serviceSupabase.rpc('get_profile_id_by_email', { p_email: email });
  if (!profilId) return null;
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('profile_id')
    .eq('profile_id', profilId)
    .eq('provider', 'fathom')
    .maybeSingle();
  return integ?.profile_id ?? profilId;
}

interface FathomWebhookPayload {
  recording_id: string | number;
  share_url?: string;
  meeting_url?: string;
  meeting_title?: string;
  calendar_invitees?: FathomInvitee[];
  recorded_by?: { email?: string; name?: string };
  scheduled_start_time?: string;
  recording_start_time?: string;
  transcript?: unknown;
  summary?: string;
  action_items?: unknown;
}

export async function POST(request: NextRequest) {
  const body = await request.text();

  const webhookId = request.headers.get('webhook-id') || '';
  const webhookTimestamp = request.headers.get('webhook-timestamp') || '';
  const webhookSignature = request.headers.get('webhook-signature') || '';

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return NextResponse.json({ error: 'Signature manquante' }, { status: 401 });
  }

  // Fenêtre de validité 5 minutes (protection replay)
  const timestampSeconds = parseInt(webhookTimestamp, 10);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    return NextResponse.json({ error: 'Timestamp invalide ou expiré' }, { status: 401 });
  }

  // Vérification signature Svix (webhook-id / webhook-timestamp / webhook-signature)
  // — fail-closed si aucun secret n'est configuré, même pattern que le webhook Calendly.
  // Chaque secret whsec_... est généré par Fathom à la création du webhook et propre au
  // compte qui l'a créé (stocké dans integrations.metadata par register-webhook) — Fathom
  // ne le réexpose jamais après coup, et les headers Svix ne portent aucun identifiant de
  // compte permettant de savoir directement quel secret utiliser. Plusieurs coachs pouvant
  // chacun connecter leur propre compte Fathom, on essaie donc la signature contre TOUS les
  // secrets connus (integrations.provider='fathom') plutôt que de supposer un secret unique
  // — la vérification reste stricte (échec sur tous = 401), seule la recherche du bon
  // secret est multi-comptes.
  const { data: fathomIntegs } = await serviceSupabase
    .from('integrations')
    .select('profile_id, metadata')
    .eq('provider', 'fathom');
  const knownSecrets = (fathomIntegs || [])
    .map(i => (i.metadata as any)?.webhook_secret)
    .filter(Boolean) as string[];
  if (process.env.FATHOM_WEBHOOK_SECRET) knownSecrets.push(process.env.FATHOM_WEBHOOK_SECRET);

  if (knownSecrets.length === 0) {
    await logDebug('[webhook/fathom] aucun secret connu — refus fail-closed', {});
    return NextResponse.json({ error: 'Erreur de configuration serveur' }, { status: 500 });
  }

  const crypto = await import('crypto');
  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;
  // webhook-signature peut contenir plusieurs signatures espacées ("v1,sig1 v1,sig2")
  const receivedSignatures = webhookSignature.split(' ').map(s => s.split(',')[1]).filter(Boolean);

  const isValid = knownSecrets.some(secret => {
    const secretKey = secret.startsWith('whsec_')
      ? Buffer.from(secret.slice('whsec_'.length), 'base64')
      : Buffer.from(secret, 'base64');
    const expectedSignature = crypto.createHmac('sha256', secretKey).update(signedContent).digest('base64');
    return receivedSignatures.some(sig => {
      try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature));
      } catch {
        return false;
      }
    });
  });

  if (!isValid) {
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 });
  }

  let payload: FathomWebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  if (!payload.recording_id) {
    return NextResponse.json({ ok: true });
  }

  const recordingId = String(payload.recording_id);
  const fathomFields = {
    fathom_recording_id: recordingId,
    fathom_share_url: payload.share_url || null,
    fathom_summary: payload.summary || null,
    fathom_action_items: payload.action_items ?? null,
    fathom_transcript: payload.transcript ? JSON.stringify(payload.transcript) : null,
    fathom_status: 'matched' as const,
    fathom_matched_at: new Date().toISOString(),
  };

  // Déjà traité (retry Fathom) — idempotence via l'index unique de call_recordings.
  //
  // On interroge call_recordings et non calls : depuis qu'un call peut porter
  // DEUX enregistrements (les deux bots présents), `calls.fathom_recording_id`
  // ne connaît que le premier et laisserait repasser le second à chaque retry.
  const { data: dejaTraite } = await serviceSupabase
    .from('call_recordings')
    .select('call_id')
    .eq('fathom_recording_id', recordingId)
    .maybeSingle();
  if (dejaTraite) {
    return NextResponse.json({ ok: true, message: 'Déjà traité' });
  }

  // Qui a enregistré. Sert à savoir, plus tard, à quel compte demander la vidéo —
  // un enregistrement ne se télécharge qu'avec le jeton de son propriétaire.
  // Null si la personne n'a pas de compte chez nous : ce n'est pas bloquant,
  // on retombe alors sur « essayer le jeton de chaque participant ».
  const profilEnregistreur = await resoudreProfil(payload.recorded_by?.email);

  let matchedCallId: string | null = null;

  // 0. Le SECOND bot sur une réunion déjà rattachée.
  //
  // Quand coach et élève ont tous les deux Fathom, les deux rejoignent et Fathom
  // produit deux enregistrements de la même conversation. Le premier rattache le
  // call ; le second ne trouvait plus rien, parce que les requêtes ci-dessous
  // exigent `fathom_recording_id IS NULL` — et finissait en « non rattaché », à
  // traiter à la main, sur chaque call de coaching.
  //
  // On ne lève ce filtre QUE sur l'URL de jonction exacte, et volontairement pas
  // sur le repli email+créneau : deux calls successifs avec la même personne
  // tombent dans la même fenêtre de 30 min, et c'est justement ce filtre qui
  // empêche le second enregistrement de se coller au premier call. L'URL, elle,
  // ne désigne qu'une réunion.
  if (payload.meeting_url) {
    const { data: memeReunion } = await serviceSupabase
      .from('calls')
      .select('id')
      .neq('status', 'canceled')
      .not('fathom_recording_id', 'is', null)
      .or(`join_url.eq.${payload.meeting_url},meet_link.eq.${payload.meeting_url}`)
      .order('scheduled_at', { ascending: false })
      .limit(1);

    if (memeReunion?.[0]?.id) {
      // Le call garde SON enregistrement d'origine : le résumé et la
      // transcription affichés ne changent pas sous les yeux de celui qui les
      // lisait. On n'ajoute que de quoi retrouver cette seconde copie.
      await serviceSupabase.from('call_recordings').upsert({
        call_id: memeReunion[0].id,
        profile_id: profilEnregistreur,
        fathom_recording_id: recordingId,
        fathom_share_url: payload.share_url || null,
        recorded_at: payload.recording_start_time || null,
      }, { onConflict: 'fathom_recording_id' });

      return NextResponse.json({ ok: true, matched: true, call_id: memeReunion[0].id, secondaire: true });
    }
  }

  // 1. Matching prioritaire : URL de jonction exacte (meeting_url Fathom == join_url/meet_link)
  if (payload.meeting_url) {
    const { data: byUrl } = await serviceSupabase
      .from('calls')
      .select('id, scheduled_at')
      .neq('status', 'canceled')
      .is('fathom_recording_id', null)
      .or(`join_url.eq.${payload.meeting_url},meet_link.eq.${payload.meeting_url}`)
      .order('scheduled_at', { ascending: false })
      .limit(1);
    matchedCallId = byUrl?.[0]?.id ?? null;
  }

  // 2. Fallback : email invité + créneau horaire proche
  if (!matchedCallId && payload.calendar_invitees?.length) {
    const invitees = payload.calendar_invitees.map(i => i.email).filter(Boolean) as string[];
    const referenceTime = payload.scheduled_start_time || payload.recording_start_time;

    if (invitees.length && referenceTime) {
      const refDate = new Date(referenceTime);
      const windowStart = new Date(refDate.getTime() - MATCH_WINDOW_MINUTES * 60000).toISOString();
      const windowEnd = new Date(refDate.getTime() + MATCH_WINDOW_MINUTES * 60000).toISOString();

      // Flux vente (invitee_email direct sur calls)
      const { data: byInviteeEmail } = await serviceSupabase
        .from('calls')
        .select('id, scheduled_at')
        .neq('status', 'canceled')
        .is('fathom_recording_id', null)
        .in('invitee_email', invitees)
        .gte('scheduled_at', windowStart)
        .lte('scheduled_at', windowEnd)
        .order('scheduled_at', { ascending: false })
        .limit(1);
      matchedCallId = byInviteeEmail?.[0]?.id ?? null;

      // Flux coaching (email élève sur clients, jointure via client_id)
      if (!matchedCallId) {
        const { data: clientRows } = await serviceSupabase
          .from('clients')
          .select('id')
          .in('email', invitees);
        const clientIds = (clientRows || []).map(c => c.id);
        if (clientIds.length) {
          const { data: byClientEmail } = await serviceSupabase
            .from('calls')
            .select('id, scheduled_at')
            .neq('status', 'canceled')
            .is('fathom_recording_id', null)
            .in('client_id', clientIds)
            .gte('scheduled_at', windowStart)
            .lte('scheduled_at', windowEnd)
            .order('scheduled_at', { ascending: false })
            .limit(1);
          matchedCallId = byClientEmail?.[0]?.id ?? null;
        }
      }
    }
  }

  if (matchedCallId) {
    await serviceSupabase.from('calls').update(fathomFields).eq('id', matchedCallId);
    // Et la ligne qui dit à quel compte demander la vidéo (cf. call_recordings).
    await serviceSupabase.from('call_recordings').upsert({
      call_id: matchedCallId,
      profile_id: profilEnregistreur,
      fathom_recording_id: recordingId,
      fathom_share_url: payload.share_url || null,
      recorded_at: payload.recording_start_time || null,
    }, { onConflict: 'fathom_recording_id' });
    return NextResponse.json({ ok: true, matched: true, call_id: matchedCallId });
  }

  // 3. Aucun match — on ne crée jamais de call automatiquement (décision produit),
  // l'enregistrement atterrit dans la liste "non rattachés" pour rattachement manuel.
  const profileId = profilEnregistreur;

  if (!profileId) {
    await logDebug('[webhook/fathom] impossible de résoudre le profil', { recording_id: recordingId, recorded_by: payload.recorded_by });
    return NextResponse.json({ ok: true });
  }

  await serviceSupabase.from('fathom_unmatched').upsert({
    profile_id: profileId,
    fathom_recording_id: recordingId,
    fathom_share_url: payload.share_url || null,
    fathom_summary: payload.summary || null,
    fathom_action_items: payload.action_items ?? null,
    fathom_transcript: payload.transcript ? JSON.stringify(payload.transcript) : null,
    meeting_title: payload.meeting_title || null,
    meeting_url: payload.meeting_url || null,
    calendar_invitees: payload.calendar_invitees ?? null,
    recording_start_time: payload.recording_start_time || null,
  }, { onConflict: 'fathom_recording_id' });

  return NextResponse.json({ ok: true, matched: false });
}
