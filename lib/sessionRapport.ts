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

// Délai de rattrapage pour le bouton "Rejoindre" — un coach/élève en retard doit
// pouvoir rejoindre encore quelques minutes après la fin théorique du call. Distinct
// d'isCallReallyOver (qui reste la référence stricte pour historique/rapport, jamais
// modifiée) : un call peut être "réellement terminé" (bascule en historique) tout en
// restant "joignable" quelques minutes de plus.
const JOIN_GRACE_PERIOD_MS = 15 * 60_000;

// Pas de borne basse (avant scheduled_at) : on peut déjà rejoindre en avance
// aujourd'hui sur les 3 boutons "Rejoindre" existants, comportement préservé ici.
export function isCallJoinable(call: Call, now: number = Date.now()): boolean {
  const reportFilled = call.outcome != null || call.session_completed === true || call.session_no_show === true;
  if (reportFilled) return false;
  if (['canceled', 'cancelled', 'declined'].includes(call.status || '')) return false;
  if (!call.scheduled_at) return false;
  return now <= callEndTime(call) + JOIN_GRACE_PERIOD_MS;
}

// Lecture stricte : vrai uniquement dans le créneau planifié (entre le début et la fin
// théorique), jamais pendant le délai de rattrapage — sert uniquement au badge "En cours"
// affiché sur les cartes de la liste À venir.
export function isCallInProgress(call: Call, now: number = Date.now()): boolean {
  if (!call.scheduled_at) return false;
  if (['canceled', 'cancelled', 'declined'].includes(call.status || '')) return false;
  const start = new Date(call.scheduled_at).getTime();
  return now >= start && now < callEndTime(call);
}

// Délai de grâce avant d'afficher "non enregistré" — Fathom traite l'enregistrement
// (transcript/résumé) quelques minutes après la fin du call, jamais instantanément.
// En dessous de ce délai on ne sait juste pas encore, donc on n'affiche rien plutôt
// qu'un faux "non enregistré" qui se corrigerait tout seul quelques minutes plus tard.
const FATHOM_GRACE_PERIOD_MS = 2 * 60 * 60_000;

export function isCallMissingRecording(call: Call, now: number = Date.now()): boolean {
  if (call.fathom_status === 'matched') return false;
  if (call.status === 'canceled' || call.no_show === true || call.session_no_show === true) return false;
  return callEndTime(call) + FATHOM_GRACE_PERIOD_MS < now;
}
