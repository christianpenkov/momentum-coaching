'use client';

import TopBar from '@/components/layout/TopBar';
import Sidebar from '@/components/layout/Sidebar';
import PageTransition from '@/components/layout/PageTransition';

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <Sidebar />
        <main className="main-content">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
