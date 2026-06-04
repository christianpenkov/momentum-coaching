'use client';

import TopBar from '@/components/layout/TopBar';
import Sidebar from '@/components/layout/Sidebar';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider, useUser } from '@/lib/UserContext';
import { usePushNotifications } from '@/lib/usePushNotifications';

function CoachLayoutInner({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  usePushNotifications(user?.id ?? null);
  return (
    <>
      <div className="app-shell">
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
  return (
    <UserProvider>
      <CoachLayoutInner>{children}</CoachLayoutInner>
    </UserProvider>
  );
}
