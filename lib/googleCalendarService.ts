import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );
}

function serviceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getAuthClientForProfile(profileId: string) {
  const sb = serviceSupabase();
  const { data: integration } = await sb
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId)
    .eq('provider', 'google')
    .single();

  if (!integration?.access_token) {
    throw new Error('Google Calendar non connecté pour ce profil');
  }

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    expiry_date: integration.expires_at
      ? new Date(integration.expires_at).getTime()
      : undefined,
  });

  const expiresAt = integration.expires_at
    ? new Date(integration.expires_at).getTime()
    : 0;
  if (expiresAt < Date.now() + 5 * 60 * 1000) {
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    await sb.from('integrations').update({
      access_token: credentials.access_token,
      expires_at: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : null,
    })
      .eq('profile_id', profileId)
      .eq('provider', 'google');
  }

  return oauth2;
}

// Récupère l'email Google de l'élève (depuis integrations ou depuis son profil auth)
async function getClientGoogleEmail(clientId: string): Promise<string | null> {
  const sb = serviceSupabase();

  // clients.profile_id → integrations.provider='google' → account_label = email Google
  const { data: client } = await sb
    .from('clients')
    .select('profile_id')
    .eq('id', clientId)
    .single();

  if (!client?.profile_id) return null;

  const { data: integ } = await sb
    .from('integrations')
    .select('account_label')
    .eq('profile_id', client.profile_id)
    .eq('provider', 'google')
    .single();

  // account_label stocke l'email Google lors du callback OAuth
  return integ?.account_label || null;
}

// Envoie une notif push à un profile_id donné
async function sendPushToProfile(profileId: string, title: string, body: string, url: string) {
  const sb = serviceSupabase();
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', profileId);

  if (!subs || subs.length === 0) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!.trim(),
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim()
  );

  const payload = JSON.stringify({ title, body, url });
  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  );

  // Nettoyer les subscriptions expirées
  const expired = results
    .map((r, i) => ({ r, sub: subs[i] }))
    .filter(({ r }) => r.status === 'rejected' && (r as PromiseRejectedResult).reason?.statusCode === 410);
  if (expired.length > 0) {
    await sb.from('push_subscriptions')
      .delete()
      .in('endpoint', expired.map(({ sub }) => sub.endpoint));
  }
}

export async function createGoogleCall(params: {
  coachId: string;
  clientId: string;
  clientName: string;
  topic: string;
  startTime: string;
  endTime: string;
}) {
  const auth = await getAuthClientForProfile(params.coachId);
  const calendar = google.calendar({ version: 'v3', auth });
  const sb = serviceSupabase();

  // Récupère l'email Google de l'élève pour l'inviter
  const clientEmail = await getClientGoogleEmail(params.clientId);

  const attendees = clientEmail
    ? [{ email: clientEmail }]
    : [];

  const event = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    sendUpdates: clientEmail ? 'all' : 'none', // envoie l'invite email Google si l'élève est connecté
    requestBody: {
      summary: `Call coaching — ${params.clientName}`,
      description: params.topic,
      start: { dateTime: params.startTime, timeZone: 'Europe/Paris' },
      end: { dateTime: params.endTime, timeZone: 'Europe/Paris' },
      attendees,
      conferenceData: {
        createRequest: {
          requestId: `momentum-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  });

  const googleEventId = event.data.id!;
  const meetLink =
    event.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri ||
    event.data.hangoutLink ||
    null;

  const { data: call, error } = await sb
    .from('calls')
    .insert({
      coach_id: params.coachId,
      client_id: params.clientId,
      topic: params.topic,
      scheduled_at: params.startTime,
      duration: `${Math.round((new Date(params.endTime).getTime() - new Date(params.startTime).getTime()) / 60000)} min`,
      join_url: meetLink,
      meet_link: meetLink,
      google_event_id: googleEventId,
      call_type: 'google',
      status: 'pending_acceptance',
      ready: 'pending',
    })
    .select()
    .single();

  if (error) throw error;

  // Notif push immédiate à l'élève
  const { data: client } = await sb
    .from('clients')
    .select('profile_id')
    .eq('id', params.clientId)
    .single();

  if (client?.profile_id) {
    const d = new Date(params.startTime);
    const dateStr = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    await sendPushToProfile(
      client.profile_id,
      'Nouvelle demande de call',
      `${params.topic || 'Call coaching'} · ${dateStr} à ${timeStr} — Accepter ou refuser`,
      '/client/calls'
    );
  }

  return call;
}

export async function updateGoogleCall(params: {
  coachId: string;
  callId: string;
  startTime: string;
  endTime: string;
  topic?: string;
}) {
  const sb = serviceSupabase();
  const { data: call } = await sb
    .from('calls')
    .select('google_event_id, client_id')
    .eq('id', params.callId)
    .eq('coach_id', params.coachId)
    .single();

  if (!call?.google_event_id) throw new Error('Événement Google introuvable');

  const auth = await getAuthClientForProfile(params.coachId);
  const calendar = google.calendar({ version: 'v3', auth });

  const patch: Record<string, unknown> = {
    start: { dateTime: params.startTime, timeZone: 'Europe/Paris' },
    end: { dateTime: params.endTime, timeZone: 'Europe/Paris' },
  };
  if (params.topic) patch.description = params.topic;

  await calendar.events.patch({
    calendarId: 'primary',
    eventId: call.google_event_id,
    sendUpdates: 'all',
    requestBody: patch,
  });

  const updates: Record<string, unknown> = {
    scheduled_at: params.startTime,
    duration: `${Math.round((new Date(params.endTime).getTime() - new Date(params.startTime).getTime()) / 60000)} min`,
    reminder_24h_sent: false,
    reminder_15min_sent: false,
  };
  if (params.topic) updates.topic = params.topic;

  const { data: updated, error } = await sb
    .from('calls')
    .update(updates)
    .eq('id', params.callId)
    .select()
    .single();

  if (error) throw error;

  // Notif push à l'élève pour le déplacement
  if (call.client_id) {
    const { data: clientRow } = await sb
      .from('clients')
      .select('profile_id')
      .eq('id', call.client_id)
      .single();

    if (clientRow?.profile_id) {
      const d = new Date(params.startTime);
      const dateStr = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      await sendPushToProfile(
        clientRow.profile_id,
        'Call déplacé',
        `Nouveau créneau : ${dateStr} à ${timeStr}`,
        '/client/calls'
      );
    }
  }

  return updated;
}

export async function deleteGoogleCall(params: {
  coachId: string;
  callId: string;
}) {
  const sb = serviceSupabase();
  const { data: call } = await sb
    .from('calls')
    .select('google_event_id, client_id')
    .eq('id', params.callId)
    .eq('coach_id', params.coachId)
    .single();

  if (call?.google_event_id) {
    try {
      const auth = await getAuthClientForProfile(params.coachId);
      const calendar = google.calendar({ version: 'v3', auth });
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: call.google_event_id,
        sendUpdates: 'all',
      });
    } catch {
      // Non bloquant
    }
  }

  const { error } = await sb
    .from('calls')
    .update({ status: 'cancelled' })
    .eq('id', params.callId)
    .eq('coach_id', params.coachId);

  if (error) throw error;

  // Notif push à l'élève pour l'annulation
  if (call?.client_id) {
    const { data: clientRow } = await sb
      .from('clients')
      .select('profile_id')
      .eq('id', call.client_id)
      .single();

    if (clientRow?.profile_id) {
      await sendPushToProfile(
        clientRow.profile_id,
        'Call annulé',
        'Le coach a annulé ce call.',
        '/client/calls'
      );
    }
  }
}

// Utilisé par le cron de rappels
export { sendPushToProfile };
