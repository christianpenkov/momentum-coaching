import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PATCH /api/session-reports/[id]/acknowledge
// Marque un no-show comme pris en compte par le coach (acknowledged_at). Réservé au
// coach propriétaire du rapport de session.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: report } = await serviceSupabase
    .from('session_reports')
    .select('id, coach_id')
    .eq('id', id)
    .single();

  if (!report) return NextResponse.json({ error: 'Rapport introuvable' }, { status: 404 });
  if (report.coach_id !== user.id) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { error } = await serviceSupabase
    .from('session_reports')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
