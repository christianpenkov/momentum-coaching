import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Suppression définitive et sans exception d'un client : calls, messages, tasks,
// session_reports, depot_files, weekly_metrics sont nettoyés via ON DELETE CASCADE en
// base. resource_access n'a AUCUNE contrainte de clé étrangère (bug de schéma
// préexistant) — on la nettoie manuellement ici pour ne pas laisser d'orphelins.
// Si le client a un compte élève actif (profile_id renseigné), ce compte auth est
// aussi supprimé pour ne pas laisser un espace élève "cassé" sans fiche client.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: clientRow, error: fetchErr } = await serviceSupabase
    .from('clients')
    .select('id, profile_id, coach_id')
    .eq('id', id)
    .single();

  if (fetchErr || !clientRow) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
  if (clientRow.coach_id !== user.id) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  if (clientRow.profile_id) {
    await serviceSupabase.from('resource_access').delete().eq('client_id', clientRow.profile_id);
    await serviceSupabase.auth.admin.deleteUser(clientRow.profile_id);
  }

  const { error: deleteErr } = await serviceSupabase.from('clients').delete().eq('id', id);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
