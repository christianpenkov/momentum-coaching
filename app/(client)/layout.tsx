'use client';

import { useEffect } from 'react';
import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import BottomNav from '@/components/layout/BottomNav';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider } from '@/lib/UserContext';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const vvh = vv!.height;
      const keyboardH = Math.max(0, window.innerHeight - vv!.height - vv!.offsetTop);
      document.documentElement.style.setProperty('--vvh', `${vvh}px`);
      document.documentElement.style.setProperty('--keyboard-h', `${keyboardH}px`);
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
