import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/calls/[id]/transcript
// Transcription Fathom d'un call, chargée À LA DEMANDE (au clic sur
// "Voir la transcription complète"), et non plus embarquée dans le
// `calls.select('*')` du contexte coach.
//
// Pourquoi : Fathom enregistre TOUS les calls (confirmé par Chris, 2026-08-18).
// Un transcript de call de 30 min pèse ~40 Ko. Le contexte coach est monté dans
// app/(coach)/layout.tsx, donc ces transcripts partaient sur CHAQUE page coach :
// ~56 Mo projetés à 30 élèves x 12 mois, ~375 Mo à 40 élèves x 5 ans — sur mobile
// en 4G comme ailleurs, et comptés dans le quota egress (5 Go/mois en plan gratuit).
//
// Le transcript n'est affiché qu'à un seul endroit (FathomRecordingSection, dans
// le modal de rapport), jamais dans une liste ni un aperçu : le charger d'avance
// était donc du transfert pur perte. La donnée reste en base, inchangée.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: call, error } = await serviceSupabase
    .from('calls')
    .select('id, coach_id, client_id, fathom_transcript')
    .eq('id', id)
    .single();

  if (error || !call) return NextResponse.json({ error: 'Call introuvable' }, { status: 404 });

  // Contrôle d'accès. ATTENTION au piège documenté dans
  // app/api/coach/clients/[id]/sales-calls/route.ts : dans la table `calls`, la
  // colonne `coach_id` ne désigne PAS le compte coach humain — c'est le
  // `profile_id` de l'ÉLÈVE (nom hérité du sync Calendly). Un contrôle naïf
  // `call.coach_id === user.id` laisserait donc passer les mauvais cas.
  //
  // Trois accès légitimes :
  //  1. l'élève dont le lien Calendly a généré le call (calls.coach_id)
  //  2. le client rattaché au call (calls.client_id -> clients.profile_id)
  //  3. le coach humain de cet élève (clients.coach_id)
  let allowed = call.coach_id === user.id;

  if (!allowed) {
    const { data: rows } = await serviceSupabase
      .from('clients')
      .select('coach_id, profile_id')
      .or(`profile_id.eq.${call.coach_id}${call.client_id ? `,id.eq.${call.client_id}` : ''}`);

    allowed = (rows || []).some(
      r => r.coach_id === user.id || r.profile_id === user.id
    );
  }

  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  return NextResponse.json({ transcript: call.fathom_transcript ?? null });
}
