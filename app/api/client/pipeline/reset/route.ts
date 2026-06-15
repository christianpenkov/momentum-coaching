import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Hiérarchie des stages IG pré-call (index = importance)
const IG_PRE_CALL = ['lm_sent', 'in_convo', 'calendly_sent', 'link_clicked'] as const;
type IgPreCallStage = typeof IG_PRE_CALL[number];

// Ce qui doit être effacé selon le stage cible
// Tout ce qui est "devant" le stage cible est supprimé
function getResetFields(targetStage: IgPreCallStage): {
  prospectLinkFields: Record<string, null | boolean | string>;
  deleteEventTypes: string[];
  deleteCalls: boolean;
  deleteHookReplied: boolean;
} {
  const idx = IG_PRE_CALL.indexOf(targetStage);

  return {
    // Effacer hook_replied si on va avant in_convo
    deleteHookReplied: idx < IG_PRE_CALL.indexOf('in_convo'),

    // Effacer les champs calendly si on va avant calendly_sent
    prospectLinkFields: idx < IG_PRE_CALL.indexOf('calendly_sent')
      ? {
          calendly_link_sent: false,
          calendly_link_sent_at: null,
          last_calendly_link_sent_at: null,
          first_click_at: null,
        }
      : idx < IG_PRE_CALL.indexOf('link_clicked')
      ? {
          first_click_at: null,
          // Avancer last_calendly_link_sent_at à maintenant pour que syncLmClickStream
          // considère l'ancien clic Short.io comme "avant l'envoi" et ne le recrée pas
          last_calendly_link_sent_at: new Date().toISOString(),
        }
      : {},

    // Events à supprimer
    deleteEventTypes: idx < IG_PRE_CALL.indexOf('in_convo')
      ? ['hook_replied', 'calendly_link_sent', 'link_clicked', 'call_booked']
      : idx < IG_PRE_CALL.indexOf('calendly_sent')
      ? ['calendly_link_sent', 'link_clicked', 'call_booked']
      : idx < IG_PRE_CALL.indexOf('link_clicked')
      ? ['link_clicked', 'call_booked']
      : ['call_booked'],

    // Supprimer les calls si on va avant call_booked (toujours vrai pour pré-call)
    deleteCalls: true,
  };
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { ig_username, target_stage } = body;
  if (!ig_username || !target_stage) return NextResponse.json({ error: 'ig_username et target_stage requis' }, { status: 400 });
  if (!IG_PRE_CALL.includes(target_stage)) return NextResponse.json({ error: 'target_stage invalide' }, { status: 400 });

  const username = ig_username.toLowerCase();
  const { prospectLinkFields, deleteEventTypes, deleteCalls, deleteHookReplied } = getResetFields(target_stage as IgPreCallStage);

  const ops: PromiseLike<any>[] = [];

  // 1. Reset hook_replied sur instagram_leads si nécessaire
  if (deleteHookReplied) {
    ops.push(
      supa.from('instagram_leads')
        .update({ hook_replied: false, hook_replied_at: null })
        .eq('profile_id', user.id)
        .eq('ig_username', username)
        .then()
    );
  }

  // 2. Reset champs prospect_links si nécessaire
  if (Object.keys(prospectLinkFields).length > 0) {
    ops.push(
      supa.from('prospect_links')
        .update(prospectLinkFields)
        .eq('profile_id', user.id)
        .eq('ig_username', username)
        .then()
    );
  }

  // 3. Supprimer les events concernés
  if (deleteEventTypes.length > 0) {
    ops.push(
      supa.from('prospect_events')
        .delete()
        .eq('profile_id', user.id)
        .eq('prospect_key', username)
        .eq('platform', 'ig')
        .in('event_type', deleteEventTypes)
        .then()
    );
  }

  // 4. Récupérer les ig_lead_ids pour détacher les calls
  if (deleteCalls) {
    const { data: leads } = await supa.from('instagram_leads')
      .select('id')
      .eq('profile_id', user.id)
      .eq('ig_username', username);
    const leadIds = (leads ?? []).map((l: any) => l.id);
    if (leadIds.length > 0) {
      ops.push(
        supa.from('prospect_events').delete().eq('profile_id', user.id).in('ig_lead_id', leadIds).neq('event_type', 'lm_clicked').then(),
        supa.from('calls').update({ ignored: true, ig_lead_id: null }).eq('coach_id', user.id).in('ig_lead_id', leadIds).then()
      );
    }
  }

  // 5. Supprimer le pipeline_override existant (le natural sera correct après reset)
  ops.push(
    supa.from('pipeline_overrides')
      .delete()
      .eq('profile_id', user.id)
      .eq('prospect_key', username)
      .eq('platform', 'ig')
      .then()
  );

  await Promise.all(ops);

  return NextResponse.json({ ok: true });
}
