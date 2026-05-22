'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [visible, setVisible] = useState(true);
  const prevPathname = useRef(pathname);
  const overlayRef = useRef<HTMLDivElement>(null);
  const irisPlayed = useRef(false);

  useEffect(() => {
    if (irisPlayed.current) return;
    const raw = sessionStorage.getItem('iris-origin');
    if (!raw) return;
    sessionStorage.removeItem('iris-origin');
    irisPlayed.current = true;

    let ox: number, oy: number;
    try { ({ x: ox, y: oy } = JSON.parse(raw)); } catch { return; }

    const el = overlayRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const endRadius = Math.hypot(
      Math.max(ox, window.innerWidth - ox),
      Math.max(oy, window.innerHeight - oy),
    );

    el.style.display = 'block';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // L'overlay utilise un mask radial : le trou commence à 0px et grandit
        // Le mask définit ce qui EST visible de l'overlay
        // circle(0px) = overlay couvre tout (aucun trou)
        // circle(endRadius) = overlay entièrement transparent (trou couvre tout)
        el.animate(
          [
            {
              // Début : overlay plein, trou = 0px au centre du bouton
              WebkitMaskImage: `radial-gradient(circle 0px at ${ox}px ${oy}px, transparent 100%, black 100%)`,
              maskImage: `radial-gradient(circle 0px at ${ox}px ${oy}px, transparent 100%, black 100%)`,
            },
            {
              // Fin : trou couvre tout l'écran, overlay invisible
              WebkitMaskImage: `radial-gradient(circle ${endRadius}px at ${ox}px ${oy}px, transparent 100%, black 100%)`,
              maskImage: `radial-gradient(circle ${endRadius}px at ${ox}px ${oy}px, transparent 100%, black 100%)`,
            },
          ],
          {
            duration: 800,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards',
          }
        ).onfinish = () => { el.style.display = 'none'; };
      });
    });
  }, []);

  useEffect(() => {
    if (pathname !== prevPathname.current) {
      prevPathname.current = pathname;
      setVisible(false);
      const t = setTimeout(() => {
        setDisplayChildren(children);
        setVisible(true);
      }, 80);
      return () => clearTimeout(t);
    } else {
      setDisplayChildren(children);
    }
  }, [pathname, children]);

  return (
    <>
      <div
        ref={overlayRef}
        aria-hidden="true"
        style={{
          display: 'none',
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: '#1a1815',
          pointerEvents: 'none',
        }}
      />
      <div style={{ opacity: visible ? 1 : 0, transition: visible ? 'opacity 0.15s ease-out' : 'none', display: 'contents' }}>
        {displayChildren}
      </div>
    </>
  );
}
