/**
 * Où vit le fichier d'un message vocal Instagram.
 *
 * ⚠️ L'empreinte se calcule à PLUSIEURS endroits — ici, en SQL
 * (`enregistrer_message_ig`, `vocal_ig_conserve`, `ig_vocaux_sante`) et dans le
 * worker de webhook. Si l'une dérive, la lecture cherche un fichier écrit sous
 * un autre nom et le vocal devient muet **sans qu'aucune erreur ne parte**.
 * `lib/igConversations.test.ts` gèle la valeur témoin et confronte les
 * implémentations entre elles.
 *
 * Ce module existe pour qu'il y en ait le moins possible : la route de lecture
 * et le retrait d'une conversation partagent celle-ci. Le worker garde encore la
 * sienne — son fichier portait le travail en cours d'une autre session le
 * 2026-09-05, et on ne modifie pas le fichier d'autrui. À replier ici quand ce
 * chantier atterrit.
 *
 * ⚠️ `crypto.subtle` et non `node:crypto` : le même code doit pouvoir tourner
 * dans le runtime Edge comme dans Node, et l'API Web est la seule commune aux
 * deux.
 */

/** sha256 tronqué à 16 octets, en hexadécimal. */
export async function empreinteMid(mid: string): Promise<string> {
  const octets = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(mid));
  return Array.from(new Uint8Array(octets).slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Le chemin d'un vocal dans le bucket `ig-vocaux`.
 *
 * ⚠️ Le premier segment est le `profile_id` de l'élève, et il n'est pas
 * décoratif : c'est lui qui permet de supprimer les fichiers d'un seul élève —
 * à la révocation de son accord, ou au retrait d'une conversation — sans
 * toucher à ceux des autres. La cascade des clés étrangères n'atteint PAS le
 * stockage : sans suppression explicite, les octets restent.
 */
export async function cheminVocal(profileId: string, mid: string): Promise<string> {
  return `${profileId}/${await empreinteMid(mid)}.m4a`;
}

export const BUCKET_VOCAUX = 'ig-vocaux';
