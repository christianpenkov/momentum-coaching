'use client';

import { useEffect, RefObject } from 'react';

/**
 * Corrige la hauteur du shell mobile via visualViewport (barre d'adresse qui se replie,
 * clavier qui s'ouvre) — 100dvh en CSS est un bon fallback mais visualViewport est plus
 * précis et réactif (évite un résidu de scroll dans la messagerie notamment).
 * Même comportement partagé entre le layout coach et le layout élève.
 */
export function useViewportShellHeight(shellRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (window.innerWidth > 767) return;
    const vv = window.visualViewport;
    if (!vv) return;

    // Hauteur de référence sans clavier (screen.height est stable sur iOS, innerHeight non)
    const baseH = window.screen.height;

    function update() {
      const vvh = vv!.height;
      const kbH = Math.max(0, baseH - vvh);
      const isKeyboardOpen = kbH > 100;

      // Hauteur du shell = hauteur visuelle réelle
      if (shellRef.current) {
        shellRef.current.style.height = `${vvh}px`;
      }

      // Classe CSS sur body — plus propre et sans race condition avec l'animation iOS
      document.body.classList.toggle('keyboard-open', isKeyboardOpen);

      // Hack WebKit : empêche le décalage de Safari au focus
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        window.scrollTo(0, 0);
      }
    }

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [shellRef]);
}
