'use client';

import { useEffect, RefObject } from 'react';
import { logScroll, shortStack } from '@/lib/scrollDebug';

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

    function update(eventType: string) {
      const vvh = vv!.height;
      const kbH = Math.max(0, baseH - vvh);
      const isKeyboardOpen = kbH > 100;

      // Redimensionner le shell (conteneur racine de toute la page) fait bouger
      // mécaniquement le scroll de ses enfants (comportement natif du navigateur quand
      // un ancêtre change de taille) — visible notamment au cold start, quand la barre
      // d'adresse Safari se replie pour de vrai lors du premier scroll/tap : la zone de
      // messages en dessous "sautait" de plusieurs messages sans qu'aucun code de la
      // messagerie elle-même n'en soit responsable. On capture le gap au bas du scroll
      // de la messagerie AVANT le resize et on le restaure juste après, pour que ce
      // changement de hauteur du shell (légitime) n'ait jamais d'effet de bord visible
      // sur la position de lecture de l'utilisateur.
      const chatZone = document.querySelector<HTMLElement>('.chat-messages-zone');
      const gapBefore = chatZone ? chatZone.scrollHeight - chatZone.scrollTop - chatZone.clientHeight : null;
      const shellHeightBefore = shellRef.current?.style.height;

      logScroll('shellHeight update() called', {
        eventType, vvh, kbH, isKeyboardOpen, shellHeightBefore,
        chatZoneScrollTop: chatZone?.scrollTop, chatZoneScrollHeight: chatZone?.scrollHeight,
        chatZoneClientHeight: chatZone?.clientHeight, gapBefore,
        activeElement: document.activeElement?.tagName,
        stack: shortStack(),
      });

      // Hauteur du shell = hauteur visuelle réelle
      if (shellRef.current) {
        shellRef.current.style.height = `${vvh}px`;
      }

      if (chatZone && gapBefore !== null) {
        const newScrollTop = chatZone.scrollHeight - chatZone.clientHeight - gapBefore;
        logScroll('shellHeight restoring chatZone scrollTop', { newScrollTop, actualBefore: chatZone.scrollTop });
        chatZone.scrollTop = newScrollTop;
        logScroll('shellHeight after restore', { actualAfter: chatZone.scrollTop });
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

    logScroll('useViewportShellHeight mounted', { baseH, initialVvh: vv.height });
    update('mount');
    const onResize = () => update('resize');
    const onScroll = () => update('scroll');
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onScroll);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onScroll);
    };
  }, [shellRef]);
}
