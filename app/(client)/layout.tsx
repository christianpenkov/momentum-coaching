'use client';

import { useEffect, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import BottomNav from '@/components/layout/BottomNav';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider } from '@/lib/UserContext';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [viewportHeight, setViewportHeight] = useState<string>('100%');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mobile = window.innerWidth <= 767;
    setIsMobile(mobile);
    if (!mobile) return;

    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const vvh = vv!.height;
      const kbH = Math.max(0, window.innerHeight - vvh);
      setViewportHeight(`${vvh}px`);
      setKeyboardOpen(kbH > 60);

      // Hack WebKit : forcer le scroll à 0,0 pour contrer le décalage Safari au focus
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

  // Desktop : layout classique
  if (!isMobile) {
    return (
      <UserProvider>
        <div className="app-shell">
          <TopBar />
          <div className="app-body">
            <SidebarClient />
            <main className="main-content">
              <PageTransition>{children}</PageTransition>
            </main>
          </div>
          <BottomNav />
        </div>
      </UserProvider>
    );
  }

  // Mobile PWA : shell flex-box avec hauteur = visualViewport.height
  return (
    <UserProvider>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100vw',
          height: viewportHeight,
          position: 'absolute',
          top: 0,
          left: 0,
          overflow: 'hidden',
          boxSizing: 'border-box',
          background: 'var(--bg)',
        }}
      >
        {/* TopBar — hauteur fixe 52px */}
        <TopBar />

        {/* Zone centrale — prend tout l'espace restant */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          <main
            className="main-content"
            style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}
          >
            <PageTransition>{children}</PageTransition>
          </main>
        </div>

        {/* BottomNav — disparaît quand le clavier est ouvert */}
        {!keyboardOpen && <BottomNav />}
      </div>
    </UserProvider>
  );
}
