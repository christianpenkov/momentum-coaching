import type { SupabaseClient } from '@supabase/supabase-js';
import { BUCKET_VOCAUX, cheminVocal } from '@/lib/igVocaux';

/**
 * Retirer des conversations Instagram — LE seul chemin.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI UN SEUL ENDROIT                                                  │
 * │                                                                           │
 * │ Trois gestes différents doivent faire disparaître une conversation :      │
 * │   1. l'élève la retire depuis sa page Conversations DM ;                  │
 * │   2. l'élève répond « ce n'est pas un lead » dans Pipeline Leads ;        │
 * │   3. l'élève supprime le lead.                                            │
 * │                                                                           │
 * │ Avant le 2026-09-05, AUCUN des trois ne supprimait quoi que ce soit. Le   │
 * │ fil cessait simplement d'être VISIBLE — la visibilité se dérive           │
 * │ d'`instagram_leads` — et les messages restaient jusqu'à la quarantaine de │
 * │ 30 jours. `docs/conversations-instagram.md` annonçait pourtant une purge  │
 * │ immédiate sur le geste 2 : elle n'avait jamais été écrite. Une doc qui    │
 * │ décrit une garantie inexistante est pire que pas de doc, parce qu'on      │
 * │ cesse de vérifier.                                                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Cette fonction NE touche PAS à `instagram_leads`. Elle efface la
 * conversation, rien d'autre. C'est délibéré : la visibilité d'un fil n'est
 * jamais stockée, elle se dérive du lead — donc c'est l'appelant qui décide du
 * sort du lead, et lui seul. Y ajouter un `not_a_lead = true` ferait de cette
 * fonction un second endroit où se décide la visibilité, exactement ce que
 * l'architecture de ce chantier interdit.
 *
 * ⚠️ Sans un `not_a_lead = true` posé par l'appelant, le retrait ne tient PAS :
 * le prochain message recrée le fil, et la reprise d'historique le réimporte.
 * Effacer sans écarter le lead ne fait gagner que quelques heures.
 */
export async function retirerConversationsIg(
  supa: SupabaseClient,
  profileId: string,
  peerIds: string[],
): Promise<{ fils: number; vocaux: number }> {
  const peers = peerIds.filter(Boolean);
  if (peers.length === 0) return { fils: 0, vocaux: 0 };

  // ⚠️ La traduction passe par le `peer_id`, jamais par le pseudo. C'est la clé
  // qu'utilise `ig_conversations_visibles` (`l.ig_user_id = cv.peer_id`), et
  // s'en écarter ferait diverger ce qu'on efface de ce qui était affiché — une
  // fusion de fiches suffit à faire mentir un pseudo.
  const { data: fils } = await supa
    .from('ig_conversations')
    .select('id')
    .eq('profile_id', profileId)
    .in('peer_id', peers);

  const ids = (fils ?? []).map((f: any) => f.id as string);
  if (ids.length === 0) return { fils: 0, vocaux: 0 };

  // ⚠️ Les `mid` se lisent AVANT la suppression. Après, les lignes sont parties
  // par cascade et le nom des fichiers n'est plus calculable — les octets
  // resteraient dans le bucket, orphelins et invisibles, à compter dans le
  // quota jusqu'à la purge des 30 jours.
  const { data: vocaux } = await supa
    .from('ig_messages')
    .select('mid')
    .in('conversation_id', ids)
    .eq('type_piece_jointe', 'audio')
    .not('mid', 'is', null);

  const { error } = await supa.from('ig_conversations').delete().in('id', ids);
  if (error) throw new Error(`retrait des conversations impossible: ${error.message}`);

  let supprimes = 0;
  const mids = (vocaux ?? []).map((m: any) => m.mid as string);
  if (mids.length) {
    const chemins = await Promise.all(mids.map(mid => cheminVocal(profileId, mid)));
    // Volontairement non bloquant : les lignes sont déjà parties, c'est
    // l'essentiel. Un fichier resté derrière est rattrapé par la purge des
    // 30 jours ; faire échouer l'appel ici laisserait l'élève croire que son
    // retrait n'a pas eu lieu alors qu'il a eu lieu.
    const { error: errFichiers } = await supa.storage.from(BUCKET_VOCAUX).remove(chemins);
    if (!errFichiers) supprimes = chemins.length;
  }

  return { fils: ids.length, vocaux: supprimes };
}

/**
 * Les `peer_id` des conversations d'un pseudo, lus dans `instagram_leads`.
 *
 * ⚠️ À appeler AVANT toute suppression du lead : c'est la seule table qui sait
 * traduire un `ig_username` en `ig_user_id`. La doc du chantier le dit déjà —
 * « la suppression doit passer par `instagram_leads` pour traduire l'un en
 * l'autre, et non deviner ».
 */
export async function peerIdsDuPseudo(
  supa: SupabaseClient,
  profileId: string,
  igUsername: string,
): Promise<string[]> {
  const { data } = await supa
    .from('instagram_leads')
    .select('ig_user_id')
    .eq('profile_id', profileId)
    .eq('ig_username', igUsername);
  return (data ?? []).map((l: any) => l.ig_user_id as string).filter(Boolean);
}
