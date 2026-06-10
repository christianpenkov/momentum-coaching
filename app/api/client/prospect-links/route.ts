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

  const { data, error } = await supa
    .from('prospect_links')
    .select('*')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ links: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { ig_username, short_url, content_id } = body;
  if (!ig_username || !short_url) return NextResponse.json({ error: 'ig_username et short_url requis' }, { status: 400 });
  if (ig_username.length > 100) return NextResponse.json({ error: 'ig_username trop long' }, { status: 400 });

  // Résoudre ig_lead_id depuis instagram_leads (leads stockés sous le profile_id du client)
  const { data: leadRow } = await supa
    .from('instagram_leads')
    .select('id')
    .eq('profile_id', user.id)
    .eq('ig_username', ig_username)
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const ig_lead_id = leadRow?.id ?? null;

  const { data, error } = await supa
    .from('prospect_links')
    .insert({ profile_id: user.id, ig_username, short_url, content_id: content_id || null, ig_lead_id })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Pose un override calendly_sent avec updated_at = now — un clic antérieur ne court-circuite pas l'étape
  supa.from('pipeline_overrides')
    .upsert({
      profile_id:   user.id,
      prospect_key: ig_username,
      platform:     'ig',
      stage:        'calendly_sent',
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'profile_id,prospect_key,platform' })
    .then(({ error: upsertErr }) => {
      if (upsertErr) console.error('[prospect-links] pipeline_overrides upsert:', upsertErr.message);
    });

  // Événement calendly_link_sent dans prospect_events (fire-and-forget)
  supa.from('prospect_events').insert({
    profile_id:       user.id,
    prospect_key:     ig_username,
    platform:         'ig',
    event_type:       'calendly_link_sent',
    occurred_at:      new Date().toISOString(),
    ig_lead_id:       ig_lead_id ?? null,
    prospect_link_id: data.id,
  }).then(({ error: evtErr }) => {
    if (evtErr) console.error('[prospect-links] prospect_events insert:', evtErr.message);
  });

  return NextResponse.json({ link: data });
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const { error } = await supa
    .from('prospect_links')
    .delete()
    .eq('id', id)
    .eq('profile_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
