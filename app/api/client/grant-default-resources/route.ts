import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Appelé depuis /signup après l'assignation du profile_id.
// Crée des resource_access pour toutes les ressources is_default=true du coach.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { coach_id } = body as { coach_id?: string };
  if (!coach_id) return NextResponse.json({ error: 'coach_id requis' }, { status: 400 });

  // Récupérer toutes les ressources par défaut du coach
  const { data: defaults, error: fetchErr } = await serviceSupabase
    .from('resources')
    .select('id')
    .eq('coach_id', coach_id)
    .eq('is_default', true);

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!defaults || defaults.length === 0) return NextResponse.json({ granted: 0 });

  // Insérer resource_access pour chaque ressource par défaut
  // onConflict ignore si l'accès existe déjà
  const rows = defaults.map(r => ({
    resource_id: r.id,
    client_id: user.id,
    unlocked: true,
    unlocked_at: new Date().toISOString(),
    seen_at: null,
  }));

  const { error: insertErr } = await serviceSupabase
    .from('resource_access')
    .upsert(rows, { onConflict: 'resource_id,client_id', ignoreDuplicates: true });

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ granted: rows.length });
}
