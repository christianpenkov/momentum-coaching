import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// ⚠️ L'empreinte du code SOURCE de cette fonction, pour que `edge_sante_version` puisse
// dire si la version en ligne est celle du depot. Une Edge Function ne part pas avec
// `git push` : le 2026-09-03, `poll-leads` a tourne deux jours avec du code vieux de huit
// commits, et rien ne pouvait le voir — `crons_passages` prouve qu'un cron TOURNE, jamais
// qu'il tourne le BON code.
//
// Le fichier est genere par `scripts/empreintes-edge.mjs`, rejoue par
// `npm run deployer-edge <nom>` juste avant l'envoi : la valeur figee dans le bundle est
// donc celle du code reellement deploye.
import { EMPREINTES_EDGE } from '../../../lib/empreintes-edge.generated.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const FATHOM_CLIENT_ID = Deno.env.get('FATHOM_CLIENT_ID') || '';
const FATHOM_CLIENT_SECRET = Deno.env.get('FATHOM_CLIENT_SECRET') || '';

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';
const MATCH_WINDOW_MINUTES = 30;
// Fenêtre glissante — /meetings n'a pas de filtre "non traité", seulement created_after.
const LOOKBACK_HOURS = 48;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function logDebug(message: string, data: Record<string, unknown>) {
  await supabase.from('webhook_debug_log').insert({ message, data });
}

// Réécriture Deno de lib/fathom-auth.ts:getFathomToken — Edge Functions ne peuvent pas
// importer depuis lib/ (runtime Deno différent de Next.js), même pattern de duplication
// déjà accepté ailleurs dans ce repo (ex. getCalendlyToken dans sync-calendly/index.ts).
async function getFathomToken(profileId: string): Promise<string | null> {
  const { data: integ } = await supabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId)
    .eq('provider', 'fathom')
    .single();

  if (!integ?.access_token) return null;

  const expired = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;

  if (!expired) return integ.access_token;
  if (!integ.refresh_token || !FATHOM_CLIENT_ID || !FATHOM_CLIENT_SECRET) return integ.access_token;

  const res = await fetch('https://fathom.video/external/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integ.refresh_token,
      client_id: FATHOM_CLIENT_ID,
      client_secret: FATHOM_CLIENT_SECRET,
    }),
  });

  const data = await res.json();
  if (!data.access_token) return null;

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  await supabase.from('integrations').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || integ.refresh_token,
    expires_at: expiresAt,
  }).eq('profile_id', profileId).eq('provider', 'fathom');

  return data.access_token;
}

interface FathomMeeting {
  recording_id: number;
  share_url?: string;
  meeting_url?: string;
  meeting_title?: string;
  calendar_invitees?: { name?: string; email?: string }[];
  recorded_by?: { email?: string; name?: string };
  scheduled_start_time?: string;
  recording_start_time?: string;
}

// Réécriture Deno de la logique de matching de app/api/webhooks/fathom/route.ts —
// même ordre de priorité (URL exacte → email+créneau → fathom_unmatched), mais ici
// profileId est déjà connu (on boucle sur integrations.provider='fathom'), donc pas
// besoin de résoudre via recorded_by.email comme le fait le webhook pour le cas orphelin.
async function matchAndStore(
  meeting: FathomMeeting,
  profileId: string,
  transcript: unknown,
  summary: string | null,
  actionItems: unknown
): Promise<'matched' | 'unmatched' | 'skipped'> {
  const recordingId = String(meeting.recording_id);

  // Idempotence : call_recordings et non calls. Depuis qu'un call peut porter
  // DEUX enregistrements (les deux bots présents), calls.fathom_recording_id ne
  // connaît que le premier et laisserait repasser le second à chaque tour de cron.
  const { data: dejaTraite } = await supabase
    .from('call_recordings')
    .select('call_id')
    .eq('fathom_recording_id', recordingId)
    .maybeSingle();
  if (dejaTraite) return 'skipped';

  const { data: alreadyUnmatched } = await supabase
    .from('fathom_unmatched')
    .select('id')
    .eq('fathom_recording_id', recordingId)
    .maybeSingle();
  if (alreadyUnmatched) return 'skipped';

  const fathomFields = {
    fathom_recording_id: recordingId,
    fathom_share_url: meeting.share_url || null,
    fathom_summary: summary || null,
    fathom_action_items: actionItems ?? null,
    fathom_transcript: transcript ? JSON.stringify(transcript) : null,
    fathom_status: 'matched' as const,
    fathom_matched_at: new Date().toISOString(),
  };

  let matchedCallId: string | null = null;

  // 0. Le SECOND bot sur une réunion déjà rattachée — voir le commentaire détaillé
  // dans app/api/webhooks/fathom/route.ts, dont ceci est la contrepartie Deno.
  // Ici profileId est déjà connu : on boucle sur les intégrations Fathom, donc
  // l'enregistrement appartient forcément au compte en cours de synchronisation.
  //
  // Le filtre `fathom_recording_id IS NULL` n'est levé que sur l'URL exacte, pas
  // sur le repli email+créneau : deux calls successifs avec la même personne
  // tombent dans la même fenêtre de 30 min et ce filtre est ce qui les sépare.
  if (meeting.meeting_url) {
    const { data: memeReunion } = await supabase
      .from('calls')
      .select('id')
      .neq('status', 'canceled')
      .not('fathom_recording_id', 'is', null)
      .or(`join_url.eq.${meeting.meeting_url},meet_link.eq.${meeting.meeting_url}`)
      .order('scheduled_at', { ascending: false })
      .limit(1);

    if (memeReunion?.[0]?.id) {
      // Le call garde son enregistrement d'origine : résumé et transcription
      // affichés ne changent pas. On n'ajoute que de quoi retrouver cette copie.
      await supabase.from('call_recordings').upsert({
        call_id: memeReunion[0].id,
        profile_id: profileId,
        fathom_recording_id: recordingId,
        fathom_share_url: meeting.share_url || null,
        recorded_at: meeting.recording_start_time || null,
      }, { onConflict: 'fathom_recording_id' });
      return 'matched';
    }
  }

  // 1. Matching prioritaire : URL de jonction exacte
  if (meeting.meeting_url) {
    const { data: byUrl } = await supabase
      .from('calls')
      .select('id, scheduled_at')
      .neq('status', 'canceled')
      .is('fathom_recording_id', null)
      .or(`join_url.eq.${meeting.meeting_url},meet_link.eq.${meeting.meeting_url}`)
      .order('scheduled_at', { ascending: false })
      .limit(1);
    matchedCallId = byUrl?.[0]?.id ?? null;
  }

  // 2. Fallback : email invité + créneau horaire proche
  if (!matchedCallId && meeting.calendar_invitees?.length) {
    const invitees = meeting.calendar_invitees.map(i => i.email).filter(Boolean) as string[];
    const referenceTime = meeting.scheduled_start_time || meeting.recording_start_time;

    if (invitees.length && referenceTime) {
      const refDate = new Date(referenceTime);
      const windowStart = new Date(refDate.getTime() - MATCH_WINDOW_MINUTES * 60000).toISOString();
      const windowEnd = new Date(refDate.getTime() + MATCH_WINDOW_MINUTES * 60000).toISOString();

      const { data: byInviteeEmail } = await supabase
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

      if (!matchedCallId) {
        const { data: clientRows } = await supabase
          .from('clients')
          .select('id')
          .in('email', invitees);
        const clientIds = (clientRows || []).map((c: any) => c.id);
        if (clientIds.length) {
          const { data: byClientEmail } = await supabase
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
    await supabase.from('calls').update(fathomFields).eq('id', matchedCallId);
    // Et la ligne qui dit à quel compte demander la vidéo (cf. call_recordings).
    await supabase.from('call_recordings').upsert({
      call_id: matchedCallId,
      profile_id: profileId,
      fathom_recording_id: recordingId,
      fathom_share_url: meeting.share_url || null,
      recorded_at: meeting.recording_start_time || null,
    }, { onConflict: 'fathom_recording_id' });
    return 'matched';
  }

  // 3. Aucun match — jamais de call créé automatiquement, va en fathom_unmatched
  await supabase.from('fathom_unmatched').upsert({
    profile_id: profileId,
    fathom_recording_id: recordingId,
    fathom_share_url: meeting.share_url || null,
    fathom_summary: summary || null,
    fathom_action_items: actionItems ?? null,
    fathom_transcript: transcript ? JSON.stringify(transcript) : null,
    meeting_title: meeting.meeting_title || null,
    meeting_url: meeting.meeting_url || null,
    calendar_invitees: meeting.calendar_invitees ?? null,
    recording_start_time: meeting.recording_start_time || null,
  }, { onConflict: 'fathom_recording_id' });

  return 'unmatched';
}

async function syncFathomProfile(profileId: string): Promise<{ checked: number; matched: number; unmatched: number; errors: string[] }> {
  const errors: string[] = [];
  const accessToken = await getFathomToken(profileId);
  if (!accessToken) return { checked: 0, matched: 0, unmatched: 0, errors: ['no_token'] };

  const createdAfter = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  // include_transcript/include_summary sont refusés par Fathom pour les apps OAuth sur
  // /meetings (confirmé par appel réel : "OAuth users are not allowed to include summary
  // or transcript in this request. Please use /recordings endpoint instead.") —
  // include_action_items, lui, passe sans erreur. Transcript/summary récupérés ensuite
  // séparément par recording_id via /recordings/{id}/transcript et /summary (les deux
  // confirmés fonctionnels en OAuth par appel réel).
  const meetingsRes = await fetch(
    `${FATHOM_API_BASE}/meetings?created_after=${encodeURIComponent(createdAfter)}&include_action_items=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!meetingsRes.ok) {
    const err = await meetingsRes.text().catch(() => '');
    errors.push(`meetings_fetch_failed: ${meetingsRes.status} ${err}`);
    return { checked: 0, matched: 0, unmatched: 0, errors };
  }

  const meetingsData = await meetingsRes.json();
  const meetings: (FathomMeeting & { action_items?: unknown })[] = meetingsData?.items || [];

  let matched = 0;
  let unmatched = 0;

  for (const meeting of meetings) {
    try {
      const recordingId = meeting.recording_id;

      const [transcriptRes, summaryRes] = await Promise.all([
        fetch(`${FATHOM_API_BASE}/recordings/${recordingId}/transcript`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${FATHOM_API_BASE}/recordings/${recordingId}/summary`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);

      const transcriptData = transcriptRes.ok ? await transcriptRes.json().catch(() => null) : null;
      const summaryData = summaryRes.ok ? await summaryRes.json().catch(() => null) : null;

      const transcript = transcriptData?.transcript?.length ? transcriptData.transcript : null;
      const summary = summaryData?.summary || null;

      const result = await matchAndStore(meeting, profileId, transcript, summary, meeting.action_items ?? null);
      if (result === 'matched') matched++;
      if (result === 'unmatched') unmatched++;
    } catch (e) {
      errors.push(`recording_${meeting.recording_id}: ${(e as Error)?.message || 'unknown'}`);
    }
  }

  return { checked: meetings.length, matched, unmatched, errors };
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 });
  }

  // Filigrane de passage : la preuve que ce cron est encore INVOQUE.
  //
  // Pose AU PLUS TOT, juste apres l'authentification, et non a la fin. La question que
  // pose `crons_sante` est « le planificateur appelle-t-il encore cette URL ? » — c'est
  // la panne invisible de la plateforme : un cron qui ne tourne plus n'echoue pas, il
  // se tait, et un silence ne se distingue pas d'un succes.
  //
  // Un echec SURVENU PENDANT l'execution est deja couvert par `cron_runs`, et les deux
  // ne doivent pas se recouvrir. Marquer a la fin ferait en plus passer un simple
  // depassement de temps pour une mort du cron — une fausse alerte, c'est-a-dire le
  // debut d'une alerte qu'on n'ouvre plus.
  //
  // Le seuil de silence vit sur la LIGNE (`crons_passages.silence_max`), pas ici : la
  // RPC ne met a jour que l'horodatage, donc changer la cadence de ce cron se repercute
  // en base sans toucher au code.
  //
  // Strictement non bloquant : un filigrane muet vaut mieux qu'un cron qui tombe.
  try {
    const { error: filigraneErr } = await supabase.rpc('marquer_passage_cron', { p_nom: 'fathom-cron-sync', p_empreinte: EMPREINTES_EDGE['fathom-cron-sync'] });
    if (filigraneErr) console.error('[fathom-cron-sync] filigrane de passage:', filigraneErr.message);
  } catch (e) { console.error('[fathom-cron-sync] filigrane de passage:', e); }

  const { data: integrations } = await supabase
    .from('integrations')
    .select('profile_id')
    .eq('provider', 'fathom');

  if (!integrations?.length) {
    return new Response(JSON.stringify({ ok: true, checked: 0, profiles: 0 }), { status: 200 });
  }

  const results = await Promise.all(
    integrations.map((integ: any) =>
      syncFathomProfile(integ.profile_id)
        .then(r => ({ profile_id: integ.profile_id, ...r }))
        .catch((e: any) => ({ profile_id: integ.profile_id, checked: 0, matched: 0, unmatched: 0, errors: [e?.message || 'unknown'] }))
    )
  );

  const totals = results.reduce((acc, r) => ({
    checked: acc.checked + r.checked,
    matched: acc.matched + r.matched,
    unmatched: acc.unmatched + r.unmatched,
  }), { checked: 0, matched: 0, unmatched: 0 });

  const allErrors: Record<string, string[]> = {};
  for (const r of results) {
    if (r.errors.length) allErrors[r.profile_id] = r.errors;
  }

  if (Object.keys(allErrors).length) {
    await logDebug('[fathom-cron-sync] erreurs de synchronisation', allErrors);
  }

  return new Response(JSON.stringify({
    ok: true,
    profiles: integrations.length,
    ...totals,
    errors: allErrors,
  }), { status: 200 });
});
