import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function assertAccess(userId: string, taskId: string) {
  const { data: task } = await serviceSupabase
    .from('tasks')
    .select('id, client_id, clients(coach_id, profile_id)')
    .eq('id', taskId)
    .single();
  if (!task) return { allowed: false };
  const client = Array.isArray(task.clients) ? task.clients[0] : task.clients;
  return { allowed: client?.coach_id === userId || client?.profile_id === userId };
}

// GET /api/tasks/[id]/attachment-items — items de documents attendus + leurs fichiers déposés,
// en une seule requête imbriquée (évite le N+1 côté client).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { allowed } = await assertAccess(user.id, taskId);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data, error } = await serviceSupabase
    .from('task_attachment_items')
    .select('*, task_attachments(*)')
    .eq('task_id', taskId)
    .order('position', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data });
}
