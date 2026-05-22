'use client';

import { createContext, useContext, useState, useCallback, useRef, ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface IrisState {
  x: number;
  y: number;
}

interface IrisContextValue {
  triggerIris: (destination: string, originX: number, originY: number) => void;
}

const IrisContext = createContext<IrisContextValue | null>(null);

export function useIris() {
  const ctx = useContext(IrisContext);
  if (!ctx) throw new Error('useIris must be used inside IrisProvider');
  return ctx;
}

export function IrisProvider({ children }: { children: ReactNode }) {
  // pending = overlay solidaire fermée (0px), attend que la destination soit chargée
  // open    = animation iris-open en cours
  const [phase, setPhase] = useState<'idle' | 'pending' | 'open'>('idle');
  const [coords, setCoords] = useState<IrisState | null>(null);
  const destinationRef = useRef<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const triggerIris = useCallback((destination: string, originX: number, originY: number) => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      router.push(destination);
      return;
    }
    destinationRef.current = destination;
    setCoords({ x: originX, y: originY });
    // Phase 1 : overlay opaque couvre tout, trou = 0px (rien visible)
    setPhase('pending');
    // Navigation : la destination charge sous l'overlay
    router.push(destination);
  }, [router]);

  // Quand le pathname change → la page de destination est rendue dans le DOM
  // On passe en phase "open" pour lancer l'animation
  useEffect(() => {
    if (phase === 'pending' && destinationRef.current && pathname === destinationRef.current) {
      // Un microtask pour laisser React peindre la destination une frame
      const raf = requestAnimationFrame(() => {
        setPhase('open');
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [pathname, phase]);

  return (
    <IrisContext.Provider value={{ triggerIris }}>
      {children}
      {(phase === 'pending' || phase === 'open') && coords && (
        <>
          <style>{`
            @keyframes iris-open {
              0%   { clip-path: circle(0px at var(--ox) var(--oy)); }
              100% { clip-path: circle(200vmax at var(--ox) var(--oy)); }
            }
          `}</style>
          <div
            aria-hidden="true"
            onAnimationEnd={() => { setPhase('idle'); setCoords(null); destinationRef.current = null; }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'var(--bg)',
              pointerEvents: 'none',
              willChange: 'clip-path',
              ['--ox' as any]: `${coords.x}px`,
              ['--oy' as any]: `${coords.y}px`,
              // En phase pending : trou = 0px, overlay couvre tout (pas d'animation)
              // En phase open    : animation iris-open s'enclenche
              clipPath: phase === 'pending' ? `circle(0px at ${coords.x}px ${coords.y}px)` : undefined,
              animation: phase === 'open' ? 'iris-open 700ms cubic-bezier(0.4, 0, 0.2, 1) forwards' : 'none',
            }}
          />
        </>
      )}
    </IrisContext.Provider>
  );
}
