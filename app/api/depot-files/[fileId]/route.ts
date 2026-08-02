import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// DELETE /api/depot-files/[fileId]
// Seul celui qui a déposé le fichier peut le supprimer (décision produit : ni le
// coach ni l'élève du dossier ne peuvent supprimer un dépôt fait par l'autre partie).
// ?force=true requis si le fichier a des commentaires liés, sinon 409 has_comments.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  const force = request.nextUrl.searchParams.get('force') === 'true';

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: file } = await serviceSupabase
    .from('depot_files')
    .select('id, uploader_id, storage_path, client_id, clients(coach_id, profile_id)')
    .eq('id', fileId)
    .single();

  if (!file) return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 });

  const client = Array.isArray(file.clients) ? file.clients[0] : file.clients;
  const hasAccess = client?.coach_id === user.id || client?.profile_id === user.id;
  if (!hasAccess) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  if (file.uploader_id !== user.id) {
    return NextResponse.json({ error: 'Seul l\'auteur du dépôt peut le supprimer' }, { status: 403 });
  }

  const { count: commentCount } = await serviceSupabase
    .from('depot_comments')
    .select('id', { count: 'exact', head: true })
    .eq('file_id', fileId);

  if ((commentCount || 0) > 0 && !force) {
    return NextResponse.json({ error: 'has_comments', commentCount }, { status: 409 });
  }

  await serviceSupabase.from('depot_files').delete().eq('id', fileId);
  // depot_comments.file_id a ON DELETE CASCADE en base — pas de suppression explicite nécessaire.

  if (file.storage_path) {
    await serviceSupabase.storage.from('depot-files').remove([file.storage_path]);
  }

  return NextResponse.json({ ok: true });
}
