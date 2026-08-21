import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { serviceSupabase } from '@/lib/callAccess';

/**
 * GET /api/calls/rapport-drafts?ids=uuid1,uuid2
 * → { drafts: { "uuid1": { step_index, step_total, updated_at }, … } }
 *
 * Une seule requête pour toutes les cartes affichées, au lieu d'un appel par call.
 * Alimente le libellé « Commencé · étape N/M » des trois écrans de rapports en
 * attente (PendingRapportCard).
 *
 * Ne renvoie JAMAIS `answers` : le payload peut contenir des notes privées, il n'a
 * rien à faire dans une liste. Seuls la progression et l'ancienneté en sortent.
 *
 * Pas de contrôle d'appartenance call par call ici, contrairement à la route
 * unitaire : le filtre `user_id` suffit. On ne peut voir que SES propres
 * brouillons — les identifiants de calls d'autrui ne renvoient rien plutôt que de
 * déclencher un 403.
 */

// Borne défensive sur la taille du IN : les écrans affichent au plus quelques
// dizaines de rapports en attente, 200 laisse de la marge sans permettre d'envoyer
// une requête arbitrairement longue.
const MAX_IDS = 200;

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const raw = request.nextUrl.searchParams.get('ids') ?? '';
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json({ drafts: {} });

  const { data, error } = await serviceSupabase
    .from('call_rapport_drafts')
    .select('call_id, step_index, step_total, updated_at')
    .eq('user_id', user.id)
    .in('call_id', ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const drafts: Record<string, { step_index: number; step_total: number; updated_at: string }> = {};
  for (const row of data ?? []) {
    drafts[row.call_id] = {
      step_index: row.step_index,
      step_total: row.step_total,
      updated_at: row.updated_at,
    };
  }

  return NextResponse.json({ drafts });
}
