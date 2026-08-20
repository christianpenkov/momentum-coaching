'use client';

import { useEffect, useState } from 'react';
import SessionRapportModal from '@/components/ui/SessionRapportModal';
import ModalShell from '@/components/ui/ModalShell';
import { fetchRapportDraft, isDraftStale, type RapportDraft } from '@/lib/useRapportDraft';
import type { SessionTopic } from '@/lib/sessionRapport';

/**
 * Résout le brouillon AVANT de monter la modale.
 *
 * Pourquoi pas un `useEffect` d'hydratation dans la modale : le formulaire
 * s'afficherait d'abord vide à l'étape 1, puis sauterait à l'étape enregistrée. Un
 * clic pendant cette fenêtre serait écrasé, et le saut se voit.
 *
 * ⚠️ PIÈGE À NE PAS RÉINTRODUIRE : le brouillon est chargé UNE SEULE FOIS, au
 * montage. Ne jamais le rafraîchir après une sauvegarde, et ne jamais faire
 * dépendre la `key` de `updated_at` — la modale se remonterait à chaque frappe et
 * perdrait la saisie en cours. Ce composant est un chargeur initial, pas un miroir
 * synchronisé.
 */
export default function SessionRapportModalLoader(props: {
  callId: string;
  studentName: string | null;
  scheduledAt: string | null;
  topic?: string | null;
  onClose: () => void;
  editInitial?: { topic: SessionTopic | null; topicCustom: string; notes: string; attended?: boolean | null };
}) {
  const [state, setState] = useState<{ loading: boolean; draft: RapportDraft | null }>({ loading: true, draft: null });

  // Un seul garde, `alive`, et surtout PAS de drapeau « déjà demandé » persistant :
  // en développement React monte deux fois (StrictMode). Un ref qui survit au
  // démontage bloquerait la requête du second montage, et l'écran resterait sur
  // « Chargement… » indéfiniment — c'est arrivé.
  useEffect(() => {
    let alive = true;
    fetchRapportDraft(props.callId).then(({ draft, call }) => {
      if (!alive) return;
      // Un brouillon de saisie initiale sur un call déjà rapporté a été doublé par
      // une soumission ailleurs : on le jette, la vérité est en base.
      setState({ loading: false, draft: isDraftStale(draft, call) ? null : draft });
    });
    return () => { alive = false; };
  }, [props.callId]);

  // Coquille vide plutôt que la modale à l'étape 1 : mieux vaut 150 ms d'attente
  // qu'un formulaire qui saute sous les doigts.
  if (state.loading) {
    return (
      <ModalShell onClose={props.onClose} width={520}>
        <div style={{ padding: '48px 30px', textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          Chargement…
        </div>
      </ModalShell>
    );
  }

  return <SessionRapportModal {...props} initialDraft={state.draft} />;
}
