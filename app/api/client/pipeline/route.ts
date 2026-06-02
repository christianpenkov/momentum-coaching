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

  const [leadsRes, prospectsRes, callsRes, overridesRes] = await Promise.all([
    supa.from('instagram_leads')
      .select('id, ig_username, ig_user_id, keyword_matched, lead_magnet_sent, hook_replied, tracking_link, detected_at, media_id, source')
      .eq('profile_id', user.id)
      .eq('lead_magnet_sent', true)
      .order('detected_at', { ascending: false }),
    supa.from('prospect_links')
      .select('id, ig_username, short_url, content_id, created_at, short_link_path')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false }),
    supa.from('calls')
      .select('id, invitee_name, invitee_email, scheduled_at, status, no_show, deal_closed, revenue, source, ig_lead_id, utm_content, utm_medium, short_link_path, created_at')
      .or(`coach_id.eq.${user.id},client_id.in.(select id from clients where profile_id = '${user.id}')`)
      .order('scheduled_at', { ascending: false }),
    supa.from('pipeline_overrides')
      .select('prospect_key, platform, stage, updated_at')
      .eq('profile_id', user.id),
  ]);

  return NextResponse.json({
    leads: leadsRes.data ?? [],
    prospects: prospectsRes.data ?? [],
    calls: callsRes.data ?? [],
    overrides: overridesRes.data ?? [],
  });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { prospect_key, platform, stage } = body;
  if (!prospect_key || !platform || !stage) return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });

  const { error } = await supa.from('pipeline_overrides').upsert({
    profile_id: user.id, prospect_key, platform, stage, updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,prospect_key,platform' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
