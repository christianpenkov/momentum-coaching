'use client';

import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import PageTransition from '@/components/layout/PageTransition';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <SidebarClient />
        <main className="main-content">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
