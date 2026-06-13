import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const IG_PRE_CALL = ['lm_sent', 'in_convo', 'calendly_sent', 'link_clicked'] as const;
type IgPreCallStage = typeof IG_PRE_CALL[number];

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { ig_username, target_stage } = body;
  if (!ig_username || !target_stage) return NextResponse.json({ error: 'ig_username et target_stage requis' }, { status: 400 });
  if (!IG_PRE_CALL.includes(target_stage) || target_stage === 'lm_sent') {
    return NextResponse.json({ error: 'target_stage invalide pour un advance' }, { status: 400 });
  }

  const username = ig_username.toLowerCase();
  const now = new Date().toISOString();
  const targetIdx = IG_PRE_CALL.indexOf(target_stage as IgPreCallStage);
  const ops: PromiseLike<any>[] = [];

  // Écrire hook_replied si target >= in_convo
  if (targetIdx >= IG_PRE_CALL.indexOf('in_convo')) {
    ops.push(
      supa.from('instagram_leads')
        .update({ hook_replied: true, hook_replied_at: now })
        .eq('profile_id', user.id)
        .eq('ig_username', username)
        .then()
    );
  }

  // Écrire les champs calendly si target >= calendly_sent
  if (targetIdx >= IG_PRE_CALL.indexOf('calendly_sent')) {
    const linkUpdate: Record<string, any> = {
      calendly_link_sent: true,
      last_calendly_link_sent_at: now,
    };
    // calendly_link_sent_at = premier envoi, on ne l'écrase pas s'il existe déjà
    // mais comme c'est un advance manuel depuis zéro, on le set
    linkUpdate.calendly_link_sent_at = now;

    ops.push(
      supa.from('prospect_links')
        .update(linkUpdate)
        .eq('profile_id', user.id)
        .eq('ig_username', username)
        .then()
    );

    // Upsert event calendly_link_sent
    const { data: lead } = await supa.from('instagram_leads')
      .select('id')
      .eq('profile_id', user.id)
      .eq('ig_username', username)
      .maybeSingle();

    const { data: pl } = await supa.from('prospect_links')
      .select('id')
      .eq('profile_id', user.id)
      .eq('ig_username', username)
      .maybeSingle();

    if (pl) {
      ops.push(
        supa.from('prospect_events').upsert({
          profile_id: user.id,
          prospect_key: username,
          platform: 'ig',
          event_type: 'calendly_link_sent',
          occurred_at: now,
          ig_lead_id: lead?.id ?? null,
          prospect_link_id: pl.id,
        }, { onConflict: 'prospect_link_id,event_type', ignoreDuplicates: true }).then()
      );
    }
  }

  // Écrire first_click_at si target = link_clicked
  if (target_stage === 'link_clicked') {
    ops.push(
      supa.from('prospect_links')
        .update({ first_click_at: now })
        .eq('profile_id', user.id)
        .eq('ig_username', username)
        .then()
    );

    const { data: lead } = await supa.from('instagram_leads')
      .select('id')
      .eq('profile_id', user.id)
      .eq('ig_username', username)
      .maybeSingle();

    const { data: pl } = await supa.from('prospect_links')
      .select('id')
      .eq('profile_id', user.id)
      .eq('ig_username', username)
      .maybeSingle();

    if (pl) {
      ops.push(
        supa.from('prospect_events').upsert({
          profile_id: user.id,
          prospect_key: username,
          platform: 'ig',
          event_type: 'link_clicked',
          occurred_at: now,
          ig_lead_id: lead?.id ?? null,
          prospect_link_id: pl.id,
        }, { onConflict: 'prospect_link_id,event_type', ignoreDuplicates: true }).then()
      );
    }
  }

  await Promise.all(ops);
  return NextResponse.json({ ok: true });
}
