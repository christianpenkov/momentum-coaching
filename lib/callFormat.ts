import { formatTimeIn, formatDateIn, formatDayPartsIn, DEFAULT_TIME_ZONE } from '@/lib/timezone';

// Formatage et regroupement des dates de call — source unique pour les pages Calls
// coach et élève. Avant centralisation, la même donnée était formatée de 6 façons
// différentes selon l'endroit (avec/sans année, avec/sans heure, avec/sans
// capitalize, jour court vs long), ce qui rendait impossible de reconnaître un
// même call d'un écran à l'autre.
//
// Chaque fonction prend le fuseau du LECTEUR (règle produit du 2026-08-19) :
// l'appelant le récupère via useViewerTimeZone(). Le paramètre est optionnel et
// retombe sur Paris — utile hors composant React, jamais dans un rendu.

// Jour et mois dans le fuseau du lecteur : un call à 00:30 tombe la veille en UTC,
// donc lire la date sans conversion afficherait le mauvais jour dans le rail.
export function formatCallDay(dateStr: string, tz: string = DEFAULT_TIME_ZONE): { day: string; month: string } {
  const { day, monthShort } = formatDayPartsIn(new Date(dateStr), tz);
  return { day, month: monthShort };
}

// "14:30" — toujours sur 2 chiffres, aligné en tabular-nums côté CSS.
export function formatCallTime(dateStr: string, tz: string = DEFAULT_TIME_ZONE): string {
  return formatTimeIn(new Date(dateStr), tz);
}

// "Lundi 14 juin" — utilisé par le bandeau "Prochain call" et les demandes en
// attente, jamais sur les cartes de liste (trop long). Le capitalize est appliqué
// ici plutôt qu'en CSS pour être cohérent partout : textTransform était présent à
// certains endroits et absent à d'autres pour la même chaîne.
export function formatCallLongDate(dateStr: string, tz: string = DEFAULT_TIME_ZONE): string {
  const s = formatDateIn(new Date(dateStr), tz);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type CallPeriod = {
  key: string;
  label: string;
};

// Regroupement d'un call en période, pour les séparateurs de la liste.
// Les bornes sont calendaires (lundi 00:00, 1er du mois 00:00) et non glissantes :
// "cette semaine" doit vouloir dire la semaine en cours, pas les 7 derniers jours —
// sinon un même call change de groupe d'une heure à l'autre.
//
// VOLONTAIREMENT SANS PARAMÈTRE DE FUSEAU : les bornes sont déjà calculées en heure
// locale de l'appareil (setHours, getDay), donc dans le fuseau du lecteur — c'est
// exactement le comportement voulu. Le sujet ici est le regroupement, pas
// l'affichage d'une heure précise. Ne pas "corriger" en y injectant un fuseau.
function getCallPeriod(dateStr: string, now: number = Date.now()): CallPeriod {
  const d = new Date(dateStr);
  const ref = new Date(now);

  // Lundi 00:00 de la semaine en cours (getDay: 0 = dimanche → on ramène à 6).
  const startOfWeek = new Date(ref);
  const dayOfWeek = (ref.getDay() + 6) % 7;
  startOfWeek.setDate(ref.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(ref.getFullYear(), ref.getMonth(), 1);

  if (d.getTime() >= startOfWeek.getTime()) {
    return { key: 'this-week', label: 'Cette semaine' };
  }
  if (d.getTime() >= startOfMonth.getTime()) {
    return { key: 'this-month', label: 'Ce mois-ci' };
  }

  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return { key, label: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1) };
}

export type CallGroup<T> = {
  key: string;
  label: string;
  calls: T[];
};

// Regroupe une liste DÉJÀ TRIÉE en périodes consécutives. Ne trie pas lui-même :
// l'ordre diffère selon l'usage (ascendant pour "à venir", descendant pour
// l'historique) et c'est l'appelant qui le sait.
export function groupCallsByPeriod<T extends { scheduled_at: string | null }>(
  calls: T[],
  now: number = Date.now()
): CallGroup<T>[] {
  const groups: CallGroup<T>[] = [];
  for (const call of calls) {
    if (!call.scheduled_at) continue;
    const period = getCallPeriod(call.scheduled_at, now);
    const last = groups[groups.length - 1];
    if (last && last.key === period.key) {
      last.calls.push(call);
    } else {
      groups.push({ key: period.key, label: period.label, calls: [call] });
    }
  }
  return groups;
}
