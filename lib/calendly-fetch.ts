import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Token Calendly avec refresh ───────────────────────────────────────────────

export async function getCalendlyToken(profileId: string): Promise<string | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId)
    .eq('provider', 'calendly')
    .single();

  if (!integ?.access_token) return null;

  const expired = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;

  if (!expired) return integ.access_token;
  if (!integ.refresh_token) return null;

  const credentials = Buffer.from(
    `${process.env.CALENDLY_CLIENT_ID}:${process.env.CALENDLY_CLIENT_SECRET}`
  ).toString('base64');

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

  await serviceSupabase.from('integrations').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || integ.refresh_token,
    expires_at: expiresAt,
  }).eq('profile_id', profileId).eq('provider', 'calendly');

  return data.access_token;
}

// ── Sync events Calendly pour un élève ───────────────────────────────────────
// Ne remonte que les events à partir de `connectedAt` pour éviter de compter
// des calls qui existaient avant que l'élève rejoigne Momentum.
// Utilise client_id = l'élève lui-même (pas coach_id).

export async function syncCalendlyEleve(
  profileId: string,
  connectedAt: string // ISO — date de connexion Calendly, sert de filtre min
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  const accessToken = await getCalendlyToken(profileId);
  if (!accessToken) return { synced: 0, errors: ['no_token'] };

  // Récupère l'URI Calendly de l'utilisateur
  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meData = await meRes.json();
  const userUri = meData?.resource?.uri;
  if (!userUri) return { synced: 0, errors: ['user_uri_not_found'] };

  // Stocke l'URI dans integrations.metadata pour ne pas refaire /users/me à chaque cron
  await serviceSupabase.from('integrations')
    .update({ metadata: { ...meData?.resource, user_uri: userUri } })
    .eq('profile_id', profileId)
    .eq('provider', 'calendly');

  // Pull uniquement les events depuis connected_at (filtre min_start_time)
  // + les 6 prochains mois (events futurs déjà bookés)
  const minStartTime = connectedAt;
  const maxStartTime = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  const eventsRes = await fetch(
    `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&count=100&min_start_time=${minStartTime}&max_start_time=${maxStartTime}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const eventsData = await eventsRes.json();
  const events: any[] = eventsData?.collection || [];

  // Aussi récupérer les events annulés récents (pour sync les no-shows)
  const canceledRes = await fetch(
    `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&status=canceled&count=50&min_start_time=${minStartTime}&max_start_time=${maxStartTime}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const canceledData = await canceledRes.json();
  const canceledEvents: any[] = canceledData?.collection || [];

  const allEvents = [...events, ...canceledEvents];

  let synced = 0;

  for (const event of allEvents) {
    try {
      const eventUuid = event.uri?.split('/').pop() || '';
      if (!eventUuid) continue;

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

      // Fetch invitees pour avoir email + tracking UTM
      const inviteesRes = await fetch(
        `https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const inviteesData = await inviteesRes.json();
      const invitees: any[] = inviteesData?.collection || [];
      const invitee = invitees[0] || null;

      const inviteeEmail = invitee?.email || null;
      const inviteeName = invitee?.name || null;
      const questionsAndAnswers = invitee?.questions_and_answers || null;
      const tracking = invitee?.tracking || null;
      const utmSource = tracking?.utm_source || null;
      const utmMedium = tracking?.utm_medium || null;
      const utmCampaign = tracking?.utm_campaign || null;
      const utmContent = tracking?.utm_content || null;
      const source = utmSource ? [utmSource, utmMedium].filter(Boolean).join('_') : null;

      // utm_campaign = "lead-{ig_user_id}" → résoudre l'ig_lead_id
      // utm_campaign = "prospect-{slug}" → fallback : cherche par prospect_link.ig_username
      const igUserIdFromUtm = utmCampaign?.startsWith('lead-') ? utmCampaign.slice(5) : null;
      const prospectSlugFromUtm = utmCampaign?.startsWith('prospect-') ? utmCampaign.slice(9) : null;
      const shortLinkPath = utmContent || null;

      // Détection reschedule : cancel l'ancien call et hérite ses données
      // CAS B : nouvel event avec old_invitee → on hérite depuis l'ancien call
      // CAS A : ancien event canceled avec rescheduled=true → on stocke new_invitee pour lien futur
      const oldInviteeUrl: string | null = invitee?.old_invitee || null;
      const isRescheduled: boolean = invitee?.rescheduled === true;
      const newInviteeUrl: string | null = invitee?.new_invitee || null;
      let inheritedIgLeadId: string | null = null;
      let inheritedProspectLinkId: string | null = null;
      let inheritedSource: string | null = null;
      let resolvedIgLeadId: string | null = null;
      let resolvedProspectLinkId: string | null = null;

      if (isCanceled && isRescheduled && newInviteeUrl) {
        // CAS A : cet event est l'ancien — on stocke new_invitee pour que le nouvel event
        // puisse hériter même si le cron l'attrape avant que old_invitee soit disponible
        await serviceSupabase.from('calls')
          .update({ status: 'cancelled', next_rescheduled_uri: newInviteeUrl })
          .eq('calendly_event_uuid', eventUuid);
      } else if (oldInviteeUrl) {
        // CAS B : cet event est le nouveau — on cherche l'ancien par old_invitee
        const oldEventUuid = oldInviteeUrl.split('/').at(-3) || null;
        if (oldEventUuid) {
          const { data: oldCall } = await serviceSupabase
            .from('calls')
            .select('id, ig_lead_id, prospect_link_id, source')
            .eq('calendly_event_uuid', oldEventUuid)
            .maybeSingle();
          if (oldCall) {
            inheritedIgLeadId = oldCall.ig_lead_id ?? null;
            inheritedProspectLinkId = oldCall.prospect_link_id ?? null;
            inheritedSource = oldCall.source ?? null;
            await serviceSupabase.from('calls')
              .update({ status: 'cancelled' })
              .eq('id', oldCall.id);
          }
        }
      }

      // Résoudre ig_lead_id via utm_campaign="lead-{ig_user_id}"
      if (igUserIdFromUtm) {
        const { data: leadRow } = await serviceSupabase
          .from('instagram_leads')
          .select('id')
          .eq('ig_user_id', igUserIdFromUtm)
          .eq('profile_id', profileId)
          .order('detected_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedIgLeadId = leadRow?.id ?? null;
      }

      // Résoudre prospect_link_id via utm_content = short_link_path
      if (shortLinkPath) {
        const { data: pl } = await serviceSupabase
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

      // Fallback : utm_campaign = "prospect-{slug}" (cold DM sans ig_user_id au moment de la génération)
      // On cherche le prospect_link par ig_username déduit du slug, puis le lead lié
      if (!resolvedIgLeadId && !resolvedProspectLinkId && prospectSlugFromUtm) {
        // Le slug est slugifié (tirets) → reconvertir en underscore pour matcher ig_username
        const guessedUsername = prospectSlugFromUtm.replace(/-/g, '_');
        const { data: pl } = await serviceSupabase
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
        // Si toujours pas de lead, chercher directement dans instagram_leads par username
        if (!resolvedIgLeadId) {
          const { data: leadRow } = await serviceSupabase
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

      // coach_id = hôte du call (profile_id du compte Calendly connecté — élève ou coach)
      // client_id = null (le lead/invité est externe, pas un utilisateur Momentum)
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
        source: source ?? inheritedSource,
        status: isCanceled ? 'canceled' : 'active',
        ready: 'pending',
        reminder_sent: false,
      };
      if (utmCampaign)          upsertData.utm_campaign    = utmCampaign;
      if (utmContent)           upsertData.utm_content     = utmContent;
      if (utmMedium)            upsertData.utm_medium      = utmMedium;
      if (shortLinkPath)        upsertData.short_link_path = shortLinkPath;
      if (finalIgLeadId)        upsertData.ig_lead_id      = finalIgLeadId;
      if (finalProspectLinkId)  upsertData.prospect_link_id = finalProspectLinkId;

      const { data: callRow } = await serviceSupabase.from('calls')
        .upsert(upsertData, { onConflict: 'calendly_event_uuid', ignoreDuplicates: false })
        .select('id, ig_lead_id')
        .maybeSingle();

      // Écrire call_booked dans prospect_events si lead résolu et call actif
      // prospect_events_call_event_uidx est un index partiel (WHERE call_id IS NOT NULL)
      // → onConflict incompatible avec Supabase → select + insert conditionnel
      // Fallback : si finalIgLeadId null mais que le call avait déjà un ig_lead_id en DB, l'utiliser
      const effectiveIgLeadId = finalIgLeadId ?? callRow?.ig_lead_id ?? null;
      if (!isCanceled && callRow?.id && effectiveIgLeadId) {
        const { data: igLead } = await serviceSupabase
          .from('instagram_leads').select('ig_username').eq('id', effectiveIgLeadId).single();
        if (igLead) {
          const { data: existingEvt } = await serviceSupabase
            .from('prospect_events')
            .select('id')
            .eq('call_id', callRow.id)
            .eq('event_type', 'call_booked')
            .maybeSingle();
          if (!existingEvt) {
            serviceSupabase.from('prospect_events').insert({
              profile_id:       profileId,
              prospect_key:     igLead.ig_username.toLowerCase(),
              platform:         'ig',
              event_type:       'call_booked',
              occurred_at:      scheduledAt ?? new Date().toISOString(),
              ig_lead_id:       effectiveIgLeadId,
              prospect_link_id: finalProspectLinkId,
              call_id:          callRow.id,
            }).then(({ error: evtErr }) => {
              if (evtErr) console.error('[calendly-fetch] prospect_events call_booked:', evtErr.message);
            });
          }
          // Lier le lead au call dans l'autre sens
          await serviceSupabase.from('instagram_leads')
            .update({ calendly_event_uuid: eventUuid })
            .eq('id', effectiveIgLeadId);
        }
      }

      // Call annulé : faire reculer le lead dans le pipeline (même logique que webhook invitee.canceled)
      if (isCanceled && callRow?.ig_lead_id) {
        const { data: leadRow } = await serviceSupabase
          .from('instagram_leads').select('ig_username, profile_id').eq('id', callRow.ig_lead_id).single();
        if (leadRow) {
          const { data: eventsRows } = await serviceSupabase
            .from('prospect_events')
            .select('event_type')
            .eq('profile_id', leadRow.profile_id)
            .eq('prospect_key', leadRow.ig_username.toLowerCase())
            .eq('platform', 'ig')
            .order('occurred_at', { ascending: false });

          let bestStage = 'lm_sent';
          if (eventsRows?.some((e: any) => e.event_type === 'link_clicked')) bestStage = 'link_clicked';
          else if (eventsRows?.some((e: any) => e.event_type === 'calendly_link_sent')) bestStage = 'calendly_sent';

          await serviceSupabase.from('pipeline_overrides').upsert({
            profile_id: leadRow.profile_id,
            prospect_key: leadRow.ig_username.toLowerCase(),
            platform: 'ig',
            stage: bestStage,
            reason: 'canceled',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'profile_id,prospect_key,platform' });
        }
      }

      synced++;
    } catch (e: any) {
      errors.push(`event_error: ${e?.message || 'unknown'}`);
    }
  }

  return { synced, errors };
}
