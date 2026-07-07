'use client';

import { useRef } from 'react';
import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import BottomNav from '@/components/layout/BottomNav';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider, useUser } from '@/lib/UserContext';
import { GlobalPresenceClientProvider } from '@/lib/GlobalPresenceContext';
import { usePushNotifications } from '@/lib/usePushNotifications';
import { useViewportShellHeight } from '@/lib/useViewportShellHeight';
import PushPermissionGate from '@/components/PushPermissionGate';

function ClientLayoutInner({ children, shellRef, navRef }: {
  children: React.ReactNode;
  shellRef: React.RefObject<HTMLDivElement | null>;
  navRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { user } = useUser();
  usePushNotifications(user?.id ?? null);
  return (
    <div ref={shellRef} className="app-shell-pwa">
      <PushPermissionGate userId={user?.id ?? null} />
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
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useViewportShellHeight(shellRef);

  return (
    <UserProvider>
      <GlobalPresenceClientProvider>
        <ClientLayoutInner shellRef={shellRef} navRef={navRef}>{children}</ClientLayoutInner>
      </GlobalPresenceClientProvider>
    </UserProvider>
  );
}
