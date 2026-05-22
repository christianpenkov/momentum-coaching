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
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const triggerIris = useCallback((destination: string, ox: number, oy: number) => {
    if (typeof window === 'undefined') { router.push(destination); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { router.push(destination); return; }

    const endRadius = Math.hypot(
      Math.max(ox, window.innerWidth - ox),
      Math.max(oy, window.innerHeight - oy),
    );

    // 1. Montre le div (position fixed, background beige, clip-path = 0px)
    setVisible(true);

    // 2. Attend que le div soit dans le DOM, puis lance l'animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = overlayRef.current;
        if (!el) { router.push(destination); return; }

        // Web Animations API — aucun conflit avec CSS inline
        const anim = el.animate(
          [
            { clipPath: `circle(0px at ${ox}px ${oy}px)` },
            { clipPath: `circle(${endRadius}px at ${ox}px ${oy}px)` },
          ],
          {
            duration: 700,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards',
          }
        );

        // Navigate immédiatement — le dashboard charge sous l'overlay
        router.push(destination);

        // Retire l'overlay quand l'animation est finie
        anim.onfinish = () => setVisible(false);
      });
    });
  }, [router]);

  return (
    <IrisContext.Provider value={{ triggerIris }}>
      {children}
      {visible && (
        <div
          ref={overlayRef}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'var(--bg)',
            pointerEvents: 'none',
          }}
        />
      )}
    </IrisContext.Provider>
  );
}
