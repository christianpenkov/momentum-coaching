import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('calendly-webhook-signature') || '';

  // Vérifie la signature si la clé est configurée
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (signingKey && signature) {
    try {
      const crypto = await import('crypto');
      const [, receivedSig] = signature.split('=');
      const expected = crypto
        .createHmac('sha256', signingKey)
        .update(body)
        .digest('hex');
      if (receivedSig !== expected) {
        return NextResponse.json({ error: 'Signature invalide' }, { status: 401 });
      }
    } catch {
      // Si vérification impossible, on continue quand même
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const event = payload.event;
  const resource = payload.payload;

  if (!event || !resource) {
    return NextResponse.json({ ok: true });
  }

  // Extrait l'UUID de l'event depuis l'URI Calendly
  const eventUri: string = resource.uri || resource.event || '';
  const eventUuid = eventUri.split('/').pop() || '';

  if (event === 'invitee.created') {
    // Nouveau call schedulé
    const scheduledAt = resource.scheduled_event?.start_time || resource.start_time || null;
    const endTime = resource.scheduled_event?.end_time || resource.end_time || null;
    const joinUrl = resource.scheduled_event?.location?.join_url
      || resource.location?.join_url
      || resource.event_memberships?.[0]?.user_event_url
      || null;
    const inviteeEmail = resource.email || resource.invitee?.email || null;
    const eventName = resource.scheduled_event?.name || resource.event_type_name || 'Call coaching';

    // Durée en minutes
    let duration: string | null = null;
    if (scheduledAt && endTime) {
      const mins = Math.round((new Date(endTime).getTime() - new Date(scheduledAt).getTime()) / 60000);
      duration = `${mins} min`;
    }

    // Trouve le client par son email invitee ou son organisateur
    const organizerUri: string = resource.scheduled_event?.event_memberships?.[0]?.user || '';
    const organizerUuid = organizerUri.split('/').pop() || '';

    // Cherche dans integrations qui a ce compte Calendly
    let clientRow = null;
    if (inviteeEmail) {
      const { data: authUser } = await serviceSupabase
        .from('profiles')
        .select('id')
        .eq('role', 'client')
        .limit(50);

      if (authUser) {
        for (const profile of authUser) {
          const { data: clientData } = await serviceSupabase
            .from('clients')
            .select('id, coach_id')
            .eq('profile_id', profile.id)
            .single();

          // Vérifie si l'email Supabase Auth correspond
          const { data: userEmail } = await serviceSupabase.auth.admin.getUserById(profile.id);
          if (userEmail?.user?.email === inviteeEmail) {
            clientRow = clientData;
            break;
          }
        }
      }
    }

    if (!clientRow) {
      // Essaie de trouver par email dans la table clients
      if (inviteeEmail) {
        const { data } = await serviceSupabase
          .from('clients')
          .select('id, coach_id')
          .eq('email', inviteeEmail)
          .single();
        clientRow = data;
      }
    }

    if (clientRow) {
      await serviceSupabase.from('calls').upsert({
        client_id: clientRow.id,
        calendly_event_uuid: eventUuid,
        calendly_uri: eventUri,
        topic: eventName,
        scheduled_at: scheduledAt,
        duration,
        join_url: joinUrl,
        invitee_email: inviteeEmail,
        status: 'active',
        ready: 'pending',
        reminder_sent: false,
      }, { onConflict: 'calendly_event_uuid' });
    }
  }

  if (event === 'invitee.canceled') {
    // Call annulé
    if (eventUuid) {
      await serviceSupabase
        .from('calls')
        .update({ status: 'cancelled' })
        .eq('calendly_event_uuid', eventUuid);
    }
  }

  return NextResponse.json({ ok: true });
}
