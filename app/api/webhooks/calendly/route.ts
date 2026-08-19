import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { upsertProspect } from '@/lib/prospects';
import { resolveUtmContent, resolveCallSource } from '@/lib/contentId';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('calendly-webhook-signature') || '';

  // Vérifie la signature Calendly — fail-closed si la clé n'est pas configurée
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    console.error('[webhook/calendly] CALENDLY_WEBHOOK_SIGNING_KEY manquante — refus fail-closed');
    return NextResponse.json({ error: 'Erreur de configuration serveur' }, { status: 500 });
  }
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
    // Moment réel où le prospect a réservé (distinct de scheduledAt = heure du call) —
    // même champ que invitee.created_at utilisé côté sync-calendly (edge function).
    const bookedAt = resource.created_at || resource.invitee?.created_at || null;
    const utmSource = resource.tracking?.utm_source || null;
    const utmMedium = resource.tracking?.utm_medium || null;
    const utmCampaign = resource.tracking?.utm_campaign || null;
    const utmContent = resource.tracking?.utm_content || null;
    // utm_term = le prospect. Écrit dans les liens depuis toujours, mais jamais lu ni
    // stocké jusqu'ici : l'information partait vers Calendly et se perdait. Voir
    // docs/utm-nomenclature.md (un rôle par champ).
    const utmTerm = resource.tracking?.utm_term || null;
    // Règle partagée : utm_source doit être la PLATEFORME (ig/yt), jamais le
    // domaine Short.io — sinon on produit des sources du type
    // `ubizenai.s.gy_description`, inexploitables pour l'attribution.
    const source = resolveCallSource(utmSource, utmMedium, utmContent) ?? null;

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
    // utm_medium hérite comme source. Sans ça, un rendez-vous reprogrammé gardait la
    // source du premier contact (« vient de la description ») mais recevait le canal du
    // nouveau clic (« dm ») : les deux champs décrivaient deux moments différents, d'où
    // 9 calls contradictoires en base. Décision : créditer le PREMIER contact, c'est le
    // contenu qui a créé l'opportunité, le DM n'a servi qu'à replanifier un rendez-vous
    // déjà acquis. Voir docs/utm-nomenclature.md.
    let inheritedUtmMedium: string | null = null;
    let inheritedUtmCampaign: string | null = null;
    let inheritedUtmContent: string | null = null;
    let inheritedUtmTerm: string | null = null;
    let inheritedCoachId: string | null = null;

    if (oldInviteeUrl) {
      const oldEventUuid = oldInviteeUrl.split('/').at(-3) || null;
      if (oldEventUuid) {
        const { data: oldCall } = await serviceSupabase
          .from('calls')
          .select('id, ig_lead_id, prospect_link_id, source, utm_medium, utm_campaign, utm_content, utm_term, coach_id')
          .eq('calendly_event_uuid', oldEventUuid)
          .maybeSingle();
        if (oldCall) {
          inheritedIgLeadId = oldCall.ig_lead_id ?? null;
          inheritedProspectLinkId = oldCall.prospect_link_id ?? null;
          inheritedSource = oldCall.source ?? null;
          inheritedUtmMedium = oldCall.utm_medium ?? null;
          inheritedUtmCampaign = oldCall.utm_campaign ?? null;
          inheritedUtmContent = oldCall.utm_content ?? null;
          inheritedUtmTerm = oldCall.utm_term ?? null;
          inheritedCoachId = oldCall.coach_id ?? null;
          await serviceSupabase.from('calls').update({ status: 'canceled' }).eq('id', oldCall.id);
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
    // Lookup via RPC get_profile_id_by_email (index direct sur auth.users) plutôt que
    // auth.admin.listUsers(), qui ne retourne que les 50 premiers utilisateurs par
    // défaut et cesserait silencieusement de résoudre certains profils au-delà.
    let clientId: string | null = null;
    if (!leadsProfileId && inviteeEmail) {
      const { data: matchedId } = await serviceSupabase.rpc('get_profile_id_by_email', { p_email: inviteeEmail });
      if (matchedId) {
        const { data: clientData } = await serviceSupabase
          .from('clients').select('id, coach_id').eq('profile_id', matchedId).single();
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
      const { data: matchedId } = await serviceSupabase.rpc('get_profile_id_by_email', { p_email: inviteeEmail });
      if (matchedId) {
        const { data: clientData } = await serviceSupabase
          .from('clients').select('id').eq('profile_id', matchedId).single();
        clientId = clientData?.id ?? null;
      }
    }

    // Upsert prospect non-IG (YT / Autres) — crée ou retrouve la fiche prospect
    //
    // Sur une reprogrammation, l'attribution décrit le PREMIER contact : c'est le
    // contenu d'origine qui a créé l'opportunité, le nouveau clic n'a servi qu'à
    // replanifier. inheritedSource prime donc sur source, et utm_medium suit la même
    // règle plus bas — sans quoi les deux champs décriraient deux moments différents,
    // ce qui a produit 9 calls contradictoires en base. Voir docs/utm-nomenclature.md.
    const effectiveSource = inheritedSource ?? source ?? null;
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
      if (!prospectId) {
        console.warn('[webhook/calendly] prospect non résolu — email et nom manquants, eventUuid:', eventUuid);
      }
    }

    const baseUpsert: Record<string, any> = {
      coach_id: leadsProfileId,
      client_id: clientId,
      call_type: 'calendly',
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
    // Les quatre champs d'attribution suivent la MÊME règle : sur une reprogrammation,
    // la valeur héritée prime, pour qu'ils décrivent tous le premier contact et jamais un
    // mélange de deux moments (voir le commentaire sur inheritedUtmMedium plus haut).
    // Toute divergence entre ces lignes recrée des calls contradictoires.
    if (effectiveSource)                     baseUpsert.source = effectiveSource;
    if (utmCampaign || inheritedUtmCampaign) baseUpsert.utm_campaign = inheritedUtmCampaign ?? utmCampaign;
    if (utmMedium || inheritedUtmMedium)     baseUpsert.utm_medium = inheritedUtmMedium ?? utmMedium;
    if (utmTerm || inheritedUtmTerm)         baseUpsert.utm_term = inheritedUtmTerm ?? utmTerm;
    const newUtmContent = utmContent ?? inheritedUtmContent;
    // Garde anti-écrasement : si la ligne existante a déjà un utm_content valide (vrai
    // ID de post/vidéo/séquence, ex: backfillé après le bug de PageLiens.tsx qui posait
    // le pseudo au lieu du postId) et que la nouvelle valeur reçue de Calendly ne l'est
    // pas, on garde l'ancienne — sinon chaque resync réécraserait silencieusement le
    // backfill par la valeur figée au moment du clic initial du prospect (comportement
    // UTM Calendly standard : capturée une fois pour toutes, jamais réévaluée).
    if (newUtmContent) {
      // Règle partagée (lib/contentId.ts) : une valeur invalide n'est JAMAIS
      // écrite, même quand la base est vide. Auparavant la branche « sinon
      // j'écris quand même » réinscrivait le pseudo figé par Calendly — c'est
      // ce qui a produit 40 anomalies après la migration UTM du 2026-08-19.
      // Le pseudo a son propre champ : utm_term, écrit plus bas.
      const { data: existing } = await serviceSupabase.from('calls')
        .select('utm_content').eq('calendly_event_uuid', eventUuid).maybeSingle();
      const resolved = resolveUtmContent(newUtmContent, existing?.utm_content);
      // undefined = ne rien écrire (omettre la clé, surtout pas poser null qui
      // écraserait une valeur correcte).
      if (resolved !== undefined) baseUpsert.utm_content = resolved;
    }
    if (shortLinkPath || inheritedUtmContent) baseUpsert.short_link_path = shortLinkPath ?? inheritedUtmContent;
    if (igLeadId)      baseUpsert.ig_lead_id = igLeadId;
    if (prospectLinkId) baseUpsert.prospect_link_id = prospectLinkId;
    if (prospectId)    baseUpsert.prospect_id = prospectId;
    if (bookedAt)      baseUpsert.booked_at = bookedAt;

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
      // RPC upsert_prospect_event_call_booked (pas .upsert() du client JS) : l'index
      // unique réel prospect_events_call_event_uidx est PARTIEL
      // (UNIQUE (call_id, event_type) WHERE call_id IS NOT NULL) — le client Supabase JS
      // ne peut cibler un ON CONFLICT que sur un index/contrainte total, donc
      // .upsert({...}, { onConflict: 'call_id,event_type' }) échouait systématiquement
      // ("no unique or exclusion constraint matching the ON CONFLICT specification"),
      // reproduit et confirmé le 2026-08-14. Même RPC utilisée côté cron
      // (supabase/functions/sync-calendly/index.ts) — les deux convergent sur la même
      // ligne en cas de course serrée.
      serviceSupabase.rpc('upsert_prospect_event_call_booked', {
        p_profile_id: leadsProfileId,
        p_prospect_key: prospectKey,
        p_platform: platform,
        p_event_type: 'call_booked',
        // Moment réel de la réservation (booked_at), pas l'heure du call (scheduledAt) —
        // ce sont deux instants distincts sauf coïncidence.
        p_occurred_at: bookedAt ?? new Date().toISOString(),
        p_ig_lead_id: igLeadId,
        p_prospect_link_id: prospectLinkId,
        p_call_id: callRow.id,
      }).then(({ error: evtErr }) => {
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

      // Date et auteur de l'annulation, dès le webhook.
      //
      // Sans ça, ces informations n'arrivaient qu'au passage suivant du cron
      // (jusqu'à 5 min plus tard), et la timeline affichait entre-temps l'heure
      // du RENDEZ-VOUS comme date d'annulation — donc une date fausse, parfois
      // dans le futur.
      //
      // Deux emplacements testés : Calendly place `cancellation` sur l'invitee
      // (resource) ou sur l'événement imbriqué selon le contexte. On lit les
      // deux plutôt que de dépendre d'une structure non garantie par la doc.
      const cancellation = resource.cancellation
        ?? resource.scheduled_event?.cancellation
        ?? null;

      const cancelUpdate: Record<string, unknown> = {
        status: 'canceled',
        cancellation_reason: cancellation?.reason || 'canceled',
      };
      // Renseignés seulement si présents : ne jamais écraser avec null une
      // valeur déjà récupérée par le cron.
      //
      // Repli sur l'instant de réception si Calendly n'envoie pas `created_at`
      // dans ce webhook (la doc ne garantit pas sa présence) : le webhook part
      // à la seconde où l'annulation a lieu, donc l'écart est négligeable — et
      // toujours infiniment plus juste que l'heure du rendez-vous. Le cron
      // corrigera avec la valeur exacte au passage suivant.
      cancelUpdate.canceled_at = cancellation?.created_at ?? new Date().toISOString();
      if (cancellation?.canceled_by) cancelUpdate.canceled_by = cancellation.canceled_by;

      await serviceSupabase
        .from('calls')
        .update(cancelUpdate)
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
