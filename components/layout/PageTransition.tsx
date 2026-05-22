'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [visible, setVisible] = useState(true);
  const prevPathname = useRef(pathname);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const irisPlayed = useRef(false);

  useEffect(() => {
    if (irisPlayed.current) return;
    const raw = sessionStorage.getItem('iris-origin');
    if (!raw) return;
    sessionStorage.removeItem('iris-origin');
    irisPlayed.current = true;

    let ox: number, oy: number;
    try { ({ x: ox, y: oy } = JSON.parse(raw)); } catch { return; }

    const el = wrapperRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const endRadius = Math.hypot(
      Math.max(ox, window.innerWidth - ox),
      Math.max(oy, window.innerHeight - oy),
    );

    el.animate(
      [
        { clipPath: `circle(0px at ${ox}px ${oy}px)` },
        { clipPath: `circle(${endRadius}px at ${ox}px ${oy}px)` },
      ],
      {
        duration: 800,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      }
    );
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
    <div
      ref={wrapperRef}
      style={{
        opacity: visible ? 1 : 0,
        transition: visible ? 'opacity 0.15s ease-out' : 'none',
        position: 'absolute',
        inset: 0,
        overflow: 'auto',
      }}
    >
      {displayChildren}
    </div>
  );
}
