'use client';

import { useRef, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import Sidebar from '@/components/layout/Sidebar';
import BottomNavCoach from '@/components/layout/BottomNavCoach';
import CoachMoreSheet from '@/components/layout/CoachMoreSheet';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider, useUser } from '@/lib/UserContext';
import { GlobalPresenceCoachProvider } from '@/lib/GlobalPresenceContext';
import { usePushNotifications } from '@/lib/usePushNotifications';
import { useViewportShellHeight } from '@/lib/useViewportShellHeight';
import PushPermissionGate from '@/components/PushPermissionGate';
import OrientationLockOverlay from '@/components/OrientationLockOverlay';

function CoachLayoutInner({ children, shellRef, navRef }: {
  children: React.ReactNode;
  shellRef: React.RefObject<HTMLDivElement | null>;
  navRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { user } = useUser();
  usePushNotifications(user?.id ?? null);
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div ref={shellRef} className="app-shell-pwa">
      <OrientationLockOverlay />
      <PushPermissionGate userId={user?.id ?? null} />
      <TopBar />
      <div className="app-body-pwa">
        <Sidebar />
        <main className="main-content">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <div ref={navRef} className="bottom-nav-wrapper">
        <BottomNavCoach onMoreClick={() => setMoreOpen(true)} />
      </div>
      {moreOpen && <CoachMoreSheet onClose={() => setMoreOpen(false)} />}
    </div>
  );
}

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  useViewportShellHeight(shellRef);

  return (
    <UserProvider>
      <GlobalPresenceCoachProvider>
        <CoachLayoutInner shellRef={shellRef} navRef={navRef}>{children}</CoachLayoutInner>
      </GlobalPresenceCoachProvider>
    </UserProvider>
  );
}
