// ─────────────────────────────────────────────────────────────────────────────
// Le canal d'un DM — qui a fait le premier pas.
//
// La règle vivait recopiée à sept endroits de `PageClientStats`, sous la forme
// « source !== 'story_reply' && source !== 'comment' ». Écrite en négatif, elle
// range dans « sortant » tout ce qu'elle ne connaît pas — y compris `null`, et
// y compris toute valeur ajoutée plus tard. C'est ainsi qu'un lien créé pour un
// inconnu atterrissait en « Cold DM », c'est-à-dire en « le coach est allé le
// chercher », sans que personne l'ait décidé.
// ─────────────────────────────────────────────────────────────────────────────

/** Qui a fait le premier pas. */
export type CanalDm =
  /** Le coach est allé chercher la personne. Affiché « Cold DM (sortant) ». */
  | 'sortant'
  /** La personne est venue — commentaire, ou DM spontané. Affiché « DM organique ». */
  | 'entrant'
  /** Réponse à une story. Bac à part : le déclencheur est un contenu daté. */
  | 'story';

/**
 * Les valeurs de `source` qui disent « la personne est venue d'elle-même ».
 *
 * `comment` est posé par le webhook Instagram sur un commentaire mot-clé.
 * `dm_entrant` est répondu par le coach à la création d'un lien pour quelqu'un
 * dont on ne sait rien — c'est le seul instant où l'information existe, lui seul
 * sait si la personne lui a écrit ou s'il est allé la chercher.
 *
 * Les deux tombent dans le même bac, et ce n'est pas un raccourci : le code
 * définissait déjà « DM organique » comme « tout DM que le prospect a initié ».
 * Un DM entrant correspond exactement à cette définition, elle n'a pas à changer.
 */
const SOURCES_ENTRANTES = new Set(['comment', 'dm_entrant']);

/**
 * Le canal d'un lien, d'après sa `source`.
 *
 * ⚠️ Une source inconnue ou absente rend `'sortant'`, comme avant — mais c'est
 * désormais un choix écrit à un seul endroit, et non la conséquence d'une
 * condition en négatif. `dm_sortant` y tombe explicitement, `cold_dm` aussi.
 */
export function canalDuDm(source: string | null | undefined): CanalDm {
  if (source === 'story_reply') return 'story';
  if (source && SOURCES_ENTRANTES.has(source)) return 'entrant';
  return 'sortant';
}

/** Les deux réponses possibles à la question posée à la création d'un lien. */
export const SOURCE_DM_ENTRANT = 'dm_entrant';
export const SOURCE_DM_SORTANT = 'dm_sortant';

/**
 * Les valeurs que la route accepte du client pour `source_at_creation`.
 *
 * Une liste blanche, et non une chaîne libre : ce champ décide d'un bac de
 * statistiques, un appel malveillant ou maladroit ne doit pas pouvoir y écrire
 * `comment` — ce qui reviendrait à s'inventer un commentaire qui n'a pas eu lieu.
 */
export function sourceDeclareeValide(v: unknown): v is typeof SOURCE_DM_ENTRANT | typeof SOURCE_DM_SORTANT {
  return v === SOURCE_DM_ENTRANT || v === SOURCE_DM_SORTANT;
}
