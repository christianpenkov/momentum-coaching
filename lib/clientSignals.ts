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
  total: number;
}

// Par élève : tâches assignées par le coach en retard (non résolues) + no-shows non acquittés.
// Les tâches personnelles de l'élève (added_by='client') ne comptent jamais ici — elles
// restent son affaire privée, le coach n'a de comptes à rendre que sur ce qu'il a assigné.
export function getClientSignals(tasks: Task[], sessionReports: SessionReport[]): ClientSignals {
  const overdueTasksCount = tasks.filter(t => t.added_by === 'coach' && isTaskOverdue(t)).length;
  const activeNoShowsCount = sessionReports.filter(r => r.attended === false && !r.acknowledged_at).length;
  return { overdueTasksCount, activeNoShowsCount, total: overdueTasksCount + activeNoShowsCount };
}

// Agrégée pour le coach, sur tous ses élèves.
export function getAggregatedSignals(perClient: ClientSignals[]): ClientSignals {
  return perClient.reduce((acc, s) => ({
    overdueTasksCount: acc.overdueTasksCount + s.overdueTasksCount,
    activeNoShowsCount: acc.activeNoShowsCount + s.activeNoShowsCount,
    total: acc.total + s.total,
  }), { overdueTasksCount: 0, activeNoShowsCount: 0, total: 0 });
}
