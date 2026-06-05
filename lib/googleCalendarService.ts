import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

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

async function getAuthClientForCoach(coachId: string) {
  const sb = serviceSupabase();
  const { data: integration } = await sb
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', coachId)
    .eq('provider', 'google')
    .single();

  if (!integration?.access_token) {
    throw new Error('Google Calendar non connecté pour ce coach');
  }

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    expiry_date: integration.expires_at
      ? new Date(integration.expires_at).getTime()
      : undefined,
  });

  // Refresh automatique si expiré ou expire dans moins de 5 min
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
      .eq('profile_id', coachId)
      .eq('provider', 'google');
  }

  return oauth2;
}

export async function createGoogleCall(params: {
  coachId: string;
  clientId: string;
  clientName: string;
  topic: string;
  startTime: string; // ISO
  endTime: string;   // ISO
}) {
  const auth = await getAuthClientForCoach(params.coachId);
  const calendar = google.calendar({ version: 'v3', auth });

  const event = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    requestBody: {
      summary: `Call coaching — ${params.clientName}`,
      description: params.topic,
      start: { dateTime: params.startTime, timeZone: 'Europe/Paris' },
      end: { dateTime: params.endTime, timeZone: 'Europe/Paris' },
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

  const sb = serviceSupabase();
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
      status: 'active',
      ready: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
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
    .select('google_event_id')
    .eq('id', params.callId)
    .eq('coach_id', params.coachId)
    .single();

  if (!call?.google_event_id) throw new Error('Événement Google introuvable');

  const auth = await getAuthClientForCoach(params.coachId);
  const calendar = google.calendar({ version: 'v3', auth });

  const patch: Record<string, unknown> = {
    start: { dateTime: params.startTime, timeZone: 'Europe/Paris' },
    end: { dateTime: params.endTime, timeZone: 'Europe/Paris' },
  };
  if (params.topic) patch.description = params.topic;

  await calendar.events.patch({
    calendarId: 'primary',
    eventId: call.google_event_id,
    requestBody: patch,
  });

  const updates: Record<string, unknown> = {
    scheduled_at: params.startTime,
    duration: `${Math.round((new Date(params.endTime).getTime() - new Date(params.startTime).getTime()) / 60000)} min`,
  };
  if (params.topic) updates.topic = params.topic;

  const { data: updated, error } = await sb
    .from('calls')
    .update(updates)
    .eq('id', params.callId)
    .select()
    .single();

  if (error) throw error;
  return updated;
}

export async function deleteGoogleCall(params: {
  coachId: string;
  callId: string;
}) {
  const sb = serviceSupabase();
  const { data: call } = await sb
    .from('calls')
    .select('google_event_id')
    .eq('id', params.callId)
    .eq('coach_id', params.coachId)
    .single();

  if (call?.google_event_id) {
    try {
      const auth = await getAuthClientForCoach(params.coachId);
      const calendar = google.calendar({ version: 'v3', auth });
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: call.google_event_id,
      });
    } catch {
      // Non bloquant — on supprime en DB même si Google échoue
    }
  }

  const { error } = await sb
    .from('calls')
    .update({ status: 'cancelled' })
    .eq('id', params.callId)
    .eq('coach_id', params.coachId);

  if (error) throw error;
}
