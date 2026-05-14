'use client';

import { ClientsProvider } from '@/lib/ClientsContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <ClientsProvider>{children}</ClientsProvider>;
}
