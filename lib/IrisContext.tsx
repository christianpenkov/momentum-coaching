'use client';

import { createContext, useContext, useCallback, ReactNode } from 'react';
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
  const router = useRouter();

  const triggerIris = useCallback((destination: string, ox: number, oy: number) => {
    if (typeof window === 'undefined') { router.push(destination); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { router.push(destination); return; }

    // Passe les coordonnées au CSS via des custom properties sur :root
    const endRadius = Math.hypot(
      Math.max(ox, window.innerWidth - ox),
      Math.max(oy, window.innerHeight - oy),
    );
    document.documentElement.style.setProperty('--iris-ox', `${ox}px`);
    document.documentElement.style.setProperty('--iris-oy', `${oy}px`);
    document.documentElement.style.setProperty('--iris-r', `${endRadius}px`);

    // router.push avec transitionTypes pour activer la View Transition React/Next.js
    router.push(destination, { transition: 'iris-open' } as any);
  }, [router]);

  return (
    <IrisContext.Provider value={{ triggerIris }}>
      {children}
      <style>{`
        /* Désactive le crossfade par défaut */
        ::view-transition-old(root) { animation: none; }
        /* Anime uniquement la nouvelle page avec le clip-path circulaire */
        ::view-transition-new(root) {
          animation: iris-reveal 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes iris-reveal {
          from { clip-path: circle(0px     at var(--iris-ox, 50%) var(--iris-oy, 50%)); }
          to   { clip-path: circle(var(--iris-r, 200vmax) at var(--iris-ox, 50%) var(--iris-oy, 50%)); }
        }
        @media (prefers-reduced-motion: reduce) {
          ::view-transition-old(root), ::view-transition-new(root) {
            animation-duration: 0s !important;
          }
        }
      `}</style>
    </IrisContext.Provider>
  );
}
