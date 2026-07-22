'use client';

import { use } from 'react';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import PageClientStats from '@/components/analytics/PageClientStats';

export default function ClientAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { getClient } = useSupabaseClients();
  const client = getClient(id);

  if (!client) return null;
  return <PageClientStats profileId={client.profile_id ?? undefined} clientName={client.name} />;
}
