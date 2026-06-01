import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = 20;
  const offset = (page - 1) * limit;

  let targetProfileId = user.id;
  let isCoach = false;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (profileId && !UUID_RE.test(profileId)) return NextResponse.json({ error: 'profileId invalide' }, { status: 400 });

  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
    isCoach = true;
  }

  const { data: leads, error, count } = await serviceSupabase
    .from('instagram_leads')
    .select('*', { count: 'exact' })
    .eq('profile_id', targetProfileId)
    .order('detected_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Le coach ne voit pas les infos personnelles (username, user_id, message)
  const sanitized = (leads || []).map(l => isCoach ? {
    id: l.id,
    source: l.source,
    keyword_matched: l.keyword_matched,
    detected_at: l.detected_at,
  } : l);

  // Compteurs par source
  const { data: counts } = await serviceSupabase
    .from('instagram_leads')
    .select('source')
    .eq('profile_id', targetProfileId)
    .gte('detected_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const dmCount = (counts || []).filter(l => l.source === 'dm').length;
  const commentCount = (counts || []).filter(l => l.source === 'comment').length;

  return NextResponse.json({
    leads: sanitized,
    total: count || 0,
    page,
    dmCount30d: dmCount,
    commentCount30d: commentCount,
  });
}

// Marquer comme lu
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

  const { error } = await supabase
    .from('instagram_leads')
    .update({ read: true })
    .eq('id', id)
    .eq('profile_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
