import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/tasks?client_id=<id>
// Coach : sans client_id → toutes les tâches de tous ses élèves (vue globale /tasks).
//         avec client_id → tâches de cet élève précis (doit lui appartenir).
//         Ne voit jamais les tâches added_by='client' — privées à l'élève qui les a créées.
// Élève : toujours ses propres tâches (les siennes + celles du coach), client_id ignoré s'il
//         ne correspond pas à son profil.
export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const clientIdParam = request.nextUrl.searchParams.get('client_id');

  if (profile?.role === 'coach') {
    let query = serviceSupabase
      .from('tasks')
      .select('*, clients!inner(id, name, coach_id)')
      .eq('clients.coach_id', user.id)
      .eq('added_by', 'coach')
      .order('deadline', { ascending: true, nullsFirst: false });

    if (clientIdParam) query = query.eq('client_id', clientIdParam);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tasks: data });
  }

  // Élève : ses propres tâches uniquement
  const { data: clientRow } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!clientRow) return NextResponse.json({ tasks: [] });

  const { data, error } = await serviceSupabase
    .from('tasks')
    .select('*')
    .eq('client_id', clientRow.id)
    .order('deadline', { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}

// POST /api/tasks
// Body coach : { client_id: string, label, deadline?, priority?, requires_attachment?, attachment_items?: string[] }
//           ou { client_ids: string[], ... } pour assigner la même tâche à plusieurs élèves
//           en une fois (une ligne tasks indépendante par élève sélectionné).
// Body élève : { label: string, deadline?: string, priority?: string } (client_id résolu automatiquement)
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const body = await request.json().catch(() => ({}));
  if (typeof body.label !== 'string' || !body.label.trim()) {
    return NextResponse.json({ error: 'Le titre est obligatoire' }, { status: 400 });
  }

  if (profile?.role === 'coach') {
    const clientIds: string[] = Array.isArray(body.client_ids) && body.client_ids.length > 0
      ? body.client_ids.filter((id: unknown) => typeof id === 'string')
      : (typeof body.client_id === 'string' ? [body.client_id] : []);

    if (clientIds.length === 0) {
      return NextResponse.json({ error: 'client_id ou client_ids est obligatoire pour le coach' }, { status: 400 });
    }

    const { data: clientRows } = await serviceSupabase
      .from('clients')
      .select('id, coach_id')
      .in('id', clientIds);

    const validIds = (clientRows ?? []).filter(c => c.coach_id === user.id).map(c => c.id);
    if (validIds.length !== clientIds.length) {
      return NextResponse.json({ error: 'Accès refusé sur un ou plusieurs élèves' }, { status: 403 });
    }

    const requiresAttachment = body.requires_attachment === true;
    const attachmentItems: string[] = Array.isArray(body.attachment_items)
      ? body.attachment_items.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0).map((s: string) => s.trim())
      : [];

    const rows = validIds.map(clientId => ({
      client_id: clientId,
      label: body.label.trim(),
      done: false,
      deadline: typeof body.deadline === 'string' ? body.deadline : null,
      priority: ['high', 'medium', 'low'].includes(body.priority) ? body.priority : 'medium',
      added_by: 'coach' as const,
      created_by: user.id,
      requires_attachment: requiresAttachment,
      attachment_instructions: null,
    }));

    const { data: insertedTasks, error } = await serviceSupabase.from('tasks').insert(rows).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (requiresAttachment && attachmentItems.length > 0 && insertedTasks) {
      const itemRows = insertedTasks.flatMap(t =>
        attachmentItems.map((label, i) => ({ task_id: t.id, label, position: i }))
      );
      const { error: itemsError } = await serviceSupabase.from('task_attachment_items').insert(itemRows);
      if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    return NextResponse.json({ tasks: insertedTasks });
  }

  const { data: clientRow } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!clientRow) return NextResponse.json({ error: 'Profil élève introuvable' }, { status: 404 });

  const { data, error } = await serviceSupabase
    .from('tasks')
    .insert({
      client_id: clientRow.id,
      label: body.label.trim(),
      done: false,
      deadline: typeof body.deadline === 'string' ? body.deadline : null,
      priority: ['high', 'medium', 'low'].includes(body.priority) ? body.priority : 'medium',
      added_by: 'client',
      created_by: user.id,
      requires_attachment: false,
      attachment_instructions: null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
