import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Récupère la date de connexion Calendly pour filtrer les vieux calls
  const { data: integRow } = await supa.from('integrations')
    .select('connected_at')
    .eq('profile_id', user.id)
    .eq('provider', 'calendly')
    .maybeSingle();
  const calendlyConnectedAt: string | null = integRow?.connected_at ?? null;

  let callsQuery = supa.from('calls')
    .select('id, invitee_name, invitee_email, scheduled_at, status, no_show, no_show_at, deal_closed, revenue, outcome, source, ig_lead_id, prospect_id, utm_content, utm_medium, utm_campaign, short_link_path, created_at, rescheduled, rescheduled_at, cancellation_reason, lead_deleted')
    .eq('coach_id', user.id)
    .not('calendly_event_uuid', 'is', null)
    .order('scheduled_at', { ascending: false });

  if (calendlyConnectedAt) {
    callsQuery = callsQuery.gte('scheduled_at', calendlyConnectedAt);
  }

  const [leadsRes, prospectsRes, nonIgProspectsRes, callsRes, overridesRes, clicksRes, eventsRes] = await Promise.all([
    supa.from('instagram_leads')
      .select('id, ig_username, ig_user_id, keyword_matched, lead_magnet_sent, hook_replied, hook_replied_at, tracking_link, detected_at, media_id, source')
      .eq('profile_id', user.id)
      .eq('lead_magnet_sent', true)
      .order('detected_at', { ascending: false }),
    supa.from('prospect_links')
      .select('id, ig_username, short_url, content_id, created_at, calendly_link_sent, calendly_link_sent_at, last_calendly_link_sent_at, first_click_at')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false }),
    supa.from('prospects')
      .select('id, platform, email, name, source, created_at')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false }),
    callsQuery,
    supa.from('pipeline_overrides')
      .select('prospect_key, platform, stage, updated_at, reason, natural_at_override')
      .eq('profile_id', user.id),
    supa.from('shortio_link_daily_snapshots')
      .select('short_url, human_clicks')
      .eq('profile_id', user.id)
      .gte('date', since30d),
    supa.from('prospect_events')
      .select('id, prospect_key, platform, event_type, occurred_at, ig_lead_id, prospect_link_id, call_id')
      .eq('profile_id', user.id)
      .order('occurred_at', { ascending: false }),
  ]);

  if (clicksRes.error) console.warn('[pipeline] shortio_link_daily_snapshots fetch failed:', clicksRes.error.message);
  if (eventsRes.error) console.warn('[pipeline] prospect_events fetch failed:', eventsRes.error.message);

  // Agrège human_clicks par short_url sur 30j
  const clicksByUrl = new Map<string, number>();
  for (const row of clicksRes.data ?? []) {
    if (!row.short_url) continue;
    clicksByUrl.set(row.short_url, (clicksByUrl.get(row.short_url) ?? 0) + (row.human_clicks ?? 0));
  }

  const prospects = (prospectsRes.data ?? []).map((p: any) => ({
    ...p,
    humanClicks30d: p.short_url ? (clicksByUrl.get(p.short_url) ?? 0) : 0,
  }));

  return NextResponse.json({
    leads: leadsRes.data ?? [],
    prospects,
    nonIgProspects: nonIgProspectsRes.data ?? [],
    calls: callsRes.data ?? [],
    overrides: overridesRes.data ?? [],
    events: eventsRes.data ?? [],
  });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { prospect_key, platform, stage, reason, natural_at_override } = body;
  if (!prospect_key || !platform || !stage) return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });

  const { error } = await supa.from('pipeline_overrides').upsert({
    profile_id: user.id, prospect_key, platform, stage, updated_at: new Date().toISOString(),
    ...(reason ? { reason } : {}),
    ...(natural_at_override !== undefined ? { natural_at_override } : {}),
  }, { onConflict: 'profile_id,prospect_key,platform' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { ig_username } = body;
  if (!ig_username) return NextResponse.json({ error: 'ig_username requis' }, { status: 400 });

  // Récupère les ig_lead_ids à supprimer avant de faire les deletes
  const { data: leadsToDelete } = await supa
    .from('instagram_leads')
    .select('id')
    .eq('profile_id', user.id)
    .eq('ig_username', ig_username);

  const leadIds = (leadsToDelete ?? []).map((l: any) => l.id);

  const deleteOps = [
    supa.from('instagram_leads').delete().eq('profile_id', user.id).eq('ig_username', ig_username).then(),
    supa.from('prospect_links').delete().eq('profile_id', user.id).eq('ig_username', ig_username).then(),
    supa.from('pipeline_overrides').delete().eq('profile_id', user.id).eq('prospect_key', ig_username).then(),
    // Nettoie les events liés au(x) lead(s) supprimé(s) pour éviter pollution du pipeline
    // si le même username recommente plus tard (nouveau lead, histoire repart de zéro)
    supa.from('prospect_events').delete().eq('profile_id', user.id).eq('prospect_key', ig_username.toLowerCase()).then(),
  ];

  // Si des ig_lead_ids existent, nettoie aussi par FK directe (redondant mais exhaustif)
  // + détache les calls liés pour éviter qu'un futur lead du même username les récupère
  if (leadIds.length > 0) {
    deleteOps.push(
      supa.from('prospect_events').delete().eq('profile_id', user.id).in('ig_lead_id', leadIds).then(),
      supa.from('calls').update({ ig_lead_id: null, prospect_link_id: null, lead_deleted: true })
        .eq('coach_id', user.id).in('ig_lead_id', leadIds).then(),
    );
  }

  await Promise.all(deleteOps);

  return NextResponse.json({ ok: true });
}
