'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export type NotifType = 'rapport_call' | 'call_request' | 'call_canceled' | 'call_accepted' | 'call_declined';

export interface AppNotif {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  callId?: string;
  dbId?: string;
  inviteeName?: string | null;
  scheduledAt?: string | null;
  duration?: string | null;
}

export function useNotifications(profileId: string | null, isClient: boolean) {
  const [notifs, setNotifs] = useState<AppNotif[]>([]);
  const [coachName, setCoachName] = useState<string | null>(null);

  // Charge le prénom du coach une seule fois (pour l'élève uniquement)
  useEffect(() => {
    if (!profileId || !isClient) return;
    const supabase = createClient();
    supabase.from('clients').select('coach_id').eq('profile_id', profileId).maybeSingle()
      .then(({ data }) => {
        if (!data?.coach_id) return;
        supabase.from('profiles').select('full_name').eq('id', data.coach_id).maybeSingle()
          .then(({ data: p }) => { if (p?.full_name) setCoachName(p.full_name.split(' ')[0]); });
      });
  }, [profileId, isClient]);

  const refresh = useCallback(async () => {
    if (!profileId) { setNotifs([]); return; }

    // ── Notifs coach (réponses élève) ──
    if (!isClient) {
      const supabase = createClient();
      const { data: coachRows } = await supabase
        .from('client_notifications')
        .select('id, type, payload, created_at, call_id')
        .in('type', ['call_accepted', 'call_declined'])
        .is('read_at', null);

      const coachNotifs: AppNotif[] = (coachRows ?? []).map(row => {
        const isAccepted = row.type === 'call_accepted';
        const topic = row.payload?.topic || 'Call coaching';
        const d = row.payload?.scheduled_at ? new Date(row.payload.scheduled_at) : null;
        const dateStr = d ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
        const timeStr = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
        const proposedSuffix = row.payload?.proposed_at ? ` — propose : ${row.payload.proposed_at}` : '';
        return {
          id: `coach_notif_${row.id}`,
          type: row.type as NotifType,
          title: isAccepted ? 'Call accepté ✓' : 'Call refusé',
          body: isAccepted
            ? `${topic} · ${dateStr} à ${timeStr}`
            : `${topic} · ${dateStr} à ${timeStr}${proposedSuffix}`,
          callId: row.call_id ?? undefined,
          scheduledAt: row.payload?.scheduled_at ?? null,
          dbId: row.id,
        };
      });

      setNotifs(coachNotifs);
      return;
    }
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

    // ── Annulations de call non lues (persistées en DB jusqu'au clic OK) ──
    const { data: canceledRows } = await supabase
      .from('client_notifications')
      .select('id, payload, created_at, call_id')
      .eq('type', 'call_canceled')
      .is('read_at', null);

    const callCanceledNotifs: AppNotif[] = (canceledRows ?? []).map(row => ({
      id: `call_canceled_${row.id}`,
      type: 'call_canceled' as NotifType,
      title: 'Call annulé',
      body: row.payload?.topic ? `${coachName || 'Ton coach'} a annulé : ${row.payload.topic}` : `${coachName || 'Ton coach'} a annulé ce call.`,
      callId: row.call_id ?? undefined,
      scheduledAt: row.payload?.scheduled_at ?? null,
      // on stocke le notif DB id pour pouvoir le marquer lu
      dbId: row.id,
    }));

    setNotifs([...rapportNotifs, ...callRequestNotifs, ...callCanceledNotifs]);
  }, [profileId, isClient, coachName]);

  useEffect(() => {
    if (!profileId) return;
    refresh();
    const interval = setInterval(refresh, 60_000);
    window.addEventListener('notifs-refresh', refresh);

    const supabase = createClient();

    // Realtime sur client_notifications (annulations, acceptations, refus)
    const channel = supabase
      .channel(`notifs-rt-${profileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'client_notifications',
          filter: `profile_id=eq.${profileId}`,
        },
        () => refresh()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'calls',
          ...(isClient ? {} : { filter: `coach_id=eq.${profileId}` }),
        },
        () => refresh()
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      window.removeEventListener('notifs-refresh', refresh);
      supabase.removeChannel(channel);
    };
  }, [profileId, isClient, refresh]);

  return { notifs, refresh };
}
