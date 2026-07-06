import { useRef, useCallback } from 'react';
import { hapticFeedback } from '@/lib/haptics';

// Appui long tactile (mobile) — ouvre le menu contextuel des messages, équivalent
// du clic droit desktop. ~500ms de maintien, annulé si le doigt bouge (scroll).
export function useLongPress(onLongPress: (e: React.TouchEvent) => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startPos.current = { x: touch.clientX, y: touch.clientY };
    movedRef.current = false;
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) {
        hapticFeedback();
        onLongPress(e);
      }
    }, delay);
  }, [onLongPress, delay]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startPos.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - startPos.current.x);
    const dy = Math.abs(touch.clientY - startPos.current.y);
    if (dx > 10 || dy > 10) { movedRef.current = true; clear(); }
  }, [clear]);

  const onTouchEnd = useCallback(() => { clear(); }, [clear]);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd };
}
