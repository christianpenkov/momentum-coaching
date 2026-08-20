'use client';

import { useEffect } from 'react';

/**
 * Ferme une couche modale à la touche Échap.
 *
 * Réflexe universel sur desktop : une modale qui ne s'y ferme pas oblige à
 * viser la croix à la souris. `ModalShell` le gère déjà pour les modales qui
 * passent par lui ; ce hook sert à celles qui montent leur propre portal.
 *
 * @param enabled false quand la couche est fermée — sinon plusieurs modales
 * montées en même temps se fermeraient toutes d'un seul Échap.
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Ne pas voler l'Échap à un champ en cours de saisie (annulation d'une
      // suggestion, sortie d'un menu natif) : le navigateur le traite d'abord.
      if (e.defaultPrevented) return;
      onEscape();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape, enabled]);
}
