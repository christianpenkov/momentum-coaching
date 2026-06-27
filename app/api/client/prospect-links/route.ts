import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  // Si profileId fourni (vue coach), vérifier que l'élève appartient bien au coach
  let targetId = user.id;
  if (profileId) {
    const { data: clientRow } = await supa
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetId = profileId;
  }

  const { data, error } = await supa
    .from('prospect_links')
    .select('*')
    .eq('profile_id', targetId)
    .order('created_at', { ascending: false })
    .limit(500);

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

  // Résoudre ig_lead_id et keyword_matched depuis instagram_leads
  const { data: leadRow } = await supa
    .from('instagram_leads')
    .select('id, keyword_matched')
    .eq('profile_id', user.id)
    .eq('ig_username', ig_username)
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const ig_lead_id = leadRow?.id ?? null;
  const keyword_matched = leadRow?.keyword_matched ?? null;

  const { data, error } = await supa
    .from('prospect_links')
    .insert({ profile_id: user.id, ig_username, short_url, content_id: content_id || null, ig_lead_id, keyword_matched })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // NE PAS poser calendly_sent ici — le lien est créé mais pas encore envoyé.
  // L'override + prospect_events calendly_link_sent sont posés par le webhook IG
  // quand Meta envoie l'echo du DM contenant l'URL Short.io.

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
