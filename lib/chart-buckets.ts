/**
 * Regroupement des séries de graphique par jour, semaine ou mois.
 *
 * Existe pour le mode All-Time. Un point par jour convient à une semaine ou un
 * mois ; sur toute l'histoire d'un élève, il donne 400 points la première année
 * et 700 la deuxième — illisible, et Recharts en souffre. Au-delà d'un seuil, on
 * regroupe.
 *
 * Deux règles à ne pas confondre :
 *
 * - une série de COMPTAGE (clics, leads, calls) se regroupe en SOMMANT ;
 * - une série de TAUX (activation) se regroupe en sommant numérateur et
 *   dénominateur SÉPARÉMENT, puis en divisant. Faire la moyenne des pourcentages
 *   journaliers donne un chiffre faux dès que les volumes quotidiens diffèrent :
 *   1 clic sur 1 envoi (100 %) et 0 sur 99 (0 %) donnent 50 % en moyenne, 1 % en
 *   réalité.
 *
 * Pas d'import : ce module doit rester utilisable côté Node et côté Deno.
 */

export type Granularite = 'jour' | 'semaine' | 'mois';

/** Seuils choisis pour que l'axe reste lisible : ~60 points maximum à l'écran. */
export const SEUIL_SEMAINE_JOURS = 70;   // au-delà de ~10 semaines, on passe à la semaine
export const SEUIL_MOIS_JOURS = 400;     // au-delà de ~57 semaines, on passe au mois

export function granulariteFenetre(nbJours: number): Granularite {
  if (nbJours <= SEUIL_SEMAINE_JOURS) return 'jour';
  if (nbJours <= SEUIL_MOIS_JOURS) return 'semaine';
  return 'mois';
}

/**
 * Clé de regroupement d'une date "YYYY-MM-DD".
 * - jour    → la date elle-même
 * - semaine → le LUNDI de sa semaine (même convention que getPeriodWindow)
 * - mois    → le 1er du mois
 *
 * Calcul en UTC pur sur une date déjà calendaire : aucun fuseau n'intervient ici,
 * la conversion Paris a déjà eu lieu en amont (parisDateStr).
 */
export function cleBucket(dateStr: string, g: Granularite): string {
  if (g === 'jour') return dateStr;
  if (g === 'mois') return dateStr.slice(0, 8) + '01';
  const d = new Date(dateStr + 'T00:00:00Z');
  // getUTCDay : 0 = dimanche. On recule jusqu'au lundi.
  const recul = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - recul);
  return d.toISOString().slice(0, 10);
}

/** Liste ordonnée et sans trou des clés de bucket couvrant `jours`. */
export function bucketsDe(jours: string[], g: Granularite): string[] {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const j of jours) {
    const k = cleBucket(j, g);
    if (!vus.has(k)) { vus.add(k); out.push(k); }
  }
  return out;
}

/**
 * Regroupe une série de comptage.
 *
 * `valeurParJour` renvoie `null` pour un jour hors couverture (avant l'arrivée de
 * l'élève, ou dans le futur). Un bucket dont TOUS les jours sont hors couverture
 * reste `null` — un trou, pas un zéro. Dès qu'un seul jour est couvert, le bucket
 * vaut la somme des jours couverts : un mois à cheval sur la date d'arrivée
 * n'affiche pas un trou alors qu'il s'y est passé quelque chose.
 */
export function regrouperComptage(
  jours: string[],
  g: Granularite,
  valeurParJour: (jour: string) => number | null,
): { date: string; v: number | null }[] {
  const somme = new Map<string, number | null>();
  for (const j of jours) {
    const k = cleBucket(j, g);
    const v = valeurParJour(j);
    const cur = somme.has(k) ? somme.get(k)! : null;
    if (v === null) { if (!somme.has(k)) somme.set(k, null); continue; }
    somme.set(k, (cur ?? 0) + v);
  }
  return bucketsDe(jours, g).map(k => ({ date: k, v: somme.get(k) ?? null }));
}

/**
 * Regroupe une série de taux, en sommant numérateur et dénominateur séparément.
 * Renvoie `null` quand aucun jour couvert, `0` quand le dénominateur est nul sur
 * un bucket couvert (aucun envoi : le taux est bien 0 %, pas inconnu).
 */
export function regrouperTaux(
  jours: string[],
  g: Granularite,
  parJour: (jour: string) => { num: number; den: number } | null,
): { date: string; v: number | null }[] {
  const acc = new Map<string, { num: number; den: number } | null>();
  for (const j of jours) {
    const k = cleBucket(j, g);
    const v = parJour(j);
    if (v === null) { if (!acc.has(k)) acc.set(k, null); continue; }
    const cur = acc.get(k) ?? null;
    acc.set(k, { num: (cur?.num ?? 0) + v.num, den: (cur?.den ?? 0) + v.den });
  }
  return bucketsDe(jours, g).map(k => {
    const a = acc.get(k);
    if (!a) return { date: k, v: null };
    return { date: k, v: a.den > 0 ? Math.round((a.num / a.den) * 100) : 0 };
  });
}

/** Libellé de l'axe pour une clé de bucket. */
export function libelleBucket(cle: string, g: Granularite): string {
  const [y, m, d] = cle.split('-');
  if (g === 'mois') {
    const noms = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    return `${noms[Number(m) - 1]} ${y.slice(2)}`;
  }
  const noms = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const jour = `${Number(d)} ${noms[Number(m) - 1]}`;
  return g === 'semaine' ? `sem. ${jour}` : jour;
}
