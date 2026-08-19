'use client';

import { useRef, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import BottomNav from '@/components/layout/BottomNav';
import ClientMoreSheet from '@/components/layout/ClientMoreSheet';
import PageTransition from '@/components/layout/PageTransition';
import SplashHold from '@/components/ui/SplashHold';
import PullToRefresh from '@/components/ui/PullToRefresh';
import { UserProvider, useUser } from '@/lib/UserContext';
import { ClientSelfProvider, useClientSelf } from '@/lib/ClientSelfContext';
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
  const { user, loading: userLoading } = useUser();
  // Les donnees de la page, pas seulement la session : sans ca l'ecran de
  // lancement partait des la session resolue et laissait apparaitre le loader
  // de la page pendant que ses donnees chargeaient encore.
  const { loading: dataLoading, refetch } = useClientSelf();
  usePushNotifications(user?.id ?? null);
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <OnboardingWizardProvider autoOpen={user?.onboardingStep === 'not_started'}>
      {/* Monté ici et non dans la page : le layout survit aux navigations, donc
          l'overlay peut jouer son fondu de sortie au lieu d'être démonté d'un
          coup avec la page qui chargeait. Branché sur `loading` du contexte
          (et non sur la présence de `user`) : c'est le signal exact de "session
          résolue", il passe à false même quand il n'y a pas de session. */}
      <SplashHold show={userLoading || dataLoading} owner />
      <div ref={shellRef} className="app-shell-pwa">
        <OrientationLockOverlay />
        <PushPermissionGate userId={user?.id ?? null} />
        <TopBar />
        <div className="app-body-pwa">
          <SidebarClient />
          <main className="main-content">
            {/* Geste attendu par reflexe sur mobile : la seule facon de recharger
                etait de fermer et rouvrir l'app. */}
            <PullToRefresh onRefresh={refetch} />
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
      <ClientSelfProvider>
        <GlobalPresenceClientProvider>
          <ClientLayoutInner shellRef={shellRef} navRef={navRef}>{children}</ClientLayoutInner>
        </GlobalPresenceClientProvider>
      </ClientSelfProvider>
    </UserProvider>
  );
}
