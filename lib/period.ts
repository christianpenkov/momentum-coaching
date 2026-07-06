// Fenêtre de période calendaire partagée pour toute la page Analytics — semaine
// calendaire (lundi 00:00 UTC → dimanche 23:59:59 UTC) ou mois calendaire (1er jour
// 00:00 UTC → dernier jour 23:59:59 UTC), jamais une fenêtre glissante. Remplace 6
// copies indépendantes de la même formule qui divergeaient légèrement entre elles
// (cause de plusieurs bugs de décalage d'un jour corrigés au fil des sessions).

export type PeriodGranularity = 'week' | 'month';

export interface PeriodWindow {
  periodStart: Date; // 00:00:00.000 UTC du premier jour de la période
  periodEnd: Date;   // 23:59:59.999 UTC du dernier jour de la période
  isCurrentIncomplete: boolean; // true si periodIndex=0 et la période n'est pas terminée
}

// Lundi = 1 ... Dimanche = 7 (getUTCDay() renvoie 0 pour dimanche — on le remappe)
function isoWeekday(d: Date): number {
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

export function getPeriodWindow(periodIndex: number, granularity: PeriodGranularity): PeriodWindow {
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (granularity === 'week') {
    // Lundi de la semaine courante
    const currentMonday = new Date(todayUTC);
    currentMonday.setUTCDate(todayUTC.getUTCDate() - (isoWeekday(todayUTC) - 1));

    const targetMonday = new Date(currentMonday);
    targetMonday.setUTCDate(currentMonday.getUTCDate() - periodIndex * 7);

    const periodStart = new Date(Date.UTC(targetMonday.getUTCFullYear(), targetMonday.getUTCMonth(), targetMonday.getUTCDate(), 0, 0, 0, 0));
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCDate(periodStart.getUTCDate() + 6);
    periodEnd.setUTCHours(23, 59, 59, 999);

    const isCurrentIncomplete = periodIndex === 0 && todayUTC.getTime() < periodEnd.getTime();
    return { periodStart, periodEnd, isCurrentIncomplete };
  }

  // granularity === 'month'
  const targetMonth = todayUTC.getUTCMonth() - periodIndex;
  const periodStart = new Date(Date.UTC(todayUTC.getUTCFullYear(), targetMonth, 1, 0, 0, 0, 0));
  // Jour 0 du mois suivant = dernier jour du mois ciblé
  const periodEnd = new Date(Date.UTC(todayUTC.getUTCFullYear(), targetMonth + 1, 0, 23, 59, 59, 999));

  const isCurrentIncomplete = periodIndex === 0 && todayUTC.getTime() < periodEnd.getTime();
  return { periodStart, periodEnd, isCurrentIncomplete };
}

// Nombre de jours écoulés dans la période en cours (pour l'affichage "Xj/7" ou "Xj/N")
export function daysElapsedInPeriod(periodStart: Date): number {
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.floor((todayUTC.getTime() - periodStart.getTime()) / 86400000) + 1;
}

export function totalDaysInPeriod(periodStart: Date, periodEnd: Date): number {
  return Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;
}
