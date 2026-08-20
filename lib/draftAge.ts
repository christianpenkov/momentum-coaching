/**
 * Ancienneté d'un brouillon de rapport, affichée dans la pastille « Commencé ».
 *
 * POURQUOI un seuil : passé quelques jours, on ne se souvient plus de ce qu'on
 * avait répondu. Reprendre à l'étape 4 avec des réponses qu'on ne reconnaît pas
 * est plus risqué que repartir de zéro, parce qu'on validerait un rapport sans
 * savoir ce qu'il contient — et ce rapport-là compte dans les statistiques.
 * La mention est un avertissement, pas une donnée courante : en deçà du seuil
 * elle serait du bruit sur une carte déjà dense.
 *
 * Même raisonnement que la purge à 30 jours de la table, en plus tôt : ici on
 * avertit, là on efface.
 */

/** En deçà (aujourd'hui, hier), le brouillon est frais en mémoire : rien à dire. */
export const DRAFT_AGE_THRESHOLD_DAYS = 2;

/**
 * Renvoie « il y a 3 jours » à partir du seuil, `null` en deçà.
 *
 * Compté en jours calendaires écoulés, pas en tranches de 24 h : un brouillon
 * d'avant-hier soir reste « il y a 2 jours » quelle que soit l'heure qu'il est,
 * ce qui correspond à la façon dont on se repère.
 */
export function formatDraftAge(updatedAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!updatedAt) return null;
  const then = new Date(updatedAt);
  if (Number.isNaN(then.getTime())) return null;

  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.floor((startOf(now) - startOf(then)) / 86_400_000);

  // Un brouillon daté du futur (horloge décalée) n'est pas ancien : on n'affiche rien.
  if (days < DRAFT_AGE_THRESHOLD_DAYS) return null;
  return `il y a ${days} jours`;
}
