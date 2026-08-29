'use client';

import { useRef, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import BottomNav from '@/components/layout/BottomNav';
import ClientMoreSheet from '@/components/layout/ClientMoreSheet';
import PageTransition from '@/components/layout/PageTransition';
import SplashHold from '@/components/ui/SplashHold';
import OfflineBanner from '@/components/ui/OfflineBanner';
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
  const { clientRow, loading: dataLoading } = useClientSelf();
  usePushNotifications(user?.id ?? null);
  const [moreOpen, setMoreOpen] = useState(false);

  // Verrou d'accès : tant que les 7 intégrations obligatoires ne sont pas connectées,
  // l'élève ne voit que l'écran de connexion.
  //
  // La condition est `integrations_ready_at IS NULL`, et rien d'autre : c'est
  // exactement la sémantique de la colonne, posée par le trigger
  // `recalc_integrations_ready_at` quand les 7 providers sont là, et jamais
  // réécrite ensuite. Aucune liste de providers recopiée ici — elle vit dans le
  // trigger, une seule fois, et ne peut donc pas diverger.
  //
  // Pourquoi ce verrou existe : cette date est la borne de départ de TOUTES les
  // stats (docs/perimetre-stats-referentiel.md, règle 1). Sans elle, un élève
  // pouvait accumuler des calls avant que la collecte de clics Short.io ne
  // démarre — et l'entonnoir divisait alors des calls par des clics qui
  // n'existaient pas encore. Le verrou fait coïncider les deux dates par
  // construction.
  //
  // On attend que le contexte ait répondu (`dataLoading`) avant de verrouiller :
  // sinon l'écran de connexion clignote une fraction de seconde à chaque
  // chargement, pour tout le monde.
  const accesVerrouille = !dataLoading && !!clientRow && !clientRow.integrations_ready_at;

  return (
    <OnboardingWizardProvider
      autoOpen={user?.onboardingStep === 'not_started'}
      locked={accesVerrouille}
    >
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
        {/* Previent des que le reseau tombe : sans ca les actions echouaient
            en silence (voir lib/useOnline). */}
        <OfflineBanner />
        <div className="app-body-pwa">
          <SidebarClient />
          <main className="main-content">
            {/* Pas de pull-to-refresh : le geste interceptait le touchmove et
                bloquait le retour vers le haut dans les zones qui defilent
                (messagerie, pipeline). Les boutons Rafraichir des ecrans
                couvrent le besoin. */}
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
