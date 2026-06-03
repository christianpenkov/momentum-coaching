'use client';

import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import BottomNav from '@/components/layout/BottomNav';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider } from '@/lib/UserContext';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
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
