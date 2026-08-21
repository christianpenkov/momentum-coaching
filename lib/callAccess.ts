import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Contrôle « cette personne a-t-elle le droit de toucher ce call ? », partagé par
 * les routes de rapport et de brouillon.
 *
 * Extrait de app/api/calls/[id]/rapport/route.ts sans changer un caractère à la
 * règle : c'est la SEULE définition de cette autorisation. Les brouillons vivent
 * dans une table à RLS sans policy, précisément pour ne pas avoir à réécrire cette
 * logique en SQL — deux définitions finiraient par diverger.
 */

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface CallAccessRow {
  id: string;
  coach_id: string | null;
  client_id: string | null;
  outcome: string | null;
  session_completed: boolean | null;
  session_no_show: boolean | null;
  status: string | null;
}

type AccessResult =
  | { ok: true; userId: string; call: CallAccessRow }
  | { ok: false; response: NextResponse };

/**
 * Renvoie l'utilisateur et le call si l'accès est autorisé, sinon la réponse
 * d'erreur à retourner telle quelle (401 / 404 / 403).
 *
 * Le call est renvoyé avec ses marqueurs de rapport rempli (`outcome`,
 * `session_completed`, `session_no_show`) : le GET du brouillon s'en sert pour
 * détecter un brouillon périmé — celui d'une saisie initiale sur un call déjà
 * rapporté ailleurs.
 */
export async function requireCallAccess(callId: string): Promise<AccessResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) };
  }

  const { data: call } = await serviceSupabase
    .from('calls')
    .select('id, coach_id, client_id, outcome, session_completed, session_no_show, status')
    .eq('id', callId)
    .single();

  if (!call) {
    return { ok: false, response: NextResponse.json({ error: 'Call introuvable' }, { status: 404 }) };
  }

  // ⚠️ INCOHÉRENCE CONNUE (audit sécurité, en attente de clarification) : pour les calls
  // Calendly, call.client_id référence clients.id (table de jointure), pas auth.users.id
  // — la comparaison ci-dessous ne matche donc probablement jamais côté élève sur ce flux.
  // Confirmé avec Chris (24/07/2026) : seul le coach remplit ce rapport en pratique
  // aujourd'hui, donc pas de bug utilisateur actif. À cartographier entièrement (calls
  // Calendly vs Google Meet utilisent des conventions différentes pour client_id/coach_id)
  // avant de corriger, pour ne pas casser un accès élève qui fonctionnerait déjà autrement.
  const isOwner = call.coach_id === user.id || call.client_id === user.id;
  if (!isOwner) {
    return { ok: false, response: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) };
  }

  return { ok: true, userId: user.id, call: call as CallAccessRow };
}

/** Client service_role, réutilisé par les routes de brouillon. */
export { serviceSupabase };
