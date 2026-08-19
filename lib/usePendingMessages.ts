'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useOnline } from '@/lib/useOnline';

/**
 * File d'envoi des messages écrits hors connexion.
 *
 * Sans elle, un message envoyé sans réseau était retiré de la conversation et
 * son texte rendu au champ de saisie : correct, mais l'utilisateur devait
 * penser à le renvoyer lui-même. Ici il reste affiché en attente et part dès
 * que le réseau revient.
 *
 * File EN MÉMOIRE, volontairement : elle ne survit pas à la fermeture de l'app.
 * Une file persistée demanderait de gérer les doublons, l'ordre d'envoi et les
 * messages devenus trop vieux — de la maintenance durable pour un gain marginal,
 * puisque l'utilisateur voit que son message est en attente et peut le retaper.
 *
 * Un seul envoi à la fois et dans l'ordre d'écriture : deux messages partis en
 * parallèle pourraient s'afficher inversés chez le destinataire.
 */

export interface PendingMessage {
  /** id optimiste, sert aussi à retrouver la bulle affichée */
  id: string;
  send: () => Promise<boolean>;
}

export function usePendingMessages(onSent: (pendingId: string) => void) {
  const online = useOnline();
  const queue = useRef<PendingMessage[]>([]);
  const flushing = useRef(false);
  // Ref et non closure : flush() est appelé depuis un effet, il doit toujours
  // voir la dernière version du callback sans être recréé.
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  const flush = useCallback(async () => {
    if (flushing.current || queue.current.length === 0) return;
    flushing.current = true;
    try {
      // Boucle séquentielle : on s'arrête au premier échec plutôt que de
      // continuer, sinon on brûlerait toute la file sur un réseau encore absent.
      while (queue.current.length > 0) {
        const next = queue.current[0];
        const ok = await next.send();
        if (!ok) break;
        queue.current.shift();
        onSentRef.current(next.id);
      }
    } finally {
      flushing.current = false;
    }
  }, []);

  // Le retour du réseau vide la file. useOnline confirme par une vraie requête,
  // donc on ne repart pas sur un faux positif (wifi sans internet).
  useEffect(() => {
    if (online) flush();
  }, [online, flush]);

  /** Met un message en attente. Tente un envoi immédiat si le réseau est là. */
  const enqueue = useCallback((msg: PendingMessage) => {
    queue.current.push(msg);
    flush();
  }, [flush]);

  /** Retire un message de la file (annulation par l'utilisateur). */
  const cancel = useCallback((id: string) => {
    queue.current = queue.current.filter(m => m.id !== id);
  }, []);

  return { enqueue, cancel, online };
}
