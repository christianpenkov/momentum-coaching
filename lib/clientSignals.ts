import type { Task, SessionReport } from '@/lib/supabase/types';

export function isTaskOverdue(t: Task): boolean {
  if (t.done || t.resolved_by_coach || !t.deadline) return false;
  const d = new Date(t.deadline); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
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
