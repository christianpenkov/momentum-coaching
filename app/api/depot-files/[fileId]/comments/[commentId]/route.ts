import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// DELETE /api/depot-files/[fileId]/comments/[commentId]
// Seul l'auteur du commentaire peut le supprimer — ni le coach ni l'autre partie,
// même avec accès au fichier (décision produit, règle plus stricte que pour le fichier).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string; commentId: string }> }
) {
  const { commentId } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: comment } = await serviceSupabase
    .from('depot_comments')
    .select('id, author_id')
    .eq('id', commentId)
    .single();

  if (!comment) return NextResponse.json({ error: 'Commentaire introuvable' }, { status: 404 });
  if (comment.author_id !== user.id) {
    return NextResponse.json({ error: 'Seul l\'auteur du commentaire peut le supprimer' }, { status: 403 });
  }

  await serviceSupabase.from('depot_comments').delete().eq('id', commentId);

  return NextResponse.json({ ok: true });
}
