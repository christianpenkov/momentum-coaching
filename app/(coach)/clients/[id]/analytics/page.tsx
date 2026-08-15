'use client';

import { use } from 'react';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import PageClientStats from '@/components/analytics/PageClientStats';
import DesktopOnly from '@/components/ui/DesktopOnly';

export default function ClientAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { getClient } = useSupabaseClients();
  const client = getClient(id);

  if (!client) return null;
  return <DesktopOnly><PageClientStats profileId={client.profile_id ?? undefined} clientName={client.name} /></DesktopOnly>;
}
