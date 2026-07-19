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
    .select('id, client_id, added_by, clients(coach_id, profile_id)')
    .eq('id', taskId)
    .single();

  if (!task) return { task: null, isCoach: false, isStudent: false };
  const client = Array.isArray(task.clients) ? task.clients[0] : task.clients;
  const isCoach = client?.coach_id === userId;
  const isStudent = client?.profile_id === userId;
  return { task, isCoach, isStudent };
}

// PATCH /api/tasks/[id]
// Body: { done?: boolean, label?: string, deadline?: string | null, priority?: string }
// Le coach peut tout modifier sur ses tâches. L'élève ne peut modifier que `done`, et
// uniquement sur ses propres tâches (added_by='client') ou celles du coach (added_by='coach') —
// mais jamais label/deadline/priority sur une tâche assignée par le coach.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { task, isCoach, isStudent } = await assertAccess(user.id, id);
  if (!task) return NextResponse.json({ error: 'Tâche introuvable' }, { status: 404 });
  if (!isCoach && !isStudent) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (isCoach) {
    if (typeof body.done === 'boolean') patch.done = body.done;
    if (typeof body.label === 'string' && body.label.trim()) patch.label = body.label.trim();
    if (body.deadline === null || typeof body.deadline === 'string') patch.deadline = body.deadline;
    if (['high', 'medium', 'low'].includes(body.priority)) patch.priority = body.priority;
  } else {
    // Élève : uniquement le statut done, jamais label/deadline/priority
    if (typeof body.done !== 'boolean') {
      return NextResponse.json({ error: 'Seul le statut de la tâche peut être modifié' }, { status: 403 });
    }
    patch.done = body.done;
  }

  const { error } = await serviceSupabase.from('tasks').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/tasks/[id]
// Seul le coach peut supprimer une tâche qu'il a assignée. L'élève peut supprimer
// uniquement ses propres tâches personnelles (added_by='client').
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { task, isCoach, isStudent } = await assertAccess(user.id, id);
  if (!task) return NextResponse.json({ error: 'Tâche introuvable' }, { status: 404 });

  const allowed = isCoach || (isStudent && task.added_by === 'client');
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { error } = await serviceSupabase.from('tasks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
