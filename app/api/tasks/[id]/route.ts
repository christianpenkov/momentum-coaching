import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
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

  if (!task) return { task: null, allowed: false };
  const client = Array.isArray(task.clients) ? task.clients[0] : task.clients;
  const allowed = client?.coach_id === userId || client?.profile_id === userId;
  return { task, allowed };
}

// PATCH /api/tasks/[id]
// Body: { done?: boolean, label?: string, deadline?: string | null, priority?: string }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { task, allowed } = await assertAccess(user.id, id);
  if (!task) return NextResponse.json({ error: 'Tâche introuvable' }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.done === 'boolean') patch.done = body.done;
  if (typeof body.label === 'string' && body.label.trim()) patch.label = body.label.trim();
  if (body.deadline === null || typeof body.deadline === 'string') patch.deadline = body.deadline;
  if (['high', 'medium', 'low'].includes(body.priority)) patch.priority = body.priority;

  const { error } = await serviceSupabase.from('tasks').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/tasks/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { task, allowed } = await assertAccess(user.id, id);
  if (!task) return NextResponse.json({ error: 'Tâche introuvable' }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { error } = await serviceSupabase.from('tasks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
