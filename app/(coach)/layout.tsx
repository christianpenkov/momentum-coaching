'use client';

import TopBar from '@/components/layout/TopBar';
import Sidebar from '@/components/layout/Sidebar';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider } from '@/lib/UserContext';

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <div className="app-shell">
        <TopBar />
        <div className="app-body">
          <Sidebar />
          <main className="main-content">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
    </UserProvider>
  );
}
