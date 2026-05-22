'use client';

import { ClientsProvider } from '@/lib/ClientsContext';
import { SupabaseClientsProvider } from '@/lib/SupabaseClientsContext';
import { IrisProvider } from '@/lib/IrisContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <IrisProvider>
      <SupabaseClientsProvider>
        <ClientsProvider>{children}</ClientsProvider>
      </SupabaseClientsProvider>
    </IrisProvider>
  );
}
