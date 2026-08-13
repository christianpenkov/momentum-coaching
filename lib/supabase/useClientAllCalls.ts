import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Call } from '@/lib/supabase/types';

export function useClientAllCalls(client: { id: string; profile_id: string } | null) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    const supabase = createClient();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      // Calls Calendly : coach_id = profileId de l'élève
      const { data: integ } = await supabase.from('integrations')
        .select('connected_at').eq('profile_id', client.profile_id).eq('provider', 'calendly').maybeSingle();
      const connectedAt: string | null = integ?.connected_at ?? null;

      let calendlyQuery = supabase.from('calls').select('*')
        .eq('coach_id', client.profile_id)
        .eq('call_type', 'calendly')
        .neq('status', 'cancelled')
        .neq('status', 'canceled')
        .order('scheduled_at', { ascending: true });
      if (connectedAt) {
        const cutoff = new Date(new Date(connectedAt).getTime() - 24 * 3600_000).toISOString();
        calendlyQuery = calendlyQuery.gte('scheduled_at', cutoff);
      }
      const { data: calendlyCalls } = await calendlyQuery;

      // Calls Google Calendar : client_id = client.id
      const { data: googleCalls } = await supabase.from('calls').select('*')
        .eq('client_id', client.id)
        .neq('call_type', 'calendly')
        .neq('status', 'canceled')
        .neq('status', 'cancelled')
        .neq('status', 'declined')
        .neq('ignored', true)
        .order('scheduled_at', { ascending: true });

      if (cancelled) return;
      const all = [...(calendlyCalls || []), ...(googleCalls || [])];
      const seen = new Set<string>();
      setCalls(all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; }) as Call[]);
      setLoading(false);
    };
    load();

    return () => { cancelled = true; };
  }, [client?.id, client?.profile_id]);

  return { calls, loading };
}
