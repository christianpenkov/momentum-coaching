import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const CALENDLY_CLIENT_ID = Deno.env.get('CALENDLY_CLIENT_ID') || '';
const CALENDLY_CLIENT_SECRET = Deno.env.get('CALENDLY_CLIENT_SECRET') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getCalendlyToken(profileId: string): Promise<string | null> {
  const { data: integ } = await supabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId)
    .eq('provider', 'calendly')
    .single();

  if (!integ?.access_token) return null;

  const expired = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;

  if (!expired) return integ.access_token;
  // Pas de refresh possible sans credentials → retourner le token existant (peut être expiré côté Calendly)
  if (!integ.refresh_token || !CALENDLY_CLIENT_ID || !CALENDLY_CLIENT_SECRET) return integ.access_token;

  const credentials = btoa(`${CALENDLY_CLIENT_ID}:${CALENDLY_CLIENT_SECRET}`);
  const res = await fetch('https://auth.calendly.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integ.refresh_token,
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
  }).eq('profile_id', profileId).eq('provider', 'calendly');

  return data.access_token;
}

async function syncCalendlyEleve(
  profileId: string,
  connectedAt: string
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  const accessToken = await getCalendlyToken(profileId);
  if (!accessToken) return { synced: 0, errors: ['no_token'] };

  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meData = await meRes.json();
  const userUri = meData?.resource?.uri;
  if (!userUri) return { synced: 0, errors: ['user_uri_not_found'] };

  await supabase.from('integrations')
    .update({ metadata: { ...meData?.resource, user_uri: userUri } })
    .eq('profile_id', profileId)
    .eq('provider', 'calendly');

  const minStartTime = connectedAt;
  const maxStartTime = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch events actifs + annulés en parallèle
  const [eventsRes, canceledRes] = await Promise.all([
    fetch(
      `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&count=100&min_start_time=${minStartTime}&max_start_time=${maxStartTime}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    ),
    fetch(
      `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&status=canceled&count=50&min_start_time=${minStartTime}&max_start_time=${maxStartTime}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    ),
  ]);

  const eventsData = await eventsRes.json();
  const canceledData = await canceledRes.json();
  const allEvents = [
    ...(eventsData?.collection || []),
    ...(canceledData?.collection || []),
  ];

  // Parallélise tous les appels invitees — critique pour ne pas dépasser 150s
  const results = await Promise.allSettled(allEvents.map(async (event: any) => {
    const eventUuid = event.uri?.split('/').pop() || '';
    if (!eventUuid) return false;

    const scheduledAt = event.start_time || null;
    const endTime = event.end_time || null;
    const isCanceled = event.status === 'canceled';

    let duration: string | null = null;
    if (scheduledAt && endTime) {
      const mins = Math.round(
        (new Date(endTime).getTime() - new Date(scheduledAt).getTime()) / 60000
      );
      duration = `${mins} min`;
    }

    const inviteesRes = await fetch(
      `https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const inviteesData = await inviteesRes.json();
    const invitees: any[] = inviteesData?.collection || [];
    const invitee = invitees[0] || null;

    const inviteeEmail = invitee?.email || null;
    const inviteeName = invitee?.name || null;
    const bookedAt = invitee?.created_at || null;
    const questionsAndAnswers = invitee?.questions_and_answers || null;
    const tracking = invitee?.tracking || null;
    const utmSource = tracking?.utm_source || null;
    const utmMedium = tracking?.utm_medium || null;
    const utmCampaign = tracking?.utm_campaign || null;
    const utmContent = tracking?.utm_content || null;
    const source = utmSource ? [utmSource, utmMedium].filter(Boolean).join('_') : null;

    const igUserIdFromUtm = utmCampaign?.startsWith('lead-') ? utmCampaign.slice(5) : null;
    const prospectSlugFromUtm = utmCampaign?.startsWith('prospect-') ? utmCampaign.slice(9) : null;
    const shortLinkPath = utmContent || null;

    const oldInviteeUrl: string | null = invitee?.old_invitee || null;
    const isRescheduled: boolean = invitee?.rescheduled === true;
    const newInviteeUrl: string | null = invitee?.new_invitee || null;
    let inheritedIgLeadId: string | null = null;
    let inheritedProspectLinkId: string | null = null;
    let inheritedSource: string | null = null;
    let resolvedIgLeadId: string | null = null;
    let resolvedProspectLinkId: string | null = null;

    if (isCanceled && isRescheduled && newInviteeUrl) {
      await supabase.from('calls')
        .update({ status: 'cancelled', next_rescheduled_uri: newInviteeUrl })
        .eq('calendly_event_uuid', eventUuid);
    } else if (oldInviteeUrl) {
      const oldEventUuid = oldInviteeUrl.split('/').at(-3) || null;
      if (oldEventUuid) {
        const { data: oldCall } = await supabase
          .from('calls')
          .select('id, ig_lead_id, prospect_link_id, source')
          .eq('calendly_event_uuid', oldEventUuid)
          .maybeSingle();
        if (oldCall) {
          inheritedIgLeadId = oldCall.ig_lead_id ?? null;
          inheritedProspectLinkId = oldCall.prospect_link_id ?? null;
          inheritedSource = oldCall.source ?? null;
          await supabase.from('calls')
            .update({ status: 'cancelled' })
            .eq('id', oldCall.id);
        }
      }
    }

    if (igUserIdFromUtm) {
      const { data: leadRow } = await supabase
        .from('instagram_leads')
        .select('id')
        .eq('ig_user_id', igUserIdFromUtm)
        .eq('profile_id', profileId)
        .order('detected_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      resolvedIgLeadId = leadRow?.id ?? null;
    }

    if (shortLinkPath) {
      const { data: pl } = await supabase
        .from('prospect_links')
        .select('id, ig_lead_id')
        .eq('profile_id', profileId)
        .filter('short_url', 'like', `%/${shortLinkPath}`)
        .maybeSingle();
      if (pl) {
        resolvedProspectLinkId = pl.id;
        resolvedIgLeadId = resolvedIgLeadId ?? pl.ig_lead_id ?? null;
      }
    }

    if (!resolvedIgLeadId && !resolvedProspectLinkId && prospectSlugFromUtm) {
      const guessedUsername = prospectSlugFromUtm.replace(/-/g, '_');
      const { data: pl } = await supabase
        .from('prospect_links')
        .select('id, ig_lead_id, ig_username')
        .eq('profile_id', profileId)
        .or(`ig_username.eq.${guessedUsername},ig_username.eq.${prospectSlugFromUtm}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pl) {
        resolvedProspectLinkId = pl.id;
        resolvedIgLeadId = pl.ig_lead_id ?? null;
      }
      if (!resolvedIgLeadId) {
        const { data: leadRow } = await supabase
          .from('instagram_leads')
          .select('id')
          .eq('profile_id', profileId)
          .or(`ig_username.eq.${guessedUsername},ig_username.eq.${prospectSlugFromUtm}`)
          .order('detected_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedIgLeadId = leadRow?.id ?? null;
      }
    }

    const finalIgLeadId = resolvedIgLeadId ?? inheritedIgLeadId;
    const finalProspectLinkId = resolvedProspectLinkId ?? inheritedProspectLinkId;

    const upsertData: Record<string, any> = {
      coach_id: profileId,
      client_id: null,
      call_type: 'calendly',
      calendly_event_uuid: eventUuid,
      calendly_uri: event.uri,
      topic: event.name || 'Appel découverte',
      scheduled_at: scheduledAt,
      duration,
      join_url: event.location?.join_url || null,
      invitee_email: inviteeEmail,
      invitee_name: inviteeName,
      calendly_qa: questionsAndAnswers,
      source: finalIgLeadId ? 'ig_dm' : (source ?? inheritedSource),
      status: isCanceled ? 'canceled' : 'active',
      ready: 'pending',
      reminder_sent: false,
    };
    if (utmCampaign)         upsertData.utm_campaign    = utmCampaign;
    if (utmContent)          upsertData.utm_content     = utmContent;
    if (utmMedium)           upsertData.utm_medium      = utmMedium;
    if (shortLinkPath)       upsertData.short_link_path = shortLinkPath;
    if (finalProspectLinkId) upsertData.prospect_link_id = finalProspectLinkId;
    if (bookedAt)            upsertData.booked_at       = bookedAt;

    if (finalIgLeadId) {
      const { data: existingCall } = await supabase.from('calls')
        .select('ig_lead_id, short_link_path')
        .eq('calendly_event_uuid', eventUuid)
        .maybeSingle();
      const alreadyResolved = existingCall && (existingCall.ig_lead_id || existingCall.short_link_path);
      if (!alreadyResolved) {
        upsertData.ig_lead_id = finalIgLeadId;
      }
    }

    const { data: callRow } = await supabase.from('calls')
      .upsert(upsertData, { onConflict: 'calendly_event_uuid', ignoreDuplicates: false })
      .select('id, ig_lead_id')
      .maybeSingle();

    const effectiveIgLeadId = finalIgLeadId ?? callRow?.ig_lead_id ?? null;
    if (!isCanceled && callRow?.id && effectiveIgLeadId) {
      const { data: igLead } = await supabase
        .from('instagram_leads').select('ig_username').eq('id', effectiveIgLeadId).single();
      if (igLead) {
        const { data: existingEvt } = await supabase
          .from('prospect_events')
          .select('id')
          .eq('call_id', callRow.id)
          .eq('event_type', 'call_booked')
          .maybeSingle();
        if (!existingEvt) {
          supabase.from('prospect_events').insert({
            profile_id:       profileId,
            prospect_key:     igLead.ig_username.toLowerCase(),
            platform:         'ig',
            event_type:       'call_booked',
            occurred_at:      scheduledAt ?? new Date().toISOString(),
            ig_lead_id:       effectiveIgLeadId,
            prospect_link_id: finalProspectLinkId,
            call_id:          callRow.id,
          }).then(({ error: evtErr }: any) => {
            if (evtErr) console.error('[sync-calendly] prospect_events:', evtErr.message);
          });
        }
        await supabase.from('instagram_leads')
          .update({ calendly_event_uuid: eventUuid })
          .eq('id', effectiveIgLeadId);
      }
    }

    if (isCanceled && callRow?.ig_lead_id) {
      const { data: leadRow } = await supabase
        .from('instagram_leads').select('ig_username, profile_id').eq('id', callRow.ig_lead_id).single();
      if (leadRow) {
        const { data: eventsRows } = await supabase
          .from('prospect_events')
          .select('event_type')
          .eq('profile_id', leadRow.profile_id)
          .eq('prospect_key', leadRow.ig_username.toLowerCase())
          .eq('platform', 'ig')
          .order('occurred_at', { ascending: false });

        let bestStage = 'lm_sent';
        if (eventsRows?.some((e: any) => e.event_type === 'link_clicked')) bestStage = 'link_clicked';
        else if (eventsRows?.some((e: any) => e.event_type === 'calendly_link_sent')) bestStage = 'calendly_sent';

        await supabase.from('pipeline_overrides').upsert({
          profile_id: leadRow.profile_id,
          prospect_key: leadRow.ig_username.toLowerCase(),
          platform: 'ig',
          stage: bestStage,
          reason: 'canceled',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'profile_id,prospect_key,platform' });
      }
    }

    return true;
  }));

  const synced = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
  results.forEach(r => {
    if (r.status === 'rejected') errors.push(`event_error: ${r.reason?.message || 'unknown'}`);
  });

  return { synced, errors };
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 });
  }

  const { data: integrations } = await supabase
    .from('integrations')
    .select('profile_id, connected_at, profiles!inner(role)')
    .eq('provider', 'calendly')
    .eq('profiles.role', 'client');

  if (!integrations?.length) {
    return new Response(JSON.stringify({ ok: true, synced: 0, profiles: 0 }), { status: 200 });
  }

  // Tous les profils en parallèle — 150s de timeout = largement suffisant pour 20 élèves
  const results = await Promise.all(
    integrations.map((integ: any) => {
      const connectedAt = integ.connected_at || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      return syncCalendlyEleve(integ.profile_id, connectedAt)
        .then(r => ({ profile_id: integ.profile_id, ...r }))
        .catch((e: any) => ({ profile_id: integ.profile_id, synced: 0, errors: [e?.message || 'unknown'] }));
    })
  );

  const totalSynced = results.reduce((acc, r) => acc + r.synced, 0);
  const allErrors: Record<string, string[]> = {};
  for (const r of results) {
    if (r.errors.length) allErrors[r.profile_id] = r.errors;
  }

  return new Response(JSON.stringify({
    ok: true,
    synced: totalSynced,
    profiles: integrations.length,
    errors: allErrors,
  }), { status: 200 });
});
