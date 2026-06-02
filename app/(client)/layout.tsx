'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import SidebarClient from '@/components/layout/SidebarClient';
import PageTransition from '@/components/layout/PageTransition';
import { UserProvider } from '@/lib/UserContext';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,    // données fraîches 5min — pas de refetch si navigation
        gcTime: 30 * 60 * 1000,      // cache conservé 30min en mémoire
        retry: 1,
        refetchOnWindowFocus: false,  // pas de refetch au retour sur la fenêtre
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <div className="app-shell">
          <TopBar />
          <div className="app-body">
            <SidebarClient />
            <main className="main-content">
              <PageTransition>{children}</PageTransition>
            </main>
          </div>
        </div>
      </UserProvider>
    </QueryClientProvider>
  );
}
