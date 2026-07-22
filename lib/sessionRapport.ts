import type { Call } from '@/lib/supabase/types';

export const SESSION_TOPICS = [
  { value: 'strategie_contenu', label: 'Stratégie contenu' },
  { value: 'closing_vente', label: 'Closing / vente' },
  { value: 'mindset_blocage', label: 'Mindset / blocage' },
  { value: 'technique_outils', label: 'Technique / outils' },
  { value: 'autre', label: 'Autre' },
] as const;

export type SessionTopic = (typeof SESSION_TOPICS)[number]['value'];

// Calls Google coach-élève passés, sans rapport de session encore rempli.
// Déclenché dès l'heure de DÉBUT (pas la fin) pour permettre de noter un no-show immédiatement.
// status === 'active' exclut nativement les calls canceled : un call reporté (toujours recréé
// en canceled + nouveau call actif) ne redéclenche jamais de rapport sur l'ancien call.
export function getPendingSessionRapports(calls: Call[]): Call[] {
  const now = Date.now();
  return calls.filter(c =>
    c.call_type === 'google' &&
    c.calendly_event_uuid === null &&
    c.status === 'active' &&
    c.scheduled_at !== null &&
    new Date(c.scheduled_at).getTime() <= now &&
    !c.session_completed &&
    !c.session_no_show
  );
}

// duration est toujours stocké au format "{N} min" — jamais "1h30" ou autre format.
function callEndTime(call: Call): number {
  const start = call.scheduled_at ? new Date(call.scheduled_at).getTime() : 0;
  const mins = call.duration ? parseInt(call.duration, 10) || 0 : 0;
  return start + mins * 60_000;
}

// Un call est "vraiment terminé" dès que son rapport a été rempli (outcome pour le
// flux Calendly/prospect, session_completed/session_no_show pour le flux coaching
// Google Meet) — même si l'heure de fin théorique (scheduled_at + duration) n'est
// pas encore atteinte. Sinon, terminé dès l'heure de fin dépassée. Utilisé partout
// où on détermine le "prochain call"/"call actif" (widget élève, banderole coach,
// stack Calls du jour) pour ne pas continuer à afficher un call déjà clôturé.
export function isCallReallyOver(call: Call, now: number = Date.now()): boolean {
  const reportFilled = call.outcome != null || call.session_completed === true || call.session_no_show === true;
  if (reportFilled) return true;
  return callEndTime(call) < now;
}
