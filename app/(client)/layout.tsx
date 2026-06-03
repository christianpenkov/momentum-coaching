'use client';

import { useEffect, useRef } from 'react';
import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import BottomNav from '@/components/layout/BottomNav';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider } from '@/lib/UserContext';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.innerWidth > 767) return;
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const vvh = vv!.height;
      const kbH = Math.max(0, window.innerHeight - vvh);
      const isKeyboardOpen = kbH > 60;

      // Hauteur du shell = hauteur visuelle réelle
      if (shellRef.current) {
        shellRef.current.style.height = `${vvh}px`;
      }

      // Ciblage direct .bottom-nav (contourne les wrappers React)
      const navEl = document.querySelector('.bottom-nav') as HTMLElement | null;
      if (navEl) {
        navEl.style.display = isKeyboardOpen ? 'none' : 'flex';
      }

      // Hack WebKit : empêche le décalage de Safari au focus
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        window.scrollTo(0, 0);
      }
    }

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return (
    <UserProvider>
      {/* Shell unique — desktop et mobile, jamais de remount */}
      <div ref={shellRef} className="app-shell-pwa">
        <TopBar />
        <div className="app-body-pwa">
          <SidebarClient />
          <main className="main-content">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        {/* div wrapper pour pouvoir cacher/afficher via ref sans remount */}
        <div ref={navRef} className="bottom-nav-wrapper">
          <BottomNav />
        </div>
      </div>
    </UserProvider>
  );
}
