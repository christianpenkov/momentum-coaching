import { useRef, useEffect, useCallback } from 'react';

// Appui long tactile (mobile) — ouvre le menu contextuel des messages, équivalent
// du clic droit desktop. ~500ms de maintien, annulé si le doigt bouge (scroll).
//
// Retour haptique iOS : hack WebKit <input type="checkbox" switch"> (Safari
// 17.4-26.4, patché par Apple en 26.5+). Point clé confirmé par le code source
// WebKit (CheckboxInputType.cpp) : le haptique n'est déclenché QUE si le click
// a lieu dans un vrai contexte de "user gesture" actif — tout preventDefault()
// ou logique conditionnelle appliquée sur l'event qui précède/accompagne ce
// click casse cette chaîne (d'où nos essais précédents instables : parfois
// différé, parfois absent). La bonne pratique (alignée sur la lib ios-haptics) :
// ne JAMAIS réutiliser un switch existant ni interférer avec son click — créer
// un switch neuf jetable à chaque long-press confirmé, le laisser recevoir son
// propre vrai tap (via un label cliqué), puis le détruire.
//
// On sépare donc complètement les deux mécanismes : la détection de long-press
// tourne sur le wrapper normal (aucun switch dessus, aucune interférence), et
// UNIQUEMENT quand le long-press est confirmé, on superpose furtivement un
// switch+label neuf à l'endroit du doigt et on simule un clic sur le label —
// ce n'est pas un vrai tap physique, donc le haptique n'est pas garanti par la
// doc officielle, mais ne perturbe plus la détection du menu contextuel.
export function useLongPress(onTrigger: (x: number, y: number) => void, enabled: boolean, delay = 500) {
  const containerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  const clear = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled || typeof document === 'undefined') return;
    container.style.position = 'relative';

    const fireHaptic = () => {
      const id = `haptic-switch-${Math.random().toString(36).slice(2)}`;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.id = id;
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
      Object.assign(input.style, {
        position: 'fixed', opacity: '0', pointerEvents: 'none', width: '1px', height: '1px',
      });
      const label = document.createElement('label');
      label.htmlFor = id;
      Object.assign(label.style, {
        position: 'fixed', opacity: '0', pointerEvents: 'none', width: '1px', height: '1px',
      });
      document.body.appendChild(input);
      document.body.appendChild(label);
      label.click();
      setTimeout(() => { input.remove(); label.remove(); }, 300);
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startPos.current = { x: touch.clientX, y: touch.clientY };
      movedRef.current = false;
      timerRef.current = setTimeout(() => {
        if (!movedRef.current) {
          fireHaptic();
          onTriggerRef.current(touch.clientX, touch.clientY);
        }
      }, delay);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!startPos.current) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - startPos.current.x);
      const dy = Math.abs(touch.clientY - startPos.current.y);
      if (dx > 10 || dy > 10) { movedRef.current = true; clear(); }
    };

    const onTouchEnd = () => clear();

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      onTriggerRef.current(e.clientX, e.clientY);
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    container.addEventListener('contextmenu', onContextMenu);

    return () => {
      clear();
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      container.removeEventListener('contextmenu', onContextMenu);
    };
  }, [delay, clear, enabled]);

  return { ref: containerRef as React.RefObject<HTMLDivElement> };
}
