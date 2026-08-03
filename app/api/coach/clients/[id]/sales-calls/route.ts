import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/coach/clients/[id]/sales-calls
// Calls de vente (call_type='calendly') d'un élève.
//
// PIÈGE (découvert 2026-08-03 en comparant à PageClientStats.tsx:5762, qui a
// déjà résolu ce problème) : dans la table `calls`, la colonne `coach_id` ne
// désigne PAS le compte coach humain — c'est le `profile_id` de l'ÉLÈVE
// concerné (nom hérité du sync Calendly, où le "propriétaire" du lien est
// l'élève dont le lien Calendly génère le call). Filtrer par `calls.client_id`
// ne marche pas non plus : ce champ n'est renseigné que dans le cas où le coach
// teste sur lui-même (résolution par email au moment du call, voir
// webhooks/calendly/route.ts), jamais recalculé rétroactivement pour un
// prospect normal. Le bon filtre, déjà utilisé et validé en prod par la page
// Analytics par client, est simplement `calls.coach_id = client.profile_id`.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: clientRow, error: fetchErr } = await serviceSupabase
    .from('clients')
    .select('id, coach_id, profile_id, onboarding_completed_at')
    .eq('id', id)
    .single();

  if (fetchErr || !clientRow) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
  if (clientRow.coach_id !== user.id) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  if (!clientRow.profile_id) return NextResponse.json({ calls: [] });

  // .neq('ignored', true) : même filtre que app/api/client/pipeline/route.ts:31 et
  // PageClientStats.tsx:5766 — sans lui, les calls que le coach a "supprimés"
  // depuis le pipeline (marqués ignored=true plutôt qu'effacés physiquement)
  // reviennent dans les KPI.
  let query = serviceSupabase
    .from('calls')
    .select('*')
    .eq('coach_id', clientRow.profile_id)
    .eq('call_type', 'calendly')
    .neq('ignored', true)
    .order('scheduled_at', { ascending: false });

  if (clientRow.onboarding_completed_at) {
    query = query.gte('scheduled_at', clientRow.onboarding_completed_at);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ calls: data || [] });
}
