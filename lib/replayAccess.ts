/**
 * Qui a le droit de regarder l'enregistrement d'un call, et avec quel compte
 * Fathom aller le chercher.
 *
 * LE PROBLÈME : chacun connecte son propre compte Fathom. Sur un call de
 * coaching, un seul des deux comptes a enregistré la réunion — l'autre n'a rien
 * dans son Fathom. Sans rien faire, seul l'un des deux pourrait lire la vidéo
 * dans la page, alors que les deux ont participé au même appel et voient déjà
 * son résumé, sa transcription et son lien de partage.
 *
 * LA RÈGLE, unique et sans exception : les participants d'un call peuvent
 * regarder son enregistrement, et on le demande au premier compte Fathom qui
 * l'a. On essaie d'abord celui du lecteur, puis celui de l'autre participant.
 *
 * POURQUOI ça n'ouvre aucun accès supplémentaire : `autorise` est la même
 * condition que « cette personne a le droit de voir ce call ». Si elle est
 * fausse, on ne demande rien du tout. Si elle est vraie, la personne voit déjà
 * l'enregistrement via le lien de partage — on ne fait que le servir autrement.
 * Un élève ne peut pas atteindre le call d'un autre élève : il n'est participant
 * d'aucun des deux côtés.
 *
 * POURQUOI il n'y a pas de cas particulier « coaching » : seuls les calls de
 * coaching ont deux participants. Les calls de vente n'en ont qu'un (vérifié sur
 * l'ensemble des données : 26/26 contre 0/47). La règle se réduit donc d'elle-même
 * à « son propre compte » sur les ventes, sans qu'on ait à l'écrire — une
 * exception en moins à retenir, et rien à corriger si la répartition change.
 */

export interface AccesReplay {
  /** La personne a-t-elle le droit de voir cet enregistrement ? */
  autorise: boolean;
  /**
   * Comptes dont on essaiera le jeton Fathom, dans l'ordre. Le lecteur d'abord :
   * c'est le cas courant, et ça évite d'emprunter quand ce n'est pas nécessaire.
   * Vide si l'accès est refusé.
   */
  ordreDEssai: string[];
}

/**
 * @param viewerId          profil de la personne connectée
 * @param coachId           `calls.coach_id` — un profil
 * @param clientProfileId   profil de l'élève, résolu via `clients.profile_id`.
 *                          ⚠️ PAS `calls.client_id`, qui référence `clients.id`
 *                          et n'est donc jamais comparable à un profil
 *                          (cf. docs/calls-coach-id-piege.md).
 */
export function resoudreAccesReplay(
  viewerId: string,
  coachId: string | null | undefined,
  clientProfileId: string | null | undefined
): AccesReplay {
  const participants = [coachId, clientProfileId].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  );

  if (!participants.includes(viewerId)) {
    return { autorise: false, ordreDEssai: [] };
  }

  // Le lecteur en premier, l'autre participant ensuite. `Set` pour le cas où une
  // même personne serait des deux côtés (coach qui se coache lui-même en test).
  const ordre = [...new Set([viewerId, ...participants])];
  return { autorise: true, ordreDEssai: ordre };
}
