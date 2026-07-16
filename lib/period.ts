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
export function parisDateParts(d: Date): { y: number; m: number; day: number } {
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

// Nombre de jours écoulés dans la période en cours (pour l'affichage "Xj/7" ou "Xj/N")
export function daysElapsedInPeriod(periodStart: Date): number {
  const today = parisDateParts(new Date());
  const todayAsUTC = Date.UTC(today.y, today.m - 1, today.day);
  const startParts = parisDateParts(periodStart);
  const startAsUTC = Date.UTC(startParts.y, startParts.m - 1, startParts.day);
  return Math.floor((todayAsUTC - startAsUTC) / 86400000) + 1;
}

export function totalDaysInPeriod(periodStart: Date, periodEnd: Date): number {
  return Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;
}
