/**
 * Quand un remboursement peut-il être déclaré CONSTATÉ ?
 *
 * Isolé du composant pour être éprouvable : l'écran qui répond à cette question
 * affirme à l'élève qu'un mouvement d'argent a eu lieu. S'il se trompe, l'élève
 * croit avoir rendu de l'argent qui est encore chez lui — et le client, lui,
 * attend toujours.
 *
 * ── Le défaut que cette fonction ferme (2026-09-05, vente RZK) ──────────────
 *
 * L'écran comparait l'encaissé au montant contracté : « si l'encaissé ne dépasse
 * plus le contracté, c'est que le surplus a été rendu ». Les deux valeurs
 * venaient du même objet `deal`, transmis par l'écran précédent SANS
 * rafraîchissement — donc antérieur au changement de montant qui venait d'avoir
 * lieu.
 *
 *   montant ramené de 500 à 300 €, `deal` encore à 500, encaissé 500
 *   → restant calculé : 500 − 500 = 0
 *   → « Remboursement constaté — les chiffres sont à jour »
 *
 * Rien n'avait été remboursé. 200 € étaient dus au client.
 *
 * ── La règle qui remplace ───────────────────────────────────────────────────
 *
 * Un remboursement se constate par une BAISSE de l'encaissé net, jamais par une
 * comparaison avec une autre valeur. La baisse est le fait ; tout le reste est
 * une déduction, et une déduction peut porter sur des données périmées.
 *
 * Corollaire, valable bien au-delà de cet écran : **une interface qui affirme
 * avoir constaté un mouvement d'argent ne doit jamais le déduire de données
 * antérieures à ce mouvement.**
 */

/** Deux décimales — les sommes de `numeric` traînent des flottants imparfaits. */
const arrondi = (n: number): number => Math.round(n * 100) / 100;

/** En deçà, c'est un reliquat d'arrondi et non une dette. Même seuil que `lib/dealCash.ts`. */
export const CENTIME = 0.005;

export interface EtatRemboursement {
  /** Ce qu'il fallait rendre, figé à l'ouverture de l'écran. */
  aRembourser: number;
  /** L'encaissé net au moment où l'écran s'est ouvert. */
  netAuDepart: number;
  /** L'encaissé net maintenant — descend quand le webhook enregistre le remboursement. */
  netMaintenant: number;
}

/** Ce qui a effectivement été rendu : la baisse de l'encaissé net. */
export function dejaRendu({ netAuDepart, netMaintenant }: EtatRemboursement): number {
  return Math.max(0, arrondi(netAuDepart - netMaintenant));
}

/** Ce qu'il reste à rendre. Zéro ne veut dire « c'est fait » que si de l'argent est SORTI. */
export function resteARembourser(e: EtatRemboursement): number {
  return Math.max(0, arrondi(e.aRembourser - dejaRendu(e)));
}

export function remboursementConstate(e: EtatRemboursement): boolean {
  return resteARembourser(e) <= CENTIME;
}
