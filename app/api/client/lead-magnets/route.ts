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
    .select('id, name, url, keyword, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lead_magnets: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { name, url, keyword } = body;

  if (!url?.trim()) return NextResponse.json({ error: 'URL requise' }, { status: 400 });

  const normalizedUrl = normalizeUrl(url);
  const cleanKeyword = (keyword || '').toUpperCase().trim().replace(/\s+/g, '');

  const { data, error } = await serviceSupabase
    .from('lead_magnets')
    .insert({ profile_id: user.id, name: name?.trim() || normalizedUrl, url: normalizedUrl, keyword: cleanKeyword })
    .select('id, name, url, keyword, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lead_magnet: data });
}

export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id, name, url, keyword } = await request.json();
  if (!id || !url?.trim()) return NextResponse.json({ error: 'id et url requis' }, { status: 400 });

  const normalizedUrl = normalizeUrl(url);
  const cleanKeyword = (keyword || '').toUpperCase().trim().replace(/\s+/g, '');

  const { data, error } = await serviceSupabase
    .from('lead_magnets')
    .update({ name: name?.trim() || normalizedUrl, url: normalizedUrl, keyword: cleanKeyword })
    .eq('id', id)
    .eq('profile_id', user.id)
    .select('id, name, url, keyword, created_at')
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
