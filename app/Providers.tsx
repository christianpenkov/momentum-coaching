'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientsProvider } from '@/lib/ClientsContext';
import { SupabaseClientsProvider } from '@/lib/SupabaseClientsContext';
import { IrisProvider } from '@/lib/IrisContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <IrisProvider>
        <SupabaseClientsProvider>
          <ClientsProvider>{children}</ClientsProvider>
        </SupabaseClientsProvider>
      </IrisProvider>
    </QueryClientProvider>
  );
}
