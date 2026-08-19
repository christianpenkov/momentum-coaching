'use client';

import { useRef, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import Sidebar from '@/components/layout/Sidebar';
import BottomNavCoach from '@/components/layout/BottomNavCoach';
import CoachMoreSheet from '@/components/layout/CoachMoreSheet';
import PageTransition from '@/components/layout/PageTransition';
import SplashHold from '@/components/ui/SplashHold';
import { UserProvider, useUser } from '@/lib/UserContext';
import { SupabaseClientsProvider, useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { GlobalPresenceCoachProvider } from '@/lib/GlobalPresenceContext';
import { usePushNotifications } from '@/lib/usePushNotifications';
import { useViewportShellHeight } from '@/lib/useViewportShellHeight';
import PushPermissionGate from '@/components/PushPermissionGate';
import OrientationLockOverlay from '@/components/OrientationLockOverlay';
import { OnboardingWizardProvider } from '@/components/onboarding/OnboardingWizardContext';
import CoachOnboardingWizard from '@/components/onboarding/CoachOnboardingWizard';

function CoachLayoutInner({ children, shellRef, navRef }: {
  children: React.ReactNode;
  shellRef: React.RefObject<HTMLDivElement | null>;
  navRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { user, loading: userLoading } = useUser();
  // Les donnees de la page, pas seulement la session : sans ca l'ecran de
  // lancement partait des la session resolue et laissait apparaitre le loader
  // de la page pendant que ses donnees chargeaient encore.
  const { loading: dataLoading } = useSupabaseClients();
  usePushNotifications(user?.id ?? null);
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <OnboardingWizardProvider autoOpen={user?.onboardingStep === 'not_started'}>
      {/* Voir (client)/layout.tsx : prolonge l'ecran de demarrage jusqu'a ce
          que la session soit resolue, pour eviter le loader qui clignote. */}
      <SplashHold show={userLoading || dataLoading} owner />
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
      <CoachOnboardingWizard />
    </OnboardingWizardProvider>
  );
}

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  useViewportShellHeight(shellRef);

  return (
    <UserProvider>
      <SupabaseClientsProvider>
        <GlobalPresenceCoachProvider>
          <CoachLayoutInner shellRef={shellRef} navRef={navRef}>{children}</CoachLayoutInner>
        </GlobalPresenceCoachProvider>
      </SupabaseClientsProvider>
    </UserProvider>
  );
}
