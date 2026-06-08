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
      const source = utmSource ? [utmSource, utmMedium].filter(Boolean).join('_') : null;

      // coach_id = profileId de l'élève (hôte du call)
      // client_id = null (le lead est externe)
      await serviceSupabase.from('calls').upsert({
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
        source,
        status: isCanceled ? 'canceled' : 'active',
        ready: 'pending',
        reminder_sent: false,
      }, { onConflict: 'calendly_event_uuid', ignoreDuplicates: false });

      synced++;
    } catch (e: any) {
      errors.push(`event_error: ${e?.message || 'unknown'}`);
    }
  }

  return { synced, errors };
}
