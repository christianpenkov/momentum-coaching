import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getFreshToken(profileId: string): Promise<string | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('profile_id', profileId)
    .eq('provider', 'calendly')
    .single();

  if (!integ?.access_token) return null;

  const expired = integ.expires_at && new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;
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

async function syncCoach(coachProfileId: string): Promise<number> {
  const accessToken = await getFreshToken(coachProfileId);
  if (!accessToken) return 0;

  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meData = await meRes.json();
  const userUri = meData?.resource?.uri;
  if (!userUri) return 0;

  const eventsRes = await fetch(
    `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&status=active&count=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const events: any[] = (await eventsRes.json())?.collection || [];

  let synced = 0;

  for (const event of events) {
    const eventUuid = event.uri?.split('/').pop() || '';
    const scheduledAt = event.start_time || null;
    const endTime = event.end_time || null;
    const joinUrl = event.location?.join_url || null;
    const eventName = event.name || 'Call coaching';

    let duration: string | null = null;
    if (scheduledAt && endTime) {
      const mins = Math.round((new Date(endTime).getTime() - new Date(scheduledAt).getTime()) / 60000);
      duration = `${mins} min`;
    }

    const inviteesRes = await fetch(
      `https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const invitees: any[] = (await inviteesRes.json())?.collection || [];
    const inviteeEmail = invitees[0]?.email || null;
    const inviteeName = invitees[0]?.name || null;
    const questionsAndAnswers = invitees[0]?.questions_and_answers || null;
    const tracking = invitees[0]?.tracking || null;
    const utmSource = tracking?.utm_source || null;
    const utmMedium = tracking?.utm_medium || null;
    const source = utmSource ? [utmSource, utmMedium].filter(Boolean).join('_') : null;

    let clientId: string | null = null;
    if (inviteeEmail) {
      const { data: authUsers } = await serviceSupabase.auth.admin.listUsers();
      const matched = authUsers?.users?.find((u: any) => u.email === inviteeEmail);
      if (matched) {
        const { data } = await serviceSupabase.from('clients').select('id').eq('profile_id', matched.id).single();
        clientId = data?.id || null;
      }
    }

    await serviceSupabase.from('calls').upsert({
      coach_id: coachProfileId,
      client_id: clientId,
      calendly_event_uuid: eventUuid,
      calendly_uri: event.uri,
      topic: eventName,
      scheduled_at: scheduledAt,
      duration,
      join_url: joinUrl,
      invitee_email: inviteeEmail,
      invitee_name: inviteeName,
      calendly_qa: questionsAndAnswers,
      source,
      status: 'active',
      ready: 'pending',
      reminder_sent: false,
    }, { onConflict: 'calendly_event_uuid' });
    synced++;
  }

  return synced;
}

export async function GET(request: NextRequest) {
  // Vercel cron authentifie via Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Récupère tous les coachs avec une intégration Calendly active
  const { data: integrations } = await serviceSupabase
    .from('integrations')
    .select('profile_id')
    .eq('provider', 'calendly');

  if (!integrations?.length) {
    return NextResponse.json({ ok: true, synced: 0, coaches: 0 });
  }

  let totalSynced = 0;
  for (const integ of integrations) {
    const count = await syncCoach(integ.profile_id);
    totalSynced += count;
  }

  return NextResponse.json({ ok: true, synced: totalSynced, coaches: integrations.length });
}
