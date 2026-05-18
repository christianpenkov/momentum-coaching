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

  // Détermine le profile_id à utiliser pour le token Calendly
  // Si l'utilisateur est un client, on remonte au coach
  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  let coachProfileId = user.id;

  if (profile?.role === 'client') {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('coach_id')
      .eq('profile_id', user.id)
      .single();
    if (!clientRow?.coach_id) {
      return NextResponse.json({ error: 'Coach introuvable' }, { status: 404 });
    }
    coachProfileId = clientRow.coach_id;
  }

  // Récupère le token Calendly du coach
  const { data: integration } = await serviceSupabase
    .from('integrations')
    .select('access_token')
    .eq('profile_id', coachProfileId)
    .eq('provider', 'calendly')
    .single();

  if (!integration?.access_token) {
    return NextResponse.json({ error: 'Calendly non connecté' }, { status: 404 });
  }

  // Récupère l'URI utilisateur Calendly
  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${integration.access_token}` },
  });
  const meData = await meRes.json();
  const userUri = meData?.resource?.uri;
  if (!userUri) {
    return NextResponse.json({ error: 'Impossible de récupérer le profil Calendly' }, { status: 400 });
  }

  // Récupère les scheduled events actifs (passés + futurs, max 100)
  const eventsRes = await fetch(
    `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&status=active&count=100`,
    { headers: { Authorization: `Bearer ${integration.access_token}` } }
  );
  const eventsData = await eventsRes.json();
  const events: any[] = eventsData?.collection || [];

  let synced = 0;
  let skipped = 0;

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

    // Récupère les invités de cet event
    const inviteesRes = await fetch(
      `https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10`,
      { headers: { Authorization: `Bearer ${integration.access_token}` } }
    );
    const inviteesData = await inviteesRes.json();
    const invitees: any[] = inviteesData?.collection || [];

    for (const invitee of invitees) {
      const inviteeEmail = invitee.email || null;
      if (!inviteeEmail) continue;

      // Cherche le client par email dans auth.users
      const { data: authUsers } = await serviceSupabase.auth.admin.listUsers();
      const matchedAuthUser = authUsers?.users?.find((u: any) => u.email === inviteeEmail);

      let clientRow = null;
      if (matchedAuthUser) {
        const { data } = await serviceSupabase
          .from('clients')
          .select('id, coach_id')
          .eq('profile_id', matchedAuthUser.id)
          .single();
        clientRow = data;
      }

      if (!clientRow) {
        const { data } = await serviceSupabase
          .from('clients')
          .select('id, coach_id')
          .eq('email', inviteeEmail)
          .single();
        clientRow = data;
      }

      if (clientRow) {
        await serviceSupabase.from('calls').upsert({
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
      } else {
        skipped++;
      }
    }
  }

  return NextResponse.json({ ok: true, synced, skipped, total: events.length });
}
