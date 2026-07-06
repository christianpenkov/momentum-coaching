import { useRef, useEffect, useCallback } from 'react';

// Appui long tactile (mobile) — ouvre le menu contextuel des messages, équivalent
// du clic droit desktop. ~500ms de maintien, annulé si le doigt bouge (scroll).
//
// Note : un retour haptique (vibration) au déclenchement a été tenté via le hack
// WebKit <input type="checkbox" switch"> mais abandonné — trop instable en
// pratique (le haptique n'est fiable que sur un vrai tap physique direct sur le
// switch, incompatible avec une détection de long-press custom déclenchée après
// coup). navigator.vibrate() n'est de toute façon pas supporté sur iOS Safari.
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
    if (!container || !enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startPos.current = { x: touch.clientX, y: touch.clientY };
      movedRef.current = false;
      timerRef.current = setTimeout(() => {
        if (!movedRef.current) onTriggerRef.current(touch.clientX, touch.clientY);
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
