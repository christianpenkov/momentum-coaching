import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

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

  // Si token non expiré (avec 5 min de marge), on l'utilise directement
  const expired = integ.expires_at && new Date(integ.expires_at).getTime() < Date.now() + 5 * 60 * 1000;

  if (!expired) return integ.access_token;

  // Token expiré — on rafraîchit
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

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await serviceSupabase
    .from('profiles').select('role').eq('id', user.id).single();

  const isCoach = profile?.role === 'coach';

  let coachProfileId = user.id;
  if (!isCoach) {
    const { data: clientRow } = await serviceSupabase
      .from('clients').select('coach_id').eq('profile_id', user.id).single();
    if (!clientRow?.coach_id) return NextResponse.json({ error: 'Coach introuvable' }, { status: 404 });
    coachProfileId = clientRow.coach_id;
  }

  const accessToken = await getFreshToken(coachProfileId);
  if (!accessToken) {
    return NextResponse.json({ error: 'Token Calendly expiré — reconnecte Calendly dans les réglages', needsReconnect: true }, { status: 401 });
  }

  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meData = await meRes.json();
  const userUri = meData?.resource?.uri;
  if (!userUri) return NextResponse.json({ error: 'Profil Calendly introuvable' }, { status: 400 });

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
      status: 'active',
      ready: 'pending',
      reminder_sent: false,
    }, { onConflict: 'calendly_event_uuid' });
    synced++;
  }

  return NextResponse.json({ ok: true, synced, total: events.length });
}
