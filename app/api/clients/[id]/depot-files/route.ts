import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_DOC_SIZE = 20 * 1024 * 1024;

async function assertAccess(userId: string, clientId: string) {
  const { data: client } = await serviceSupabase
    .from('clients')
    .select('id, coach_id, profile_id')
    .eq('id', clientId)
    .single();
  if (!client) return { allowed: false };
  return { allowed: client.coach_id === userId || client.profile_id === userId };
}

// GET /api/clients/[id]/depot-files — liste des fichiers déposés + commentaires.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { allowed } = await assertAccess(user.id, clientId);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data, error } = await serviceSupabase
    .from('depot_files')
    .select(`
      id, file_name, file_type, storage_path, created_at, uploader_id,
      uploader:profiles!depot_files_uploader_id_fkey(full_name, role),
      comments:depot_comments(
        id, text, created_at, author_id,
        author:profiles!depot_comments_author_id_fkey(full_name, role)
      )
    `)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const files = await Promise.all((data || []).map(async (f: any) => {
    let signedUrl: string | null = null;
    if (f.storage_path) {
      const { data: signed } = await serviceSupabase.storage
        .from('depot-files')
        .createSignedUrl(f.storage_path, 3600);
      signedUrl = signed?.signedUrl || null;
    }
    const comments = (f.comments || []).sort(
      (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    return { ...f, signed_url: signedUrl, comments };
  }));

  return NextResponse.json({ files });
}

// POST /api/clients/[id]/depot-files — dépôt d'un fichier sur la fiche client.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { allowed } = await assertAccess(user.id, clientId);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });

  const isImage = file.type.startsWith('image/');
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;
  if (file.size > maxSize) return NextResponse.json({ error: 'Fichier trop volumineux' }, { status: 400 });

  const ext = file.name.split('.').pop() || 'bin';
  const baseName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${clientId}/${baseName}.${ext}`;

  const bytes = await file.arrayBuffer();
  const { error: uploadErr } = await serviceSupabase.storage
    .from('depot-files')
    .upload(path, bytes, { contentType: file.type });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data: inserted, error: insertErr } = await serviceSupabase
    .from('depot_files')
    .insert({
      client_id: clientId,
      uploader_id: user.id,
      file_name: file.name,
      file_type: file.type,
      storage_path: path,
    })
    .select('id, file_name, file_type, storage_path, created_at, uploader_id, uploader:profiles!depot_files_uploader_id_fkey(full_name, role)')
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  const { data: signed } = await serviceSupabase.storage
    .from('depot-files')
    .createSignedUrl(path, 3600);

  return NextResponse.json({ file: { ...inserted, signed_url: signed?.signedUrl || null, comments: [] } });
}
