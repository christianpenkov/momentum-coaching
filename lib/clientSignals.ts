import type { Task, SessionReport } from '@/lib/supabase/types';

export function isTaskOverdue(t: Task): boolean {
  if (t.done || t.resolved_by_coach || !t.deadline) return false;
  return new Date(t.deadline).getTime() < Date.now();
}

export interface DeadlineStatus {
  overdue: boolean;
  urgent: boolean;
  color: string;
  label: string;
}

// Statut d'affichage d'une deadline (badge) — utilisé par tous les endroits qui affichent
// "En retard"/"Aujourd'hui"/"Demain"/date, pour rester cohérent avec isTaskOverdue une fois
// que deadline porte une heure précise (ex: en retard dès 18h01, pas seulement le lendemain).
function isEndOfDay(d: Date): boolean {
  return d.getHours() === 23 && d.getMinutes() >= 55;
}

export function getDeadlineStatus(deadline: string | null | undefined, done: boolean): DeadlineStatus | null {
  if (!deadline || done) return null;
  const target = new Date(deadline);
  const now = new Date();
  const overdueMs = now.getTime() - target.getTime();
  const overdue = overdueMs > 0;
  const diffDays = Math.ceil((target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  const urgent = !overdue && diffDays <= 2 && diffDays >= 0;
  const color = overdue ? 'var(--red)' : urgent ? 'var(--amber)' : 'var(--muted)';
  const timeSuffix = isEndOfDay(target) ? '' : ` · ${target.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const overdueLabel = overdueMs < 3600000
    ? 'En retard · <1h'
    : overdueMs < 86400000
    ? `En retard · ${Math.floor(overdueMs / 3600000)}h`
    : `En retard · ${Math.floor(overdueMs / 86400000)}j`;
  const label = overdue
    ? overdueLabel
    : diffDays === 0 ? `Aujourd'hui${timeSuffix}`
    : diffDays === 1 ? 'Demain'
    : target.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return { overdue, urgent, color, label };
}

export type TaskBucket = 'over' | 'today' | 'week' | 'later' | 'done';

// Regroupement à 5 niveaux utilisé par les pages Tâches (coach + élève) pour grouper
// l'affichage. `over` respecte les mêmes règles que isTaskOverdue (une tâche résolue par
// le coach n'est jamais "en retard" même si sa deadline est passée et qu'elle n'est pas done).
export function getTaskBucket(t: Task): TaskBucket {
  if (t.done) return 'done';
  if (isTaskOverdue(t)) return 'over';
  if (!t.deadline) return 'later';
  const target = new Date(t.deadline);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.ceil((target.getTime() - startOfToday.getTime()) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays <= 7) return 'week';
  return 'later';
}

export interface ClientSignals {
  overdueTasksCount: number;
  activeNoShowsCount: number;
  /** Jours depuis la dernière publication, ou `null` quand on ne sait pas — un appelant
   *  qui ne fournit pas la donnée n'affirme pas « 0 jour », il n'affirme rien. */
  joursSansPublier: number | null;
  publicationArretee: boolean;
  total: number;
}

/** Le seul seuil de la page Stats Clients. Les deux autres signaux n'en ont pas besoin :
 *  une tâche est en retard ou ne l'est pas, un no-show est acquitté ou ne l'est pas.
 *  Choisi par Chris le 2026-09-01, contre 21 recommandés — parti pris de sensibilité,
 *  à revoir si la bande finit toujours pleine (une bande toujours pleine n'est plus lue). */
export const SEUIL_JOURS_SANS_PUBLIER = 7;

// Par élève : tâches assignées par le coach en retard (non résolues), no-shows non
// acquittés, et arrêt de publication.
//
// Les tâches personnelles de l'élève (added_by='client') ne comptent jamais ici — elles
// restent son affaire privée, le coach n'a de comptes à rendre que sur ce qu'il a assigné.
//
// ⚠️ `joursSansPublier` est le TROISIÈME paramètre et il est optionnel, délibérément :
// les sept sites d'appel existants passent deux arguments et gardent donc exactement le
// comportement d'avant. Seuls les écrans qui disposent de la donnée (accueil coach et
// Stats Clients) la passent. Sans elle, le signal n'est pas « à zéro », il est ABSENT.
export function getClientSignals(
  tasks: Task[],
  sessionReports: SessionReport[],
  joursSansPublier: number | null = null,
): ClientSignals {
  const overdueTasksCount = tasks.filter(t => t.added_by === 'coach' && isTaskOverdue(t)).length;
  const activeNoShowsCount = sessionReports.filter(r => r.attended === false && !r.acknowledged_at).length;
  const publicationArretee = joursSansPublier !== null && joursSansPublier >= SEUIL_JOURS_SANS_PUBLIER;
  return {
    overdueTasksCount,
    activeNoShowsCount,
    joursSansPublier,
    publicationArretee,
    total: overdueTasksCount + activeNoShowsCount + (publicationArretee ? 1 : 0),
  };
}

export interface AggregatedSignals {
  overdueTasksCount: number;
  activeNoShowsCount: number;
  publicationArreteeCount: number;
  total: number;
}

// Agrégée pour le coach, sur tous ses élèves.
export function getAggregatedSignals(perClient: ClientSignals[]): AggregatedSignals {
  return perClient.reduce((acc, s) => ({
    overdueTasksCount: acc.overdueTasksCount + s.overdueTasksCount,
    activeNoShowsCount: acc.activeNoShowsCount + s.activeNoShowsCount,
    publicationArreteeCount: acc.publicationArreteeCount + (s.publicationArretee ? 1 : 0),
    total: acc.total + s.total,
  }), { overdueTasksCount: 0, activeNoShowsCount: 0, publicationArreteeCount: 0, total: 0 });
}

/* ─── Ce que DEUX écrans partagent : la sélection et la phrase ─────────────────
 *
 * L'accueil coach (carte « Clients à surveiller ») et la page Stats Clients doivent
 * montrer LES MÊMES élèves. Ces deux fonctions étaient une expression locale dans
 * PageToday ; les recopier ailleurs aurait rouvert le motif des onze écarts entre
 * écrans du 2026-08-19 — une règle dupliquée diverge dès que l'une des copies bouge.
 *
 * Seule différence assumée entre les deux écrans : le PLAFOND. L'accueil montre les 4
 * plus urgents et renvoie vers Stats Clients ; Stats Clients les montre tous dans un
 * carrousel. C'est un argument, pas une seconde règle.
 */

export interface AvecSignaux<T> {
  client: T;
  signals: ClientSignals;
}

export function watchList<T>(entries: AvecSignaux<T>[], max?: number): AvecSignaux<T>[] {
  const retenus = entries
    .filter(e => e.signals.total > 0)
    .sort((a, b) => b.signals.total - a.signals.total);
  return max === undefined ? retenus : retenus.slice(0, max);
}

/** La phrase affichée sous le nom : « 3 tâches en retard · 1 no-show ».
 *  Elle dit ce qui s'est passé, jamais un score — un score ne s'explique pas à l'écran. */
export function phraseSignaux(s: ClientSignals): string {
  return [
    s.overdueTasksCount > 0
      ? `${s.overdueTasksCount} tâche${s.overdueTasksCount > 1 ? 's' : ''} en retard`
      : null,
    s.activeNoShowsCount > 0
      ? `${s.activeNoShowsCount} no-show${s.activeNoShowsCount > 1 ? 's' : ''}`
      : null,
    s.publicationArretee ? `aucune publication depuis ${s.joursSansPublier} jours` : null,
  ].filter(Boolean).join(' · ');
}
