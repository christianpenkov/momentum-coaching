import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const safeJson = async (res: Response) => {
  try { return { status: res.status, ok: res.ok, data: await res.json() }; }
  catch { return { status: res.status, ok: res.ok, data: null }; }
};

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', user.id)
    .eq('provider', 'calendly')
    .single();

  if (!integ?.access_token) return NextResponse.json({ error: 'Pas de token Calendly' }, { status: 404 });

  // Refresh si expiré
  let token = integ.access_token;
  const expired = integ.expires_at && new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;
  if (expired && integ.refresh_token) {
    const credentials = Buffer.from(`${process.env.CALENDLY_CLIENT_ID}:${process.env.CALENDLY_CLIENT_SECRET}`).toString('base64');
    const refreshRes = await fetch('https://auth.calendly.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credentials}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: integ.refresh_token }),
    });
    const refreshData = await refreshRes.json();
    if (refreshData.access_token) {
      token = refreshData.access_token;
      await serviceSupabase.from('integrations').update({
        access_token: token,
        refresh_token: refreshData.refresh_token || integ.refresh_token,
        expires_at: refreshData.expires_in ? new Date(Date.now() + refreshData.expires_in * 1000).toISOString() : null,
      }).eq('profile_id', user.id).eq('provider', 'calendly');
    } else {
      return NextResponse.json({ error: 'Refresh token échoué — reconnecte Calendly dans les réglages', refreshError: refreshData }, { status: 401 });
    }
  }
  const h = { Authorization: `Bearer ${token}` };

  // Étape 1 — /users/me pour récupérer userUri + orgUri
  const meRes = await fetch('https://api.calendly.com/users/me', { headers: h });
  const meData = await meRes.json();
  const userUri = meData?.resource?.uri;
  const orgUri = meData?.resource?.current_organization;

  if (!userUri) return NextResponse.json({ error: 'userUri introuvable', meData }, { status: 400 });

  const userUuid = userUri.split('/').pop();
  const orgUuid = orgUri?.split('/').pop();

  // Étape 2 — tous les endpoints en parallèle
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const [
    eventTypesRes,
    scheduledEventsRes,
    scheduledEventsPastRes,
    orgMembershipsRes,
    routingFormsRes,
    webhooksRes,
    activityLogRes,
  ] = await Promise.all([
    // Types d'événements créés par l'utilisateur
    fetch(`https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}&count=100`, { headers: h }),
    // Événements futurs actifs
    fetch(`https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&status=active&count=100&min_start_time=${now}`, { headers: h }),
    // Événements passés (30 derniers jours)
    fetch(`https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&status=active&count=100&min_start_time=${since30d}&max_start_time=${now}`, { headers: h }),
    // Membres de l'organisation
    orgUuid ? fetch(`https://api.calendly.com/organization_memberships?organization=${encodeURIComponent(orgUri)}&count=100`, { headers: h }) : Promise.resolve(new Response(JSON.stringify({ skipped: true }))),
    // Routing forms (si disponible)
    orgUuid ? fetch(`https://api.calendly.com/routing_forms?organization=${encodeURIComponent(orgUri)}&count=100`, { headers: h }) : Promise.resolve(new Response(JSON.stringify({ skipped: true }))),
    // Webhooks actifs
    fetch(`https://api.calendly.com/webhook_subscriptions?organization=${encodeURIComponent(orgUri)}&scope=organization&count=100`, { headers: h }),
    // Activity log (org-level, peut nécessiter plan pro)
    orgUuid ? fetch(`https://api.calendly.com/activity_log_entries?organization=${encodeURIComponent(orgUri)}&count=20`, { headers: h }) : Promise.resolve(new Response(JSON.stringify({ skipped: true }))),
  ]);

  const [
    eventTypes,
    scheduledFuture,
    scheduledPast,
    orgMemberships,
    routingForms,
    webhooks,
    activityLog,
  ] = await Promise.all([
    safeJson(eventTypesRes),
    safeJson(scheduledEventsRes),
    safeJson(scheduledEventsPastRes),
    safeJson(orgMembershipsRes),
    safeJson(routingFormsRes),
    safeJson(webhooksRes),
    safeJson(activityLogRes),
  ]);

  // Étape 3 — pour un événement passé, récupère les invitées + no-shows
  let sampleEventDetails: any = null;
  const pastEvents = scheduledPast.data?.collection || [];
  if (pastEvents.length > 0) {
    const sampleEvent = pastEvents[0];
    const eventUuid = sampleEvent.uri?.split('/').pop();
    const [inviteesRes, noShowRes] = await Promise.all([
      fetch(`https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10`, { headers: h }),
      fetch(`https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10&status=declined`, { headers: h }),
    ]);
    const [invitees, noShows] = await Promise.all([safeJson(inviteesRes), safeJson(noShowRes)]);

    // Détail de l'event type associé
    const eventTypeUri = sampleEvent.event_type;
    let eventTypeDetail: any = null;
    if (eventTypeUri) {
      const etUuid = eventTypeUri.split('/').pop();
      const etRes = await fetch(`https://api.calendly.com/event_types/${etUuid}`, { headers: h });
      eventTypeDetail = await safeJson(etRes);
    }

    sampleEventDetails = {
      event: sampleEvent,
      invitees,
      noShows,
      eventTypeDetail,
    };
  }

  // Étape 4 — détail d'un event type (questions personnalisées, disponibilités)
  let sampleEventTypeDetail: any = null;
  const etList = eventTypes.data?.collection || [];
  if (etList.length > 0) {
    const etUuid = etList[0].uri?.split('/').pop();
    const [etDetailRes, etAvailRes] = await Promise.all([
      fetch(`https://api.calendly.com/event_types/${etUuid}`, { headers: h }),
      fetch(`https://api.calendly.com/event_type_available_times?event_type=${encodeURIComponent(etList[0].uri)}&start_time=${now}&end_time=${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()}`, { headers: h }),
    ]);
    sampleEventTypeDetail = {
      detail: await safeJson(etDetailRes),
      availableTimes: await safeJson(etAvailRes),
    };
  }

  return NextResponse.json({
    _meta: {
      userUri,
      orgUri,
      userUuid,
      orgUuid,
      tokenExpiresAt: integ.expires_at,
    },
    me: meData?.resource,
    eventTypes: { status: eventTypes.status, count: etList.length, sample: etList[0] || null },
    sampleEventTypeDetail,
    scheduledFuture: { status: scheduledFuture.status, count: scheduledFuture.data?.collection?.length || 0, sample: scheduledFuture.data?.collection?.[0] || null },
    scheduledPast: { status: scheduledPast.status, count: scheduledPast.data?.collection?.length || 0, sample: pastEvents[0] || null },
    sampleEventDetails,
    orgMemberships: { status: orgMemberships.status, count: orgMemberships.data?.collection?.length || 0, sample: orgMemberships.data?.collection?.[0] || null },
    routingForms: { status: routingForms.status, data: routingForms.data },
    webhooks: { status: webhooks.status, count: webhooks.data?.collection?.length || 0, data: webhooks.data?.collection || [] },
    activityLog: { status: activityLog.status, data: activityLog.data },
  });
}
