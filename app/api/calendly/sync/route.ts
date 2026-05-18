import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const isCoach = profile?.role === 'coach';

  // Pour un client, on remonte au coach pour avoir son token Calendly
  let coachProfileId = user.id;
  if (!isCoach) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('coach_id')
      .eq('profile_id', user.id)
      .single();
    if (!clientRow?.coach_id) return NextResponse.json({ error: 'Coach introuvable' }, { status: 404 });
    coachProfileId = clientRow.coach_id;
  }

  const { data: integration } = await serviceSupabase
    .from('integrations')
    .select('access_token')
    .eq('profile_id', coachProfileId)
    .eq('provider', 'calendly')
    .single();

  if (!integration?.access_token) {
    return NextResponse.json({ error: 'Calendly non connecté' }, { status: 404 });
  }

  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${integration.access_token}` },
  });
  const meData = await meRes.json();
  const userUri = meData?.resource?.uri;
  if (!userUri) return NextResponse.json({ error: 'Profil Calendly introuvable' }, { status: 400 });

  const eventsRes = await fetch(
    `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&status=active&count=100`,
    { headers: { Authorization: `Bearer ${integration.access_token}` } }
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

    if (isCoach) {
      // Coach : on insère le call directement avec coach_id, sans chercher de client
      const inviteesRes = await fetch(
        `https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10`,
        { headers: { Authorization: `Bearer ${integration.access_token}` } }
      );
      const invitees: any[] = (await inviteesRes.json())?.collection || [];
      const inviteeEmail = invitees[0]?.email || null;
      const inviteeName = invitees[0]?.name || null;

      // Essaie quand même de matcher un client connu
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
    } else {
      // Client : on cherche son entrée dans clients
      const inviteesRes = await fetch(
        `https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10`,
        { headers: { Authorization: `Bearer ${integration.access_token}` } }
      );
      const invitees: any[] = (await inviteesRes.json())?.collection || [];

      for (const invitee of invitees) {
        const inviteeEmail = invitee.email || null;
        if (!inviteeEmail) continue;

        const { data: authUsers } = await serviceSupabase.auth.admin.listUsers();
        const matched = authUsers?.users?.find((u: any) => u.email === inviteeEmail);
        let clientRow = null;
        if (matched) {
          const { data } = await serviceSupabase.from('clients').select('id').eq('profile_id', matched.id).single();
          clientRow = data;
        }

        if (clientRow) {
          await serviceSupabase.from('calls').upsert({
            coach_id: coachProfileId,
            client_id: clientRow.id,
            calendly_event_uuid: eventUuid,
            calendly_uri: event.uri,
            topic: eventName,
            scheduled_at: scheduledAt,
            duration,
            join_url: joinUrl,
            invitee_email: inviteeEmail,
            status: 'active',
            ready: 'pending',
            reminder_sent: false,
          }, { onConflict: 'calendly_event_uuid' });
          synced++;
        }
      }
    }
  }

  return NextResponse.json({ ok: true, synced, total: events.length });
}
