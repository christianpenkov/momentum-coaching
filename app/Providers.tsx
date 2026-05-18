'use client';

import { ClientsProvider } from '@/lib/ClientsContext';
import { SupabaseClientsProvider } from '@/lib/SupabaseClientsContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SupabaseClientsProvider>
      <ClientsProvider>{children}</ClientsProvider>
    </SupabaseClientsProvider>
  );
}
