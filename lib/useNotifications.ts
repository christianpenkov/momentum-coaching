'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export type NotifType = 'rapport_call' | 'call_request';

export interface AppNotif {
  id: string;
  type: NotifType;
  title: string;
  body: string;
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
      const cutoff = new Date(new Date(calendlyConnectedAt).getTime() - 24 * 3600_000).toISOString();
      callsQuery = callsQuery.gte('scheduled_at', cutoff);
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

    // ── Calls coaching en attente d'acceptation (créés par le coach, pas Calendly) ──
    const { data: pendingCalls } = await supabase
      .from('calls')
      .select('id, topic, scheduled_at, duration')
      .eq('status', 'pending_acceptance')
      .is('calendly_event_uuid', null);

    const callRequestNotifs: AppNotif[] = (pendingCalls ?? []).map(c => ({
      id: `call_request_${c.id}`,
      type: 'call_request' as NotifType,
      title: 'Demande de call coaching',
      body: (c.topic && c.topic !== 'Call coaching') ? c.topic : 'En attente de ta réponse',
      callId: c.id,
      scheduledAt: c.scheduled_at,
      duration: c.duration,
    }));

    setNotifs([...rapportNotifs, ...callRequestNotifs]);
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
