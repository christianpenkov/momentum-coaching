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
