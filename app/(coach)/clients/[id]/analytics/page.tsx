'use client';

import { use } from 'react';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import PageStatsLive from '@/components/pages/coach/PageStatsLive';

export default function ClientAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { getClient } = useSupabaseClients();
  const client = getClient(id);

  if (!client) return null;
  return <PageStatsLive profileId={client.profile_id ?? undefined} />;
}
