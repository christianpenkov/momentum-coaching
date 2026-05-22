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

    // Fallback sans View Transitions API
    if (!('startViewTransition' in document)) {
      router.push(destination);
      return;
    }

    const endRadius = Math.hypot(
      Math.max(ox, window.innerWidth - ox),
      Math.max(oy, window.innerHeight - oy),
    );

    // startViewTransition : le browser snapshote la page courante,
    // exécute le callback (navigate), puis anime entre les deux états
    const transition = (document as any).startViewTransition(() => {
      router.push(destination);
    });

    // transition.ready = les pseudo-éléments ::view-transition-* existent
    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${ox}px ${oy}px)`,
            `circle(${endRadius}px at ${ox}px ${oy}px)`,
          ],
        },
        {
          duration: 700,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    });
  }, [router]);

  return (
    <IrisContext.Provider value={{ triggerIris }}>
      {children}
      <style>{`
        /* Désactiver l'animation par défaut (crossfade) du View Transitions API */
        ::view-transition-old(root) { animation: none; }
        ::view-transition-new(root) { animation: none; }
      `}</style>
    </IrisContext.Provider>
  );
}
