import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data, error } = await serviceSupabase
    .from('lead_magnets')
    .select('id, name, url, keyword, bio_ig_url, bio_yt_url, bio_ig_source_url, bio_yt_source_url, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lead_magnets: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { name, url, keyword } = body;

  if (!url?.trim()) return NextResponse.json({ error: 'URL requise' }, { status: 400 });

  const normalizedUrl = normalizeUrl(url);
  const cleanKeyword = (keyword || '').toUpperCase().trim().replace(/\s+/g, '');

  const { data, error } = await serviceSupabase
    .from('lead_magnets')
    .insert({ profile_id: user.id, name: name?.trim() || normalizedUrl, url: normalizedUrl, keyword: cleanKeyword })
    .select('id, name, url, keyword, bio_ig_url, bio_yt_url, bio_ig_source_url, bio_yt_source_url, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lead_magnet: data });
}

export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { id, name, url, keyword, bio_ig_url, bio_yt_url, bio_ig_source_url, bio_yt_source_url } = body;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const patch: Record<string, any> = {};
  if (url !== undefined) { patch.url = normalizeUrl(url); patch.name = name?.trim() || normalizeUrl(url); }
  if (keyword !== undefined) patch.keyword = (keyword || '').toUpperCase().trim().replace(/\s+/g, '');
  if (bio_ig_url !== undefined) patch.bio_ig_url = bio_ig_url;
  if (bio_yt_url !== undefined) patch.bio_yt_url = bio_yt_url;
  if (bio_ig_source_url !== undefined) patch.bio_ig_source_url = bio_ig_source_url;
  if (bio_yt_source_url !== undefined) patch.bio_yt_source_url = bio_yt_source_url;

  const { data, error } = await serviceSupabase
    .from('lead_magnets')
    .update(patch)
    .eq('id', id)
    .eq('profile_id', user.id)
    .select('id, name, url, keyword, bio_ig_url, bio_yt_url, bio_ig_source_url, bio_yt_source_url, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lead_magnet: data });
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const { error } = await serviceSupabase
    .from('lead_magnets')
    .delete()
    .eq('id', id)
    .eq('profile_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
