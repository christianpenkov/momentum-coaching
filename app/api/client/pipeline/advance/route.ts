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
  const today = now.slice(0, 10); // YYYY-MM-DD
  const targetIdx = IG_PRE_CALL.indexOf(target_stage as IgPreCallStage);

  // Récupérer lead + prospect_link en parallèle (nécessaire pour les events et le snapshot)
  const [{ data: lead }, { data: pl }] = await Promise.all([
    supa.from('instagram_leads').select('id').eq('profile_id', user.id).eq('ig_username', username).maybeSingle(),
    supa.from('prospect_links').select('id, short_url, calendly_link_sent_at').eq('profile_id', user.id).eq('ig_username', username).maybeSingle(),
  ]);

  const ops: PromiseLike<any>[] = [];

  // ── in_convo : hook_replied ───────────────────────────────────────────────
  if (targetIdx >= IG_PRE_CALL.indexOf('in_convo')) {
    ops.push(
      supa.from('instagram_leads')
        .update({ hook_replied: true, hook_replied_at: now })
        .eq('profile_id', user.id)
        .eq('ig_username', username)
        .then()
    );
  }

  // ── calendly_sent : champs + event ────────────────────────────────────────
  if (targetIdx >= IG_PRE_CALL.indexOf('calendly_sent')) {
    ops.push(
      supa.from('prospect_links')
        .update({
          calendly_link_sent: true,
          calendly_link_sent_at: now,
          last_calendly_link_sent_at: now,
        })
        .eq('profile_id', user.id)
        .eq('ig_username', username)
        .then()
    );

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

  // ── link_clicked : first_click_at + event + snapshot Short.io ────────────
  if (target_stage === 'link_clicked' && pl) {
    ops.push(
      supa.from('prospect_links')
        .update({ first_click_at: now })
        .eq('profile_id', user.id)
        .eq('ig_username', username)
        .then()
    );

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

    // Écrire une ligne dans shortio_link_daily_snapshots pour que les stats
    // de clics soient identiques à un vrai clic Short.io détecté par le cron.
    // On récupère le link_id et le path depuis un snapshot existant pour ce short_url.
    if (pl.short_url) {
      const { data: existingSnapshot } = await supa
        .from('shortio_link_daily_snapshots')
        .select('link_id, path, original_url, link_type')
        .eq('profile_id', user.id)
        .eq('short_url', pl.short_url)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingSnapshot?.link_id) {
        // Upsert sur (profile_id, link_id, date) — contrainte d'unicité existante
        ops.push(
          supa.from('shortio_link_daily_snapshots').upsert({
            profile_id: user.id,
            link_id: existingSnapshot.link_id,
            path: existingSnapshot.path,
            short_url: pl.short_url,
            original_url: existingSnapshot.original_url ?? null,
            date: today,
            human_clicks: 1,
            total_clicks: 1,
            backfill_source: 'manual',
            link_type: existingSnapshot.link_type ?? 'dm',
            updated_at: now,
          }, { onConflict: 'profile_id,link_id,date', ignoreDuplicates: false }).then()
        );
      }
    }
  }

  await Promise.all(ops);
  return NextResponse.json({ ok: true });
}
