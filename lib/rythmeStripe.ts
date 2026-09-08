/**
 * Les dates de prélèvement d'un abonnement Stripe.
 *
 * ── Pourquoi ce calcul existe ──────────────────────────────────────────────
 * Stripe n'expose PAS la liste des dates à venir : l'API ne rend que la
 * prochaine (`current_period_end`) et le rythme. Vérifié dans la doc le
 * 2026-09-08 — ce n'est pas une supposition héritée d'un commentaire.
 *
 * ── Pourquoi il ne peut pas être « + 30 jours » ────────────────────────────
 * C'est ce qu'il faisait, et ça annonçait la 3ᵉ échéance au 7 novembre là où
 * Stripe prélevait le 8. Constaté en production sur une vente en 3 fois. La
 * dérive est d'un jour sur trois échéances, de cinq sur douze — et c'est une
 * date qu'on annonce au client.
 *
 * ── La règle, telle que Stripe la documente ────────────────────────────────
 * L'ancre du cycle de facturation fixe le JOUR DU MOIS. Quand ce jour n'existe
 * pas dans le mois visé, Stripe prend le dernier jour du mois — et l'ancre ne
 * dérive pas pour autant :
 *
 *   « ancre au 31 janvier → facturé le 28 février (ou le 29),
 *     puis le 31 mars, le 30 avril, etc. »
 *
 * D'où la conséquence qui n'est pas intuitive et que le test verrouille : on
 * repart TOUJOURS de l'ancre, jamais de la date précédente. Ajouter un mois de
 * proche en proche ferait glisser tout l'échéancier vers le 28 après un seul
 * février.
 *
 * Tout est en UTC, comme l'ancre de Stripe : « la date d'ancrage correspond à
 * un horodatage UNIX ». Le fuseau d'affichage se décide ailleurs.
 *
 * ⚠️ Ce calcul reste une SECONDE implémentation d'une règle qui appartient à
 * Stripe. Il n'est donc jamais affiché sans contrôle : `useEcheances` vérifie
 * que la dernière date calculée plus un intervalle tombe exactement sur le
 * `cancel_at` que Stripe, lui, a calculé. En cas de désaccord, aucune date
 * n'est montrée.
 */

export const MS_JOUR = 86400_000;

export function avancer(depart: Date, interval: string | null, n: number): Date {
  if (n === 0) return depart;
  if (interval === 'week') return new Date(depart.getTime() + n * 7 * MS_JOUR);

  const jourAncre = depart.getUTCDate();
  const cible = new Date(Date.UTC(
    depart.getUTCFullYear(), depart.getUTCMonth() + n, 1,
    depart.getUTCHours(), depart.getUTCMinutes(), depart.getUTCSeconds(),
  ));
  // Jour 0 du mois suivant = dernier jour du mois visé. `setUTCMonth` ne sait
  // pas faire ce repli seul : sur le 31 janvier il déborde au 3 mars.
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jourAncre, dernierJour));
  return cible;
}
