'use client';

import { useRef, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import BottomNav from '@/components/layout/BottomNav';
import ClientMoreSheet from '@/components/layout/ClientMoreSheet';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider, useUser } from '@/lib/UserContext';
import { GlobalPresenceClientProvider } from '@/lib/GlobalPresenceContext';
import { usePushNotifications } from '@/lib/usePushNotifications';
import { useViewportShellHeight } from '@/lib/useViewportShellHeight';
import PushPermissionGate from '@/components/PushPermissionGate';
import OrientationLockOverlay from '@/components/OrientationLockOverlay';
import { OnboardingWizardProvider } from '@/components/onboarding/OnboardingWizardContext';
import ClientOnboardingWizard from '@/components/onboarding/ClientOnboardingWizard';

function ClientLayoutInner({ children, shellRef, navRef }: {
  children: React.ReactNode;
  shellRef: React.RefObject<HTMLDivElement | null>;
  navRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { user } = useUser();
  usePushNotifications(user?.id ?? null);
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <OnboardingWizardProvider autoOpen={user?.onboardingStep === 'not_started'}>
      <div ref={shellRef} className="app-shell-pwa">
        <OrientationLockOverlay />
        <PushPermissionGate userId={user?.id ?? null} />
        <TopBar />
        <div className="app-body-pwa">
          <SidebarClient />
          <main className="main-content">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <div ref={navRef} className="bottom-nav-wrapper">
          <BottomNav onMoreClick={() => setMoreOpen(true)} />
        </div>
        {moreOpen && <ClientMoreSheet onClose={() => setMoreOpen(false)} />}
      </div>
      <ClientOnboardingWizard />
    </OnboardingWizardProvider>
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
