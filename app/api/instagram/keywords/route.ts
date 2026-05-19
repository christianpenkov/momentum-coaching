import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data, error } = await supabase
    .from('lead_magnet_keywords')
    .select('id, keyword, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keywords: data || [] });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { keyword } = await request.json();
  if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
    return NextResponse.json({ error: 'Mot-clé invalide' }, { status: 400 });
  }

  const clean = keyword.trim().toLowerCase();
  if (clean.length > 50) return NextResponse.json({ error: 'Mot-clé trop long (max 50 caractères)' }, { status: 400 });

  // Max 20 mots-clés par profil
  const { count } = await supabase
    .from('lead_magnet_keywords')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', user.id);

  if ((count || 0) >= 20) {
    return NextResponse.json({ error: 'Maximum 20 mots-clés atteint' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('lead_magnet_keywords')
    .insert({ profile_id: user.id, keyword: clean })
    .select('id, keyword, created_at')
    .single();

  if (error?.code === '23505') return NextResponse.json({ error: 'Ce mot-clé existe déjà' }, { status: 409 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keyword: data });
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

  const { error } = await supabase
    .from('lead_magnet_keywords')
    .delete()
    .eq('id', id)
    .eq('profile_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
