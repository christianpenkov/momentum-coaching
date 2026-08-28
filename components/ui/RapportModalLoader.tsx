'use client';

import { type RapportExistant } from '@/lib/rapportPatch';
import { useEffect, useState } from 'react';
import RapportModal from '@/components/ui/RapportModal';
import ModalShell from '@/components/ui/ModalShell';
import { fetchRapportDraft, isDraftStale, type RapportDraft } from '@/lib/useRapportDraft';

/**
 * Résout le brouillon AVANT de monter la modale de rapport de vente.
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
 *
 * Pas de garde « déjà demandé » persistant non plus : en développement React monte
 * deux fois (StrictMode), et un ref qui survit au démontage bloquerait la requête
 * du second montage — l'écran resterait sur « Chargement… ».
 */
export default function RapportModalLoader(props: {
  callId: string;
  inviteeName: string | null;
  scheduledAt: string | null;
  isFollowUp?: boolean;
  existing?: RapportExistant | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ loading: boolean; draft: RapportDraft | null }>({ loading: true, draft: null });

  useEffect(() => {
    let alive = true;
    fetchRapportDraft(props.callId).then(({ draft, call }) => {
      if (!alive) return;
      // Un brouillon de saisie initiale sur un call déjà rapporté a été doublé par
      // une soumission ailleurs (autre onglet, autre appareil, correction depuis le
      // pipeline) : on le jette, la vérité est en base.
      setState({ loading: false, draft: isDraftStale(draft, call) ? null : draft });
    });
    return () => { alive = false; };
  }, [props.callId]);

  // Coquille vide plutôt que la modale à l'étape 1 : mieux vaut 150 ms d'attente
  // qu'un formulaire qui saute sous les doigts.
  if (state.loading) {
    return (
      <ModalShell onClose={props.onClose} variant="sheet" width={520}>
        <div style={{ padding: '48px 30px', textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          Chargement…
        </div>
      </ModalShell>
    );
  }

  return <RapportModal {...props} initialDraft={state.draft} />;
}
