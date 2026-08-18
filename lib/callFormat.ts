import { formatParisTime, formatParisDate } from '@/lib/parisTime';

// Formatage et regroupement des dates de call — source unique pour les pages Calls
// coach et élève. Avant centralisation, la même donnée était formatée de 6 façons
// différentes selon l'endroit (avec/sans année, avec/sans heure, avec/sans
// capitalize, jour court vs long), ce qui rendait impossible de reconnaître un
// même call d'un écran à l'autre.
//
// Toutes les heures passent par lib/parisTime : règle produit du 2026-07-25, une
// heure de call est TOUJOURS en heure de Paris, y compris pour un élève ou un coach
// physiquement dans un autre fuseau (voir l'en-tête de lib/parisTime.ts).

// Jour + mois court pour le rail latéral de la carte : { day: '14', month: 'juin' }.
// Séparé en deux champs (et non une chaîne) parce que le rail les empile sur deux
// lignes avec des tailles différentes.
const MONTHS_SHORT_FR = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

// Jour et mois en heure de Paris : un call à 00:30 heure de Paris tombe la veille
// en UTC, donc lire la date sans conversion afficherait le mauvais jour dans le rail.
export function formatCallDay(dateStr: string): { day: string; month: string } {
  // formatParisDate donne "lundi 14 juin" — on repart de la même bascule d'offset
  // en réutilisant sa sortie plutôt que de dupliquer le calcul d'heure d'été.
  const parts = formatParisDate(new Date(dateStr)).split(' ');
  const day = parts[1] ?? '';
  const monthName = parts[2] ?? '';
  const monthIdx = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'].indexOf(monthName);
  return {
    day: day.padStart(2, '0'),
    month: monthIdx >= 0 ? MONTHS_SHORT_FR[monthIdx] : monthName,
  };
}

// "14:30" — toujours sur 2 chiffres, aligné en tabular-nums côté CSS.
export function formatCallTime(dateStr: string): string {
  return formatParisTime(new Date(dateStr));
}

// "lundi 14 juin" — utilisé par le bandeau "Prochain call" et les demandes en
// attente, jamais sur les cartes de liste (trop long). Le capitalize est appliqué
// ici plutôt qu'en CSS pour être cohérent partout : textTransform était présent à
// certains endroits et absent à d'autres pour la même chaîne.
export function formatCallLongDate(dateStr: string): string {
  const s = formatParisDate(new Date(dateStr));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type CallPeriod = {
  key: string;
  label: string;
};

// Regroupement d'un call en période, pour les séparateurs collants de la liste.
// Les bornes sont calendaires (lundi 00:00, 1er du mois 00:00) et non glissantes :
// "cette semaine" doit vouloir dire la semaine en cours, pas les 7 derniers jours —
// sinon un même call change de groupe d'une heure à l'autre.
export function getCallPeriod(dateStr: string, now: number = Date.now()): CallPeriod {
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
