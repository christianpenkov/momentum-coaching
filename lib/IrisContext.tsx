'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface IrisCoords { x: number; y: number; }
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
  const [coords, setCoords] = useState<IrisCoords | null>(null);
  const router = useRouter();

  const triggerIris = useCallback((destination: string, ox: number, oy: number) => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      router.push(destination);
      return;
    }

    // Afficher overlay (trou = 0px) → naviguer après 1 frame → délai CSS 250ms → animation ouvre le trou
    setCoords({ x: ox, y: oy });
    requestAnimationFrame(() => router.push(destination));
  }, [router]);

  return (
    <IrisContext.Provider value={{ triggerIris }}>
      {children}

      {/* Style global pour l'animation — les coords sont passées via CSS vars sur le div */}
      <style>{`
        @keyframes iris-open {
          from { clip-path: circle(0px     at var(--ox) var(--oy)); }
          to   { clip-path: circle(200vmax at var(--ox) var(--oy)); }
        }
        .iris-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: var(--bg);
          pointer-events: none;
          will-change: clip-path;
          /* Commence à 0px (overlay plein), attend 250ms que la page charge, puis ouvre */
          animation: iris-open 650ms cubic-bezier(0.22, 1, 0.36, 1) 250ms forwards;
          clip-path: circle(0px at var(--ox) var(--oy));
        }
      `}</style>

      {coords && (
        <div
          key={`iris-${coords.x}-${coords.y}`}
          aria-hidden="true"
          className="iris-overlay"
          onAnimationEnd={() => setCoords(null)}
          style={{
            '--ox': `${coords.x}px`,
            '--oy': `${coords.y}px`,
          } as React.CSSProperties}
        />
      )}
    </IrisContext.Provider>
  );
}
