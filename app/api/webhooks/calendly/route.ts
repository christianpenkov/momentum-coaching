import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { upsertProspect } from '@/lib/prospects';

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
    const shortLinkPath = utmContent || null;

    // Durée en minutes
    let duration: string | null = null;
    if (scheduledAt && endTime) {
      const mins = Math.round((new Date(endTime).getTime() - new Date(scheduledAt).getTime()) / 60000);
      duration = `${mins} min`;
    }

    // Reschedule : si old_invitee présent → hériter les données de l'ancien call
    const oldInviteeUrl: string | null = resource.old_invitee || null;
    let inheritedIgLeadId: string | null = null;
    let inheritedProspectLinkId: string | null = null;
    let inheritedSource: string | null = null;
    let inheritedUtmCampaign: string | null = null;
    let inheritedUtmContent: string | null = null;
    let inheritedCoachId: string | null = null;

    if (oldInviteeUrl) {
      const oldEventUuid = oldInviteeUrl.split('/').at(-3) || null;
      if (oldEventUuid) {
        const { data: oldCall } = await serviceSupabase
          .from('calls')
          .select('id, ig_lead_id, prospect_link_id, source, utm_campaign, utm_content, coach_id')
          .eq('calendly_event_uuid', oldEventUuid)
          .maybeSingle();
        if (oldCall) {
          inheritedIgLeadId = oldCall.ig_lead_id ?? null;
          inheritedProspectLinkId = oldCall.prospect_link_id ?? null;
          inheritedSource = oldCall.source ?? null;
          inheritedUtmCampaign = oldCall.utm_campaign ?? null;
          inheritedUtmContent = oldCall.utm_content ?? null;
          inheritedCoachId = oldCall.coach_id ?? null;
          await serviceSupabase.from('calls').update({ status: 'cancelled' }).eq('id', oldCall.id);
        }
      }
    }

    // Résoudre le profil organisateur du call
    // Priorité : integration Calendly → coach_id hérité → clientRow
    // L'organisateur du call Calendly est identifié par son URI dans scheduled_event
    const organizerUri: string = resource.scheduled_event?.event_memberships?.[0]?.user || '';

    // Cherche dans integrations quel profil possède ce compte Calendly
    // (le token Calendly est toujours stocké sous le profil de l'élève qui a connecté Calendly)
    let leadsProfileId: string | null = inheritedCoachId ?? null;

    if (!leadsProfileId && organizerUri) {
      const { data: integ } = await serviceSupabase
        .from('integrations')
        .select('profile_id, metadata')
        .eq('provider', 'calendly')
        .maybeSingle();
      // Cherche le profil dont l'URI Calendly correspond à l'organisateur
      const { data: allInteg } = await serviceSupabase
        .from('integrations')
        .select('profile_id, metadata')
        .eq('provider', 'calendly');
      for (const row of (allInteg || [])) {
        if (row.metadata?.uri === organizerUri || row.metadata?.user_uri === organizerUri) {
          leadsProfileId = row.profile_id;
          break;
        }
      }
    }

    // Si toujours pas trouvé : fallback par email invitee → trouver le coach via clients
    let clientId: string | null = null;
    if (!leadsProfileId && inviteeEmail) {
      const { data: authUsers } = await serviceSupabase.auth.admin.listUsers();
      const matched = authUsers?.users?.find((u: any) => u.email === inviteeEmail);
      if (matched) {
        const { data: clientData } = await serviceSupabase
          .from('clients').select('id, coach_id').eq('profile_id', matched.id).single();
        if (clientData) {
          clientId = clientData.id;
          leadsProfileId = clientData.coach_id;
        }
      }
    }

    if (!leadsProfileId) {
      console.error('[webhook/calendly] invitee.created: impossible de résoudre le profil organisateur');
      return NextResponse.json({ ok: true });
    }

    // Résoudre ig_lead_id via UTM
    let igLeadId: string | null = null;
    if (igUserIdFromUtm) {
      const { data: leadRow } = await serviceSupabase
        .from('instagram_leads')
        .select('id')
        .eq('ig_user_id', igUserIdFromUtm)
        .eq('profile_id', leadsProfileId)
        .order('detected_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      igLeadId = leadRow?.id ?? null;
    }

    // Résoudre prospect_link_id via short_link_path
    let prospectLinkId: string | null = null;
    if (shortLinkPath) {
      const { data: pl } = await serviceSupabase
        .from('prospect_links')
        .select('id, ig_lead_id')
        .eq('profile_id', leadsProfileId)
        .filter('short_url', 'like', `%/${shortLinkPath}`)
        .maybeSingle();
      if (pl) {
        prospectLinkId = pl.id;
        igLeadId = igLeadId ?? pl.ig_lead_id ?? null;
      }
    }

    // Héritage reschedule — fallback si pas de données UTM sur le nouvel event
    igLeadId = igLeadId ?? inheritedIgLeadId;
    prospectLinkId = prospectLinkId ?? inheritedProspectLinkId;

    // Résoudre client_id si pas déjà trouvé (cas coach qui connect lui-même)
    if (!clientId && inviteeEmail) {
      const { data: authUsers } = await serviceSupabase.auth.admin.listUsers();
      const matched = authUsers?.users?.find((u: any) => u.email === inviteeEmail);
      if (matched) {
        const { data: clientData } = await serviceSupabase
          .from('clients').select('id').eq('profile_id', matched.id).single();
        clientId = clientData?.id ?? null;
      }
    }

    // Upsert prospect non-IG (YT / Autres) — crée ou retrouve la fiche prospect
    const effectiveSource = source ?? inheritedSource ?? null;
    const effectivePlatform: 'yt' | 'other' = effectiveSource?.toLowerCase().startsWith('yt') ? 'yt' : 'other';
    let prospectId: string | null = null;
    if (!igLeadId) {
      prospectId = await upsertProspect({
        profileId: leadsProfileId,
        platform: effectivePlatform,
        email: inviteeEmail,
        name: inviteeName,
        source: effectiveSource,
      });
    }

    const baseUpsert: Record<string, any> = {
      coach_id: leadsProfileId,
      client_id: clientId,
      calendly_event_uuid: eventUuid,
      calendly_uri: eventUri,
      topic: eventName,
      scheduled_at: scheduledAt,
      duration,
      join_url: joinUrl,
      invitee_email: inviteeEmail,
      invitee_name: inviteeName,
      status: 'active',
      ready: 'pending',
      reminder_sent: false,
    };
    if (effectiveSource)                     baseUpsert.source = effectiveSource;
    if (utmCampaign || inheritedUtmCampaign) baseUpsert.utm_campaign = utmCampaign ?? inheritedUtmCampaign;
    if (utmMedium)                           baseUpsert.utm_medium = utmMedium;
    if (utmContent || inheritedUtmContent)   baseUpsert.utm_content = utmContent ?? inheritedUtmContent;
    if (shortLinkPath || inheritedUtmContent) baseUpsert.short_link_path = shortLinkPath ?? inheritedUtmContent;
    if (igLeadId)      baseUpsert.ig_lead_id = igLeadId;
    if (prospectLinkId) baseUpsert.prospect_link_id = prospectLinkId;
    if (prospectId)    baseUpsert.prospect_id = prospectId;

    const { data: callRow } = await serviceSupabase.from('calls').upsert(
      baseUpsert,
      { onConflict: 'calendly_event_uuid' }
    ).select('id').maybeSingle();

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
      const prospectKey = igUsername?.toLowerCase() ?? prospectId ?? eventUuid;
      const platform = igUsername ? 'ig' : effectivePlatform;
      serviceSupabase.from('prospect_events').upsert({
        profile_id:       leadsProfileId,
        prospect_key:     prospectKey,
        platform,
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
