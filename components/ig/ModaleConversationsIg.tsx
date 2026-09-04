'use client';

import ModalShell from '@/components/ui/ModalShell';
import ConversationsIg from '@/components/ig/ConversationsIg';

/**
 * L'enveloppe MODALE des conversations, côté coach.
 *
 * ⚠️ Ce fichier ne contient que l'enveloppe. Le maître-détail vit dans
 * `ConversationsIg`, qui ne connaît pas son contexte : côté élève, le même
 * composant est une PAGE. Une version antérieure embarquait `ModalShell` dans le
 * composant lui-même, et la page de l'élève affichait donc une modale posée sur
 * du vide, avec une croix de fermeture qui ne menait nulle part.
 *
 * ⚠️ La modale occupe presque tout l'écran (demande de Chris, 2026-09-04). Un
 * fil de conversation annoté est dense : une modale étroite oblige à faire
 * défiler pour lire ce qu'on pourrait embrasser d'un regard, et c'est
 * précisément le geste que cet écran doit épargner au coach.
 */
export default function ModaleConversationsIg({
  profileId, prenomEleve, annotable, onClose,
}: {
  profileId: string;
  prenomEleve: string;
  annotable: boolean;
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose} width={1500}>
      <ConversationsIg
        profileId={profileId}
        prenomEleve={prenomEleve}
        annotable={annotable}
        titre={`Conversations de ${prenomEleve}`}
        hauteur="min(88vh, 940px)"
      />
    </ModalShell>
  );
}
