'use client';

import { useRef } from 'react';
import TopBar from '@/components/layout/TopBar';
import Sidebar from '@/components/layout/Sidebar';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider, useUser } from '@/lib/UserContext';
import { GlobalPresenceCoach } from '@/components/layout/GlobalPresence';
import { usePushNotifications } from '@/lib/usePushNotifications';
import { useViewportShellHeight } from '@/lib/useViewportShellHeight';

function CoachLayoutInner({ children, shellRef }: { children: React.ReactNode; shellRef: React.RefObject<HTMLDivElement | null> }) {
  const { user } = useUser();
  usePushNotifications(user?.id ?? null);
  return (
    <>
      <GlobalPresenceCoach />
      <div ref={shellRef} className="app-shell">
        <TopBar />
        <div className="app-body">
          <Sidebar />
          <main className="main-content">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
    </>
  );
}

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  useViewportShellHeight(shellRef);

  return (
    <UserProvider>
      <CoachLayoutInner shellRef={shellRef}>{children}</CoachLayoutInner>
    </UserProvider>
  );
}
