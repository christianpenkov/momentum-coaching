import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getCalendlyToken } from '@/lib/calendly-fetch';
import { upsertProspect } from '@/lib/prospects';
import { isValidContentId, resolveUtmContent } from '@/lib/contentId';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await serviceSupabase
    .from('profiles').select('role').eq('id', user.id).single();

  const isCoach = profile?.role === 'coach';

  // calendlyProfileId = là où est stocké le token Calendly
  // Pour un élève : son propre profil (il est l'hôte de ses calls leads)
  // Pour un coach : son propre profil
  // leadsProfileId = là où sont stockés les leads IG et prospect_links
  let calendlyProfileId = user.id;
  let leadsProfileId = user.id;
  if (!isCoach) {
    const { data: clientRow } = await serviceSupabase
      .from('clients').select('coach_id').eq('profile_id', user.id).single();
    if (!clientRow?.coach_id) return NextResponse.json({ error: 'Coach introuvable' }, { status: 404 });
    // leadsProfileId reste user.id — les leads IG sont sous le client
    // calendlyProfileId reste user.id — l'élève héberge son propre Calendly leads
  }

  const accessToken = await getCalendlyToken(calendlyProfileId);
  if (!accessToken) {
    return NextResponse.json({ error: 'Token Calendly expiré — reconnecte Calendly dans les réglages', needsReconnect: true }, { status: 401 });
  }

  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meData = await meRes.json();
  const userUri = meData?.resource?.uri;
  if (!userUri) return NextResponse.json({ error: 'Profil Calendly introuvable' }, { status: 400 });

  // Stocke user_uri dans metadata pour que le webhook Calendly puisse résoudre le profil organisateur
  // Le token Calendly est sur calendlyProfileId (le coach), pas leadsProfileId (l'élève)
  await serviceSupabase.from('integrations').update({
    metadata: { ...meData?.resource, user_uri: userUri },
  }).eq('profile_id', calendlyProfileId).eq('provider', 'calendly');

  // min_start_time = 30 jours avant aujourd'hui pour capturer tous les calls récents et futurs
  const minStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const eventsRes = await fetch(
    `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&status=active&count=100&min_start_time=${encodeURIComponent(minStart)}&sort=start_time:desc`,
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
    const invitee0 = invitees[0] || null;
    const inviteeEmail = invitee0?.email || null;
    const inviteeName = invitee0?.name || null;
    const questionsAndAnswers = invitee0?.questions_and_answers || null;
    const tracking = invitee0?.tracking || null;

    // Détection reschedule — deux cas :
    // CAS A : event canceled + rescheduled=true → stocker new_invitee sur l'ancien call
    // CAS B : nouvel event avec old_invitee → hériter les données de l'ancien call
    const oldInviteeUrl: string | null = invitee0?.old_invitee || null;
    const isRescheduled: boolean = invitee0?.rescheduled === true;
    const newInviteeUrl: string | null = invitee0?.new_invitee || null;
    const eventIsCanceled = event.status === 'canceled';
    let inheritedIgLeadId: string | null = null;
    let inheritedProspectLinkId: string | null = null;
    let inheritedUtmCampaign: string | null = null;
    let inheritedUtmContent: string | null = null;
    let inheritedSource: string | null = null;

    if (eventIsCanceled && isRescheduled && newInviteeUrl) {
      // CAS A : ancien call — on stocke le lien vers le futur event
      await serviceSupabase.from('calls')
        .update({ status: 'canceled', next_rescheduled_uri: newInviteeUrl })
        .eq('calendly_event_uuid', eventUuid);
    } else if (oldInviteeUrl) {
      // CAS B : nouvel event — on hérite depuis l'ancien call
      const oldEventUuid = oldInviteeUrl.split('/').at(-3) || null;
      if (oldEventUuid) {
        const { data: oldCall } = await serviceSupabase
          .from('calls')
          .select('id, ig_lead_id, prospect_link_id, utm_campaign, utm_content, source')
          .eq('calendly_event_uuid', oldEventUuid)
          .maybeSingle();
        if (oldCall) {
          inheritedIgLeadId = oldCall.ig_lead_id ?? null;
          inheritedProspectLinkId = oldCall.prospect_link_id ?? null;
          inheritedUtmCampaign = oldCall.utm_campaign ?? null;
          inheritedUtmContent = oldCall.utm_content ?? null;
          inheritedSource = oldCall.source ?? null;
          await serviceSupabase.from('calls')
            .update({ status: 'canceled' })
            .eq('id', oldCall.id);
        }
      }
    }
    const rawUtmSource = tracking?.utm_source || null;
    const utmMedium = tracking?.utm_medium || null;
    const utmCampaign = tracking?.utm_campaign || null;
    const utmContent = tracking?.utm_content || null;
    const shortLinkPath = utmContent || null;
    const igUserIdFromUtm = utmCampaign?.startsWith('lead-') ? utmCampaign.slice(5) : null;
    // Normaliser utm_source : le domaine Short.io peut être n'importe quel alias.
    // On dérive ig/yt depuis utm_medium (description/bio → vérifier le medium) ou depuis le domaine connu.
    const normalizeUtmSource = (src: string | null, medium: string | null): string | null => {
      if (!src) return null;
      const s = src.toLowerCase();
      if (s === 'ig' || s === 'instagram') return 'ig';
      if (s === 'yt' || s === 'youtube') return 'yt';
      // Domaine Short.io IG-like → ig
      if (s.includes('ubizenai') || s.includes('instagram')) return 'ig';
      // Domaine Short.io YT-like → yt (ajouter d'autres si besoin)
      if (s.includes('youtube') || s.includes('youtu.be')) return 'yt';
      return src; // conserver tel quel si non reconnu
    };
    const utmSource = normalizeUtmSource(rawUtmSource, utmMedium);
    const source = utmSource ? [utmSource, utmMedium].filter(Boolean).join('_') : null;

    // Résoudre ig_lead_id via UTM
    let igLeadId: string | null = null;
    if (igUserIdFromUtm) {
      const { data: leadRow } = await serviceSupabase
        .from('instagram_leads').select('id')
        .eq('ig_user_id', igUserIdFromUtm)
        .eq('profile_id', leadsProfileId)
        .order('detected_at', { ascending: false }).limit(1).maybeSingle();
      igLeadId = leadRow?.id ?? null;
    }

    // Résoudre prospect_link_id via short_link_path
    let prospectLinkId: string | null = null;
    if (shortLinkPath) {
      const { data: pl } = await serviceSupabase
        .from('prospect_links').select('id, ig_lead_id')
        .eq('profile_id', leadsProfileId)
        .filter('short_url', 'like', `%/${shortLinkPath}`)
        .maybeSingle();
      if (pl) {
        prospectLinkId = pl.id;
        igLeadId = igLeadId ?? pl.ig_lead_id ?? null;
      }
    }

    // Héritage depuis l'ancien call (reschedule) — fallback si pas trouvé via UTMs
    igLeadId = igLeadId ?? inheritedIgLeadId;
    prospectLinkId = prospectLinkId ?? inheritedProspectLinkId;

    let clientId: string | null = null;
    if (inviteeEmail) {
      // RPC get_profile_id_by_email (index direct sur auth.users) plutôt que
      // auth.admin.listUsers() — non paginé, ne retourne que les 50 premiers
      // utilisateurs et cesserait silencieusement de résoudre certains profils.
      const { data: matchedId } = await serviceSupabase.rpc('get_profile_id_by_email', { p_email: inviteeEmail });
      if (matchedId) {
        const { data } = await serviceSupabase.from('clients').select('id').eq('profile_id', matchedId).single();
        clientId = data?.id || null;
      }
    }

    // Upsert prospect non-IG (YT / Autres)
    const effectiveSource = igLeadId ? 'ig_dm' : (source ?? inheritedSource ?? null);
    const effectivePlatform: 'yt' | 'other' = effectiveSource?.toLowerCase().startsWith('yt') ? 'yt' : 'other';
    let prospectId: string | null = null;
    let prospectDeleted = false;
    if (!igLeadId) {
      // Vérifie si ce prospect a déjà été supprimé manuellement (même email = même personne)
      if (inviteeEmail) {
        const { data: deletedCall } = await serviceSupabase.from('calls')
          .select('id')
          .eq('coach_id', leadsProfileId)
          .eq('invitee_email', inviteeEmail)
          .eq('lead_deleted', true)
          .limit(1)
          .maybeSingle();
        if (deletedCall) prospectDeleted = true;
      }

      if (!prospectDeleted) {
        prospectId = await upsertProspect({
          profileId: leadsProfileId,
          platform: effectivePlatform,
          email: inviteeEmail,
          name: inviteeName,
          source: effectiveSource,
        });
        if (!prospectId) {
          console.warn('[calendly/sync] prospect non résolu — email et nom manquants, eventUuid:', eventUuid);
        }
      }
    }

    // Si le call existe déjà et est ignoré (supprimé manuellement), on ne le réimporte pas
    const { data: existingCall } = await serviceSupabase.from('calls')
      .select('id, ignored, utm_content')
      .eq('calendly_event_uuid', eventUuid)
      .maybeSingle();
    if (existingCall?.ignored) { synced++; continue; }

    // Champs de base — toujours écrits
    const baseUpsert: Record<string, any> = {
      coach_id: leadsProfileId,
      client_id: clientId,
      call_type: 'calendly',
      calendly_event_uuid: eventUuid,
      calendly_uri: event.uri,
      topic: eventName,
      scheduled_at: scheduledAt,
      duration,
      join_url: joinUrl,
      invitee_email: inviteeEmail,
      invitee_name: inviteeName,
      calendly_qa: questionsAndAnswers,
      status: 'active',
      ready: 'pending',
      reminder_sent: false,
    };
    if (effectiveSource)                       baseUpsert.source = effectiveSource;
    if (utmCampaign || inheritedUtmCampaign)   baseUpsert.utm_campaign = utmCampaign ?? inheritedUtmCampaign;
    if (utmMedium)                             baseUpsert.utm_medium = utmMedium;
    const newUtmContentSync = utmContent ?? inheritedUtmContent;
    // Garde anti-écrasement : voir commentaire équivalent dans
    // app/api/webhooks/calendly/route.ts — un resync périodique ne doit jamais remplacer
    // un utm_content déjà valide (vrai ID de contenu) par la valeur figée côté Calendly
    // au moment du clic initial (qui peut être un pseudo, cf. bug PageLiens.tsx corrigé).
    // Recopiee a la main, cette garde avait DIVERGE de la regle partagee : la
    // branche « sinon j'ecris quand meme » reinscrivait une valeur invalide des
    // lors que la base etait vide — exactement ce que resolveUtmContent refuse, et
    // ce que le commentaire ci-dessus pretendait empecher. On appelle desormais la
    // fonction partagee, comme les trois autres appelants.
    const contenuValideSync = resolveUtmContent(newUtmContentSync, existingCall?.utm_content);
    if (contenuValideSync !== undefined) baseUpsert.utm_content = contenuValideSync;
    // ⚠️ short_link_path porte la MEME valeur qu'utm_content — c'est litteralement
    // `utmContent` (voir sa definition plus haut). Il recevait pourtant la valeur
    // BRUTE quand utm_content recevait la valeur VALIDEE : la garde ne protegeait
    // qu'une des deux copies, et l'autre accueillait exactement ce que la garde
    // existe pour recaler (le pseudo fige par Calendly, cf. les 40 anomalies du
    // 2026-08-19). Les deux colonnes suivent desormais la meme valeur, donc elles
    // ne peuvent plus diverger.
    if (contenuValideSync !== undefined) baseUpsert.short_link_path = contenuValideSync;
    if (igLeadId)        baseUpsert.ig_lead_id = igLeadId;
    if (prospectLinkId)  baseUpsert.prospect_link_id = prospectLinkId;
    if (prospectId)      baseUpsert.prospect_id = prospectId;

    // Prospect supprimé manuellement → nouveau call fantôme : ignoré, ne compte nulle part
    if (prospectDeleted) {
      await serviceSupabase.from('calls').upsert(
        { ...baseUpsert, ignored: true, lead_deleted: true, prospect_id: null },
        { onConflict: 'calendly_event_uuid' }
      );
      synced++;
      continue;
    }

    // Nouveau call pour un lead IG connu : canceller les anciens calls actifs sans rapport terminal
    // Évite l'accumulation de doublons quand le cron poll sans recevoir les webhooks d'annulation
    // On laisse intact les calls avec outcome terminal (no_show, closed, not_qualified, to_recontact, second_call)
    if (!existingCall && igLeadId) {
      await serviceSupabase.from('calls')
        .update({ status: 'canceled' })
        .eq('coach_id', leadsProfileId)
        .eq('ig_lead_id', igLeadId)
        .eq('status', 'active')
        .not('outcome', 'in', '("no_show","closed","not_qualified","to_recontact","second_call")')
        .neq('calendly_event_uuid', eventUuid);
    }

    const { data: callRow } = await serviceSupabase.from('calls').upsert(
      baseUpsert,
      { onConflict: 'calendly_event_uuid' }
    ).select('id').maybeSingle();

    // Événement call_booked dans prospect_events (fire-and-forget)
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
        if (evtErr) console.error('[calendly/sync] prospect_events upsert:', evtErr.message);
      });
    }

    synced++;
  }

  return NextResponse.json({ ok: true, synced, total: events.length });
}
