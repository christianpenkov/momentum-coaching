/**
 * Distinguer « non collecté » de « zéro ».
 *
 * Une colonne NULL dans `analytics_daily_snapshots` veut dire « le collecteur n'a rien
 * rapporté ce jour-là ». Elle ne veut PAS dire « la valeur était zéro ». Les deux se
 * ressemblent à l'écran et ne veulent pas dire la même chose :
 *
 *   « 0 vue »      affirme que personne n'a regardé — c'est une mesure.
 *   « Non mesuré » dit qu'on ne sait pas — c'est une absence de mesure.
 *
 * ⚠️ La distinction dépend de la NATURE de la donnée, pas d'un principe général. Les
 * publications sont *énumérées* : on compte des lignes, donc l'absence de ligne EST un
 * zéro réel, et afficher 0 y est juste. Les vues, la portée, le temps de visionnage
 * sont *collectés* par un cron : le silence du collecteur ne dit rien de la valeur, et
 * un 0 y est une invention.
 *
 * Pas d'import : ce module doit rester utilisable côté Node comme côté Deno.
 */

/**
 * Somme un flux sur une fenêtre, en gardant la distinction.
 *
 * - au moins un jour collecté → la somme des jours collectés, **même si elle vaut 0** ;
 * - aucun jour collecté       → `null`, que l'écran affiche « Non mesuré ».
 *
 * ⚠️ Une fenêtre PARTIELLEMENT trouée garde son chiffre. Ce n'est pas un compromis :
 * refuser de totaliser dès qu'un jour manque effacerait des semaines entières de
 * données réelles. Ce sont les COURBES qui montrent où sont les trous, jour par jour ;
 * le total, lui, dit ce qu'on sait.
 *
 * Mesuré le 2026-09-06 sur `analytics_daily_snapshots` : sur les vues Instagram
 * découpées en semaines calendaires, **18 fenêtres sur 44 sont entièrement non
 * collectées** — elles affichaient toutes « 0 vue », un chiffre inventé que rien ne
 * signalait. Et 6 fenêtres ont une somme réelle de zéro : ce sont ces six-là que
 * `null` ne doit surtout pas avaler.
 */
export function sommeFlux(
  jours: readonly Record<string, unknown>[] | null | undefined,
  champ: string,
): number | null {
  let total = 0;
  let auMoinsUnJourCollecte = false;
  for (const jour of jours ?? []) {
    const valeur = jour?.[champ];
    // `!= null` (lâche) et non `!== null` : une source qui ne transporte pas le champ
    // rend `undefined`, qui est une absence de mesure au même titre que `null`.
    if (valeur != null && typeof valeur === 'number' && !Number.isNaN(valeur)) {
      total += valeur;
      auMoinsUnJourCollecte = true;
    }
  }
  return auMoinsUnJourCollecte ? total : null;
}

/**
 * Vrai quand AUCUN jour de la fenêtre ne porte de mesure pour ce champ.
 *
 * Formulé à part parce que la question se pose aussi sans total à calculer — un taux,
 * une moyenne, un libellé. Écrire `sommeFlux(...) === null` à la place marcherait, mais
 * dirait « la somme est nulle », ce qui est exactement la confusion qu'on combat.
 */
export function rienDeCollecte(
  jours: readonly Record<string, unknown>[] | null | undefined,
  champ: string,
): boolean {
  return sommeFlux(jours, champ) === null;
}
