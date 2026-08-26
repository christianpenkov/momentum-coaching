/**
 * Ancienneté d'un brouillon de rapport, affichée dans la pastille « Commencé ».
 *
 * POURQUOI elle est affichée dès la première minute (décision produit, 2026-08-24) :
 * l'ancienneté est passée EN TÊTE de la pastille — « Commencé il y a 3 h · étape 3/5 ».
 * Ce n'est plus une note en fin de ligne mais la première chose lue, et une pastille
 * qui commence par « Commencé » sans dire quand ne veut rien dire. Un seuil laisserait
 * la moitié des cas avec un « Commencé » sans repère de temps.
 *
 * Ce que remplace ce choix : un seuil de 2 jours, au motif qu'en deçà on se souvient de
 * sa saisie et que la mention serait du bruit en fin de pastille. L'argument tombe avec
 * le changement de place — mais il reste vrai sur un point, gardé ici : **passé quelques
 * jours, reprendre un brouillon dont on ne reconnaît plus les réponses est risqué**,
 * puisque ce rapport-là compte dans les statistiques. D'où le libellé en jours dès 24 h,
 * qui rend l'ancien brouillon visible sans avoir besoin d'un seuil.
 *
 * La purge de la table à 30 jours reste le garde-fou du bout de chaîne : ici on informe,
 * là on efface.
 */

/**
 * Renvoie « à l'instant », « il y a 3 h », « il y a 1 jour », « il y a 12 jours ».
 * `null` seulement si la date est absente, invalide ou dans le futur (horloge décalée).
 *
 * Les heures sont comptées en écoulé réel, les jours en jours **calendaires** : un
 * brouillon d'avant-hier soir reste « il y a 2 jours » quelle que soit l'heure qu'il
 * est, ce qui correspond à la façon dont on se repère.
 */
export function formatDraftAge(updatedAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!updatedAt) return null;
  const then = new Date(updatedAt);
  if (Number.isNaN(then.getTime())) return null;

  const elapsedMs = now.getTime() - then.getTime();
  // Date future (horloge décalée) : rien à annoncer.
  if (elapsedMs < 0) return null;

  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.floor((startOf(now) - startOf(then)) / 86_400_000);

  // Même journée : on descend aux heures, puis aux minutes.
  if (days === 0) {
    const hours = Math.floor(elapsedMs / 3_600_000);
    if (hours >= 1) return `il y a ${hours} h`;
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes >= 1) return `il y a ${minutes} min`;
    return "à l'instant";
  }

  return days === 1 ? 'il y a 1 jour' : `il y a ${days} jours`;
}
