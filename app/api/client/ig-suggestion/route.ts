import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

/**
 * L'élève marque une suggestion comme copiée ou traitée.
 *
 * ⚠️ POURQUOI CETTE ROUTE EXISTE, alors que la RLS autorise déjà l'élève à
 * modifier ses propres suggestions : **Postgres ne sait pas borner les COLONNES
 * qu'un `update` peut toucher.** Une écriture directe depuis le navigateur le
 * laisserait réécrire `texte` — c'est-à-dire changer, après coup, ce que son
 * coach a écrit. Le risque est faible (il ne se ment qu'à lui-même) mais il se
 * ferme ici, pas dans la politique.
 *
 * ⚠️ Ces deux marqueurs NE PROUVENT PAS qu'un message est parti. L'envoi a lieu
 * dans Instagram, hors de notre portée. La seule preuve arrive toute seule : si
 * le texte part vraiment, Instagram nous le renvoie en `is_echo` et il apparaît
 * dans le fil comme n'importe quel message.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CHAMPS_AUTORISES = new Set(['copie_le', 'traite_le']);

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { id, champ } = body ?? {};
  if (typeof id !== 'string' || !CHAMPS_AUTORISES.has(champ)) {
    return NextResponse.json({ error: 'id et champ (copie_le | traite_le) requis' }, { status: 400 });
  }

  // ⚠️ Le filtre porte sur `profile_id = user.id`, l'identité authentifiée —
  // jamais sur un identifiant reçu dans le corps. Un `profile_id` est PUBLIC
  // depuis le 2026-08-31 : il est inscrit dans la destination de chaque lien
  // Calendly partagé.
  const { data, error } = await supa
    .from('ig_suggestions')
    .update({ [champ]: new Date().toISOString() })
    .eq('id', id)
    .eq('profile_id', user.id)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Suggestion introuvable' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
