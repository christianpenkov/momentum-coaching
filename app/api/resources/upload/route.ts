import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 });

  const ext = file.name.split('.').pop() || 'bin';
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const bytes = await file.arrayBuffer();
  const { error } = await supabase.storage
    .from('resources')
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: { publicUrl } } = supabase.storage.from('resources').getPublicUrl(path);

  return NextResponse.json({
    url: publicUrl,
    path,
    name: file.name,
    size: file.size,
    type: file.type,
  });
}
