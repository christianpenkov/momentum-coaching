import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/depot-files/[fileId]/comments — commenter un fichier déposé.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { text } = await req.json();
  if (!text || !text.trim()) return NextResponse.json({ error: 'Commentaire vide' }, { status: 400 });

  const { data: file } = await serviceSupabase
    .from('depot_files')
    .select('id, client_id, clients(coach_id, profile_id)')
    .eq('id', fileId)
    .single();

  if (!file) return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 });

  const client = Array.isArray(file.clients) ? file.clients[0] : file.clients;
  const hasAccess = client?.coach_id === user.id || client?.profile_id === user.id;
  if (!hasAccess) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data: comment, error: insertErr } = await serviceSupabase
    .from('depot_comments')
    .insert({ file_id: fileId, author_id: user.id, text: text.trim() })
    .select('id, text, created_at, author_id, author:profiles!depot_comments_author_id_fkey(full_name, role)')
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ comment });
}
