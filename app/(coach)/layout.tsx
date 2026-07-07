'use client';

import { useRef } from 'react';
import TopBar from '@/components/layout/TopBar';
import Sidebar from '@/components/layout/Sidebar';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider, useUser } from '@/lib/UserContext';
import { GlobalPresenceCoachProvider } from '@/lib/GlobalPresenceContext';
import { usePushNotifications } from '@/lib/usePushNotifications';
import { useViewportShellHeight } from '@/lib/useViewportShellHeight';
import PushPermissionGate from '@/components/PushPermissionGate';

function CoachLayoutInner({ children, shellRef }: { children: React.ReactNode; shellRef: React.RefObject<HTMLDivElement | null> }) {
  const { user } = useUser();
  usePushNotifications(user?.id ?? null);
  return (
    <div ref={shellRef} className="app-shell">
      <PushPermissionGate userId={user?.id ?? null} />
      <TopBar />
      <div className="app-body">
        <Sidebar />
        <main className="main-content">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  useViewportShellHeight(shellRef);

  return (
    <UserProvider>
      <GlobalPresenceCoachProvider>
        <CoachLayoutInner shellRef={shellRef}>{children}</CoachLayoutInner>
      </GlobalPresenceCoachProvider>
    </UserProvider>
  );
}
