'use client';

import { createContext, useContext, useCallback, useRef, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface IrisContextValue {
  triggerIris: (destination: string, ox: number, oy: number) => void;
}

const IrisContext = createContext<IrisContextValue | null>(null);

export function useIris() {
  const ctx = useContext(IrisContext);
  if (!ctx) throw new Error('useIris doit être dans IrisProvider');
  return ctx;
}

export function IrisProvider({ children }: { children: ReactNode }) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const router = useRouter();

  const triggerIris = useCallback((destination: string, ox: number, oy: number) => {
    if (typeof window === 'undefined') { router.push(destination); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { router.push(destination); return; }

    setCoords({ x: ox, y: oy });

    // Après que le cercle couvre tout l'écran (600ms anim + 200ms pause), on navigue
    setTimeout(() => {
      router.push(destination);
    }, 800);
  }, [router]);

  return (
    <IrisContext.Provider value={{ triggerIris }}>
      {children}
      {coords && (
        <IrisOverlay
          x={coords.x}
          y={coords.y}
          onDone={() => setCoords(null)}
        />
      )}
    </IrisContext.Provider>
  );
}

function IrisOverlay({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const divRef = useRef<HTMLDivElement>(null);

  // Double rAF : s'assure que le div est peint avant de lancer l'animation
  const startAnim = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;

    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const anim = el.animate(
          [
            { clipPath: `circle(0px at ${x}px ${y}px)` },
            { clipPath: `circle(${endRadius}px at ${x}px ${y}px)` },
          ],
          {
            duration: 600,
            easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
            fill: 'forwards',
          }
        );
        anim.onfinish = onDone;
      });
    });
  }, [x, y, onDone]);

  return (
    <div
      ref={startAnim}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--bg)',
        pointerEvents: 'none',
        clipPath: `circle(0px at ${x}px ${y}px)`,
      }}
    />
  );
}
