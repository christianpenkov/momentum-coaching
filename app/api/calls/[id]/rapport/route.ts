import { NextRequest, NextResponse } from 'next/server';
import { requireCallAccess, serviceSupabase } from '@/lib/callAccess';

// Mapping outcome → stage pipeline
function outcomeToStage(outcome: string): string | null {
  switch (outcome) {
    case 'closed':       return 'closed';
    case 'no_show':      return null; // recul vers meilleure étape connue
    case 'rescheduled':  return 'call_booked'; // reste en call_booked avec badge orange
    case 'showed_up':
    case 'second_call':
    case 'to_recontact':
    case 'not_qualified': return 'showed_up';
    default:             return null;
  }
}

// Meilleure étape connue avant le call (pour no_show)
async function getBestKnownStage(profileId: string, igLeadId: string, igUsername: string): Promise<string> {
  const { data: events } = await serviceSupabase
    .from('prospect_events')
    .select('event_type')
    .eq('profile_id', profileId)
    .eq('ig_lead_id', igLeadId)
    .in('event_type', ['link_clicked', 'calendly_link_sent', 'call_booked']);

  const types = new Set((events || []).map((e: any) => e.event_type));
  if (types.has('link_clicked'))      return 'link_clicked';
  if (types.has('calendly_link_sent')) return 'calendly_sent';

  // Fallback : hook_replied sur le lead
  const { data: lead } = await serviceSupabase
    .from('instagram_leads')
    .select('hook_replied')
    .eq('id', igLeadId)
    .single();
  if (lead?.hook_replied) return 'in_convo';

  return 'lm_sent';
}

// PATCH /api/calls/[id]/rapport
// Body: { no_show?: boolean, deal_closed?: boolean, revenue?: number, outcome?: string, qualified?: boolean }
// Seul l'élève hôte du call (coach_id = user.id pour les calls Calendly) peut remplir.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Authentification + contrôle d'appartenance : logique déplacée telle quelle dans
  // lib/callAccess.ts, partagée avec la route des brouillons. C'est la seule
  // définition de « qui a le droit de toucher ce call » — l'avertissement sur
  // client_id des calls Calendly y est conservé intégralement.
  const access = await requireCallAccess(id);
  if (!access.ok) return access.response;

  // Champs propres au lien pipeline, hors du périmètre du contrôle d'accès.
  const { data: call } = await serviceSupabase
    .from('calls')
    .select('id, coach_id, ig_lead_id, source, prospect_id')
    .eq('id', id)
    .single();

  if (!call) return NextResponse.json({ error: 'Call introuvable' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (typeof body.no_show === 'boolean')    patch.no_show = body.no_show;
  if (typeof body.deal_closed === 'boolean') patch.deal_closed = body.deal_closed;
  if (typeof body.revenue === 'number')     patch.revenue = body.revenue;
  if (typeof body.outcome === 'string')     patch.outcome = body.outcome;
  if (typeof body.qualified === 'boolean')  patch.qualified = body.qualified;
  if (typeof body.lead_rapport_comment === 'string') patch.lead_rapport_comment = body.lead_rapport_comment.slice(0, 2000) || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucune donnée à mettre à jour' }, { status: 400 });
  }

  const { error } = await serviceSupabase
    .from('calls')
    .update(patch)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Mise à jour pipeline automatique si le call est lié à un lead IG ──
  const outcome = typeof body.outcome === 'string' ? body.outcome : null;
  const igLeadId: string | null = call.ig_lead_id ?? null;

  if (outcome && igLeadId) {
    // Récupère ig_username pour prospect_key
    const { data: lead } = await serviceSupabase
      .from('instagram_leads')
      .select('ig_username, profile_id')
      .eq('id', igLeadId)
      .single();

    if (lead?.ig_username) {
      const profileId: string = lead.profile_id;
      const prospectKey: string = lead.ig_username.toLowerCase();

      let targetStage: string;
      if (outcome === 'no_show') {
        targetStage = await getBestKnownStage(profileId, igLeadId, lead.ig_username);
      } else {
        targetStage = outcomeToStage(outcome) ?? 'showed_up';
      }

      // Upsert pipeline_override — fire and forget (non bloquant pour la réponse)
      serviceSupabase.from('pipeline_overrides').upsert({
        profile_id:   profileId,
        prospect_key: prospectKey,
        platform:     'ig',
        stage:        targetStage,
        reason:       `rapport:${outcome}`,
        updated_at:   new Date().toISOString(),
      }, { onConflict: 'profile_id,prospect_key,platform' }).then(({ error: ovErr }) => {
        if (ovErr) console.error('[rapport] pipeline_override upsert:', ovErr.message);
      });
    }
  }

  // ── Leads non-IG (YT, bio, autres) — pipeline override via prospect_id ──
  if (outcome && !igLeadId) {
    const platform: 'yt' | 'other' = call.source?.toLowerCase().startsWith('yt') ? 'yt' : 'other';
    const targetStage = outcome === 'no_show'
      ? 'calendly_sent'
      : (outcomeToStage(outcome) ?? 'showed_up');
    // prospect_id = fiche prospect persistante → même key si le lead rebook un 2ème call
    const prospectKey: string = call.prospect_id ?? call.id;

    serviceSupabase.from('pipeline_overrides').upsert({
      profile_id:   call.coach_id,
      prospect_key: prospectKey,
      platform,
      stage:        targetStage,
      reason:       `rapport:${outcome}`,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'profile_id,prospect_key,platform' }).then(({ error: ovErr }) => {
      if (ovErr) console.error('[rapport] pipeline_override non-IG upsert:', ovErr.message);
    });
  }

  return NextResponse.json({ ok: true });
}
