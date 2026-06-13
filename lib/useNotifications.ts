'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export type NotifType = 'rapport_call';

export interface AppNotif {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  // données spécifiques selon le type
  callId?: string;
  inviteeName?: string | null;
  scheduledAt?: string | null;
  duration?: string | null;
}

export function useNotifications(profileId: string | null, isClient: boolean) {
  const [notifs, setNotifs] = useState<AppNotif[]>([]);

  const refresh = useCallback(async () => {
    if (!profileId || !isClient) { setNotifs([]); return; }
    const supabase = createClient();
    const now = new Date().toISOString();

    // ── Date de connexion Calendly — cutoff pour ignorer les vieux calls ──
    const { data: integ } = await supabase
      .from('integrations')
      .select('connected_at')
      .eq('profile_id', profileId)
      .eq('provider', 'calendly')
      .maybeSingle();
    const calendlyConnectedAt: string | null = integ?.connected_at ?? null;

    // ── Rapports de call en attente ──
    let callsQuery = supabase
      .from('calls')
      .select('id, invitee_name, scheduled_at, duration, outcome')
      .eq('coach_id', profileId)
      .eq('status', 'active')
      .is('outcome', null)
      .neq('ignored', true)
      .not('calendly_event_uuid', 'is', null)
      .lt('scheduled_at', now);

    if (calendlyConnectedAt) {
      callsQuery = callsQuery.gte('scheduled_at', calendlyConnectedAt);
    }

    const { data: calls } = await callsQuery;

    const rapportNotifs: AppNotif[] = (calls || [])
      .filter(c => c.outcome === null)
      .map(c => ({
        id: `rapport_${c.id}`,
        type: 'rapport_call' as NotifType,
        title: 'Rapport de call',
        body: `Comment s'est passé ton appel${c.invitee_name ? ` avec ${c.invitee_name}` : ''} ?`,
        callId: c.id,
        inviteeName: c.invitee_name,
        scheduledAt: c.scheduled_at,
        duration: c.duration,
      }));

    setNotifs(rapportNotifs);
  }, [profileId, isClient]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    window.addEventListener('notifs-refresh', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('notifs-refresh', refresh);
    };
  }, [refresh]);

  return { notifs, refresh };
}
