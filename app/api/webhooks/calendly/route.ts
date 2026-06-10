import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('calendly-webhook-signature') || '';

  // Vérifie la signature Calendly — obligatoire si clé configurée
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (signingKey) {
    const crypto = await import('crypto');
    const [, receivedSig] = (signature || '').split('=');
    if (!receivedSig) {
      return NextResponse.json({ error: 'Signature manquante' }, { status: 401 });
    }
    const expected = crypto
      .createHmac('sha256', signingKey)
      .update(body)
      .digest('hex');
    if (receivedSig !== expected) {
      return NextResponse.json({ error: 'Signature invalide' }, { status: 401 });
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
    const inviteeName = resource.name || resource.invitee?.name || null;
    const eventName = resource.scheduled_event?.name || resource.event_type_name || 'Call coaching';
    const utmSource = resource.tracking?.utm_source || null;
    const utmMedium = resource.tracking?.utm_medium || null;
    const utmCampaign = resource.tracking?.utm_campaign || null;
    const utmContent = resource.tracking?.utm_content || null;
    const source = utmSource ? [utmSource, utmMedium].filter(Boolean).join('_') : null;

    // utm_campaign = "lead-{ig_user_id}" → extraire l'ig_user_id pour jointure instagram_leads
    const igUserIdFromUtm = utmCampaign?.startsWith('lead-') ? utmCampaign.slice(5) : null;
    // utm_content = postId, utm_source = domaine Short.io, utm_medium = 'dm' → short_link_path
    const shortLinkPath = utmContent || null;

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
      // Retrouver ig_lead_id si on a un ig_user_id dans les UTMs
      let igLeadId: string | null = null;
      if (igUserIdFromUtm) {
        const { data: leadRow } = await serviceSupabase
          .from('instagram_leads')
          .select('id')
          .eq('ig_user_id', igUserIdFromUtm)
          .eq('profile_id', clientRow.id)
          .order('detected_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        igLeadId = leadRow?.id ?? null;
      }

      const { data: callRow } = await serviceSupabase.from('calls').upsert({
        client_id: clientRow.id,
        calendly_event_uuid: eventUuid,
        calendly_uri: eventUri,
        topic: eventName,
        scheduled_at: scheduledAt,
        duration,
        join_url: joinUrl,
        invitee_email: inviteeEmail,
        invitee_name: inviteeName,
        source,
        utm_campaign: utmCampaign,
        utm_medium: utmMedium,
        utm_content: utmContent,
        short_link_path: shortLinkPath,
        ig_lead_id: igLeadId,
        status: 'active',
        ready: 'pending',
        reminder_sent: false,
      }, { onConflict: 'calendly_event_uuid' }).select('id').maybeSingle();

      // Relier prospect_link → call via short_link_path
      let prospectLinkId: string | null = null;
      if (shortLinkPath && callRow?.id) {
        const { data: pl } = await serviceSupabase
          .from('prospect_links')
          .select('id, ig_lead_id')
          .eq('profile_id', clientRow.coach_id)
          .filter('short_url', 'like', `%/${shortLinkPath}`)
          .maybeSingle();
        if (pl) {
          prospectLinkId = pl.id;
          await serviceSupabase
            .from('calls')
            .update({
              prospect_link_id: pl.id,
              ig_lead_id: pl.ig_lead_id ?? igLeadId,
            })
            .eq('id', callRow.id);
          igLeadId = igLeadId ?? pl.ig_lead_id ?? null;
        }
      }

      // Relier le lead au call dans l'autre sens
      if (igLeadId && callRow?.id) {
        await serviceSupabase
          .from('instagram_leads')
          .update({ calendly_event_uuid: eventUuid })
          .eq('id', igLeadId);
      }

      // Événement call_booked dans prospect_events
      if (callRow?.id) {
        let igUsername: string | null = null;
        if (igLeadId) {
          const { data: leadRow } = await serviceSupabase
            .from('instagram_leads').select('ig_username').eq('id', igLeadId).single();
          igUsername = leadRow?.ig_username ?? null;
        }
        serviceSupabase.from('prospect_events').upsert({
          profile_id:       clientRow.id,
          prospect_key:     igUsername ?? eventUuid,
          platform:         igUsername ? 'ig' : 'yt',
          event_type:       'call_booked',
          occurred_at:      scheduledAt ?? new Date().toISOString(),
          ig_lead_id:       igLeadId,
          prospect_link_id: prospectLinkId,
          call_id:          callRow.id,
        }, { onConflict: 'call_id,event_type' }).then(({ error: evtErr }) => {
          if (evtErr) console.error('[webhook/calendly] prospect_events upsert:', evtErr.message);
        });
      }
    }
  }

  if (event === 'invitee.canceled') {
    if (eventUuid) {
      // Récupérer le call pour pouvoir invalider l'override pipeline
      const { data: callRow } = await serviceSupabase
        .from('calls')
        .select('id, ig_lead_id, client_id, short_link_path')
        .eq('calendly_event_uuid', eventUuid)
        .maybeSingle();

      await serviceSupabase
        .from('calls')
        .update({ status: 'canceled', cancellation_reason: 'canceled' })
        .eq('calendly_event_uuid', eventUuid);

      // Invalider l'override pipeline_overrides pour que le lead recule
      if (callRow?.ig_lead_id) {
        const { data: leadRow } = await serviceSupabase
          .from('instagram_leads').select('ig_username, profile_id').eq('id', callRow.ig_lead_id).single();
        if (leadRow) {
          // Trouver la meilleure étape connue via prospect_events
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
    }
  }

  if (event === 'invitee.rescheduled') {
    if (eventUuid) {
      const newStartTime = resource.scheduled_event?.start_time || resource.new_event?.start_time || null;
      const now = new Date().toISOString();
      const { data: callRow } = await serviceSupabase
        .from('calls')
        .select('id, scheduled_at')
        .eq('calendly_event_uuid', eventUuid)
        .maybeSingle();

      if (callRow) {
        const wasAfterScheduled = callRow.scheduled_at && new Date(callRow.scheduled_at).getTime() < Date.now();
        await serviceSupabase.from('calls').update({
          scheduled_at: newStartTime,
          rescheduled: true,
          rescheduled_at: wasAfterScheduled ? now : null,
        }).eq('id', callRow.id);
      }
    }
  }

  if (event === 'invitee.no_show') {
    if (eventUuid) {
      const { data: callRow } = await serviceSupabase
        .from('calls')
        .select('id, ig_lead_id')
        .eq('calendly_event_uuid', eventUuid)
        .maybeSingle();

      if (callRow) {
        await serviceSupabase.from('calls').update({
          no_show: true,
          no_show_at: new Date().toISOString(),
        }).eq('id', callRow.id);

        // Invalider l'override pipeline pour que le lead recule vers meilleure étape connue
        if (callRow.ig_lead_id) {
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
              reason: 'no_show',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'profile_id,prospect_key,platform' });
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
