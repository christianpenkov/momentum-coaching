// Fenêtre de période calendaire partagée pour toute la page Analytics — semaine
// calendaire (lundi 00:00 → dimanche 23:59:59) ou mois calendaire (1er jour 00:00 →
// dernier jour 23:59:59), jamais une fenêtre glissante. Remplace 6 copies
// indépendantes de la même formule qui divergeaient légèrement entre elles (cause de
// plusieurs bugs de décalage d'un jour corrigés au fil des sessions).
//
// Fuseau Paris (pas UTC) : le cron d'écriture (supabase/functions/poll-leads,
// isoDate()) calcule "aujourd'hui"/"hier" en heure de Paris — documenté dans
// docs/cron-poll-leads-dates.md, corrige un vrai bug passé (isoDate() en UTC pur
// décalait les métriques du jour sur la ligne de la veille entre 22h-minuit UTC,
// soit minuit-2h heure d'été à Paris). Si ce module découpait les mois/semaines en
// UTC pendant que la DB écrit en Paris, les deux calendriers divergeraient de ~1h
// pile à la frontière entre deux jours/mois (rare mais réel, quelques minutes à
// quelques heures par mois selon l'heure d'exécution du cron ce jour-là). Aligné
// sur Paris ici pour que lecture (affichage) et écriture (DB) utilisent le même
// découpage calendaire.

export type PeriodGranularity = 'week' | 'month';

export interface PeriodWindow {
  periodStart: Date; // instant UTC correspondant à 00:00:00.000 heure de Paris du premier jour
  periodEnd: Date;   // instant UTC correspondant à 23:59:59.999 heure de Paris du dernier jour
  isCurrentIncomplete: boolean; // true si periodIndex=0 et la période n'est pas terminée
}

const PARIS_TZ = 'Europe/Paris';

// Décompose un instant en composantes Y/M/D telles que vues depuis Paris (gère
// automatiquement heure d'été/hiver via Intl, pas de table d'offset à maintenir).
function parisDateParts(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { y: get('year'), m: get('month'), day: get('day') };
}

// Date calendaire "YYYY-MM-DD" telle que vue depuis Paris — remplace
// d.toISOString().split('T')[0] (qui donne le jour UTC, faux depuis que
// periodStart/periodEnd ne tombent plus pile sur minuit UTC) partout où le code
// génère/compare des clés de jour calendaire pour les graphiques et snapshots.
export function parisDateStr(d: Date): string {
  const { y, m, day } = parisDateParts(d);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Ajoute des jours à un instant en respectant le calendrier Paris (pas juste +24h en
// UTC, qui peut sauter ou répéter un jour civil autour des transitions DST). Utile
// pour itérer jour par jour sur une période (ex: while (d <= periodEnd) { ...;
// d = parisAddDays(d, 1) }).
export function parisAddDays(d: Date, delta: number): Date {
  const { y, m, day } = parisDateParts(d);
  const next = addDaysToParts(y, m, day, delta);
  // Milieu de journée pour rester loin des bords DST — seule la date (Y/M/D) compte
  // pour les usages de cette fonction, jamais l'heure exacte.
  return parisWallTimeToUTC(next.y, next.m, next.day, 12, 0, 0, 0);
}

// Construit l'instant UTC correspondant à une heure locale donnée à Paris (Y/M/D
// heure:min:sec.ms), en tâtonnant l'offset — fiable pour toute date, y compris aux
// transitions d'heure d'été/hiver, sans dépendre d'une lib de fuseaux externe.
// L'offset est calculé sur la partie entière des secondes (ms mis à part et
// rajoutés après) : Intl.DateTimeFormat ne restitue pas les millisecondes de façon
// fiable via formatToParts, les inclure dans le calcul d'offset le faussait.
function parisWallTimeToUTC(y: number, m: number, day: number, hh: number, mm: number, ss: number, ms: number): Date {
  // Première approximation, à la seconde près (sans ms).
  const guess = new Date(Date.UTC(y, m - 1, day, hh, mm, ss, 0));
  // L'offset Paris (UTC+1 ou UTC+2) fait que l'heure murale demandée correspond à
  // guess - offset. On lit l'offset réel à ce guess et on corrige — un seul aller-
  // retour suffit car l'offset ne change jamais pendant la fenêtre de correction.
  const guessParts = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(guess);
  const gv = (type: string) => Number(guessParts.find(p => p.type === type)?.value);
  const asIfUTC = Date.UTC(gv('year'), gv('month') - 1, gv('day'), gv('hour') === 24 ? 0 : gv('hour'), gv('minute'), gv('second'));
  const offsetMs = asIfUTC - guess.getTime();
  return new Date(guess.getTime() - offsetMs + ms);
}

// Lundi = 1 ... Dimanche = 7
function isoWeekdayFromParts(y: number, m: number, day: number): number {
  const day0to6 = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return day0to6 === 0 ? 7 : day0to6;
}

// Ajoute des jours à un triplet Y/M/D (calendaire, indépendant du fuseau).
function addDaysToParts(y: number, m: number, day: number, delta: number): { y: number; m: number; day: number } {
  const d = new Date(Date.UTC(y, m - 1, day + delta));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function getPeriodWindow(periodIndex: number, granularity: PeriodGranularity): PeriodWindow {
  const today = parisDateParts(new Date());

  if (granularity === 'week') {
    const weekday = isoWeekdayFromParts(today.y, today.m, today.day);
    const currentMonday = addDaysToParts(today.y, today.m, today.day, -(weekday - 1));
    const targetMonday = addDaysToParts(currentMonday.y, currentMonday.m, currentMonday.day, -periodIndex * 7);
    const targetSunday = addDaysToParts(targetMonday.y, targetMonday.m, targetMonday.day, 6);

    const periodStart = parisWallTimeToUTC(targetMonday.y, targetMonday.m, targetMonday.day, 0, 0, 0, 0);
    const periodEnd = parisWallTimeToUTC(targetSunday.y, targetSunday.m, targetSunday.day, 23, 59, 59, 999);

    const isCurrentIncomplete = periodIndex === 0 && Date.now() < periodEnd.getTime();
    return { periodStart, periodEnd, isCurrentIncomplete };
  }

  // granularity === 'month'
  const targetMonthIndex0 = today.m - 1 - periodIndex; // 0-based, peut être négatif/>=12
  const targetYear = today.y + Math.floor(targetMonthIndex0 / 12);
  const targetMonth1 = ((targetMonthIndex0 % 12) + 12) % 12 + 1; // 1-based, ramené dans [1,12]

  const periodStart = parisWallTimeToUTC(targetYear, targetMonth1, 1, 0, 0, 0, 0);
  // Jour 0 du mois suivant = dernier jour du mois ciblé
  const lastDayDate = new Date(Date.UTC(targetYear, targetMonth1, 0));
  const periodEnd = parisWallTimeToUTC(lastDayDate.getUTCFullYear(), lastDayDate.getUTCMonth() + 1, lastDayDate.getUTCDate(), 23, 59, 59, 999);

  const isCurrentIncomplete = periodIndex === 0 && Date.now() < periodEnd.getTime();
  return { periodStart, periodEnd, isCurrentIncomplete };
}


/** Combien de périodes on peut remonter avant de sortir de la fenêtre de mesure.
 *
 *  ⚠️ Extraite de `PeriodPill` pour être testable : cette règle a déjà été corrigée
 *  deux fois (2026-08-31), et un troisième défaut s'est révélé le 2026-09-01 — la page
 *  Stats Clients lui passait le début de la PÉRIODE AFFICHÉE au lieu du début du
 *  portefeuille, si bien que le plancher avançait avec la période et que la flèche
 *  « ‹ » restait grise pour toujours.
 *
 *  Le grain est CALENDAIRE, jamais glissant : on compare la vraie fenêtre de chaque
 *  période à la date de démarrage, et une période reste atteignable tant qu'elle se
 *  TERMINE après. Compter des tranches de 7 ou 30 jours laisserait passer une période
 *  de trop selon le jour du mois.
 *
 *  Sans date de démarrage connue, on rend 12 : assez pour naviguer, borné pour ne pas
 *  proposer des périodes qui n'ont jamais existé.
 *
 *  @param plafond garde-fou de boucle. 120 périodes = 10 ans de mois, 2 ans de semaines. */
export function periodesEnArriere(
  debutMesure: string | Date | null | undefined,
  granularity: PeriodGranularity,
  plafond = 120,
): number {
  if (!debutMesure) return 12;
  const plancher = new Date(debutMesure).getTime();
  // Une date illisible donnerait un plancher NaN, et toute comparaison avec NaN est
  // fausse : le calcul rendrait 0 et verrouillerait la navigation en silence. On
  // retombe donc sur le cas « démarrage inconnu », qui lui reste navigable.
  if (Number.isNaN(plancher)) return 12;
  let i = 0;
  while (i < plafond && getPeriodWindow(i + 1, granularity).periodEnd.getTime() >= plancher) i++;
  return i;
}
