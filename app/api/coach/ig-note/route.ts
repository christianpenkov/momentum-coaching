import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

/**
 * Le coach écrit une note, sur un fil ou sur un message.
 *
 * ⚠️ POURQUOI UNE ROUTE, alors que la RLS pourrait autoriser le coach à écrire :
 * **Postgres ne sait pas borner les COLONNES qu'un `update` peut toucher.** Une
 * politique qui ouvre `note` ouvre aussi `texte` — c'est-à-dire le pouvoir de
 * réécrire ce qu'un prospect a dit dans une conversation qui sert de trace.
 *
 * L'audit du 2026-09-04 a trouvé les deux faces du même défaut en production :
 * l'élève pouvait réécrire les notes de son coach (politique `for all` sur ses
 * propres lignes), et le coach ne pouvait pas en écrire du tout (aucune
 * politique d'écriture). Depuis, **plus personne n'écrit en direct** : la
 * lecture passe par la RLS, l'écriture par ici, et seul le champ `note` bouge.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { cible, id, note } = body ?? {};
  if ((cible !== 'message' && cible !== 'fil') || typeof id !== 'string') {
    return NextResponse.json({ error: 'cible (message | fil) et id requis' }, { status: 400 });
  }
  if (note !== null && typeof note !== 'string') {
    return NextResponse.json({ error: 'note doit être une chaîne ou null' }, { status: 400 });
  }
  const texte = typeof note === 'string' ? note.trim() : '';
  const valeur = texte === '' ? null : texte.slice(0, 4000);

  // À qui appartient la ligne visée ? On le demande à la base plutôt que de
  // faire confiance à un identifiant reçu — un `profile_id` est PUBLIC depuis le
  // 2026-08-31, il est inscrit dans la destination de chaque lien Calendly.
  const { data: ligne } = cible === 'message'
    ? await supa.from('ig_messages').select('profile_id').eq('id', id).maybeSingle()
    : await supa.from('ig_conversations').select('profile_id').eq('id', id).maybeSingle();

  if (!ligne) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });

  // Le demandeur est-il bien le coach de cet élève, ET l'élève a-t-il accordé ?
  const { data: lien } = await supa
    .from('clients').select('id')
    .eq('profile_id', ligne.profile_id)
    .eq('coach_id', user.id)
    .not('ig_dm_lecture_accordee_le', 'is', null)
    .is('archived_at', null)
    .maybeSingle();

  if (!lien) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const champs = { note: valeur, note_le: valeur ? new Date().toISOString() : null };
  const { error } = cible === 'message'
    ? await supa.from('ig_messages').update(champs).eq('id', id)
    : await supa.from('ig_conversations').update(champs).eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, note: valeur });
}
