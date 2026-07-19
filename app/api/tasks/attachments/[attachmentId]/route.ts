import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// DELETE /api/tasks/attachments/[attachmentId]
// Seul l'auteur de l'upload ou le coach du client concerné peut supprimer.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const { attachmentId } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: attachment } = await serviceSupabase
    .from('task_attachments')
    .select('id, uploaded_by, file_url, thumbnail_url, tasks(client_id, clients(coach_id, profile_id))')
    .eq('id', attachmentId)
    .single();

  if (!attachment) return NextResponse.json({ error: 'Pièce jointe introuvable' }, { status: 404 });

  const task = Array.isArray(attachment.tasks) ? attachment.tasks[0] : attachment.tasks;
  const client = task ? (Array.isArray(task.clients) ? task.clients[0] : task.clients) : null;
  const allowed = attachment.uploaded_by === user.id || client?.coach_id === user.id || client?.profile_id === user.id;
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  await serviceSupabase.from('task_attachments').delete().eq('id', attachmentId);

  // Best-effort : supprimer le fichier du storage (path déductible de l'URL publique)
  const extractPath = (url: string) => {
    const marker = '/task-attachments/';
    const idx = url.indexOf(marker);
    return idx === -1 ? null : url.slice(idx + marker.length);
  };
  const paths = [attachment.file_url, attachment.thumbnail_url]
    .filter((u): u is string => !!u)
    .map(extractPath)
    .filter((p): p is string => !!p);
  if (paths.length > 0) {
    await serviceSupabase.storage.from('task-attachments').remove(paths);
  }

  return NextResponse.json({ ok: true });
}
