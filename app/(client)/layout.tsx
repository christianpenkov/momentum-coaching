'use client';

import { useEffect, useRef } from 'react';
import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import BottomNav from '@/components/layout/BottomNav';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider, useUser } from '@/lib/UserContext';
import { GlobalPresenceClient } from '@/components/layout/GlobalPresence';
import { usePushNotifications } from '@/lib/usePushNotifications';

function ClientLayoutInner({ children, shellRef, navRef }: {
  children: React.ReactNode;
  shellRef: React.RefObject<HTMLDivElement | null>;
  navRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { user } = useUser();
  usePushNotifications(user?.id ?? null);
  return (
    <>
      <GlobalPresenceClient />
      <div ref={shellRef} className="app-shell-pwa">
        <TopBar />
        <div className="app-body-pwa">
          <SidebarClient />
          <main className="main-content">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <div ref={navRef} className="bottom-nav-wrapper">
          <BottomNav />
        </div>
      </div>
    </>
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.innerWidth > 767) return;
    const vv = window.visualViewport;
    if (!vv) return;

    // Hauteur de référence sans clavier (screen.height est stable sur iOS, innerHeight non)
    const baseH = window.screen.height;

    function update() {
      const vvh = vv!.height;
      const kbH = Math.max(0, baseH - vvh);
      const isKeyboardOpen = kbH > 100;

      // Hauteur du shell = hauteur visuelle réelle
      if (shellRef.current) {
        shellRef.current.style.height = `${vvh}px`;
      }

      // Classe CSS sur body — plus propre et sans race condition avec l'animation iOS
      document.body.classList.toggle('keyboard-open', isKeyboardOpen);

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
      <ClientLayoutInner shellRef={shellRef} navRef={navRef}>{children}</ClientLayoutInner>
    </UserProvider>
  );
}
