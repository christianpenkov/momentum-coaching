'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { clearAppBadge } from '@/lib/pwaBadge';
import { getPendingSessionRapports } from '@/lib/sessionRapport';
import type { Call } from '@/lib/supabase/types';

let instanceCounter = 0;

export type NotifType = 'rapport_call' | 'session_rapport' | 'call_request' | 'call_canceled' | 'call_rescheduled' | 'call_accepted' | 'call_declined';

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
  const coachNameRef = useRef<string | null>(null);
  const instanceId = useRef(`${++instanceCounter}`);

  // Charge le prénom du coach une seule fois (pour l'élève uniquement)
  useEffect(() => {
    if (!profileId || !isClient) return;
    const supabase = createClient();
    supabase.from('clients').select('coach_id').eq('profile_id', profileId).maybeSingle()
      .then(({ data }) => {
        if (!data?.coach_id) return;
        supabase.from('profiles').select('full_name').eq('id', data.coach_id).maybeSingle()
          .then(({ data: p }) => { if (p?.full_name) coachNameRef.current = p.full_name.split(' ')[0]; });
      });
  }, [profileId, isClient]);

  const refresh = useCallback(async () => {
    if (!profileId) { setNotifs([]); return; }

    // ── Notifs coach (réponses élève + rapports de session en attente) ──
    if (!isClient) {
      const supabase = createClient();
      const { data: coachRows } = await supabase
        .from('client_notifications')
        .select('id, type, payload, created_at, call_id')
        .in('type', ['call_accepted', 'call_declined'])
        .is('read_at', null);

      // Nom de l'élève : pas stocké dans le payload, résolu via un join call_id → clients.name
      // (même pattern que pour session_rapport ci-dessous).
      const coachCallIds = [...new Set((coachRows ?? []).map(r => r.call_id).filter((id): id is string => !!id))];
      const coachClientNameByCallId: Record<string, string> = {};
      if (coachCallIds.length > 0) {
        const { data: callsRows } = await supabase.from('calls').select('id, client_id').in('id', coachCallIds);
        const clientIds = [...new Set((callsRows ?? []).map(c => c.client_id).filter((id): id is string => !!id))];
        if (clientIds.length > 0) {
          const { data: clientsRows } = await supabase.from('clients').select('id, name').in('id', clientIds);
          const nameByClientId: Record<string, string> = {};
          (clientsRows ?? []).forEach(c => { nameByClientId[c.id] = c.name; });
          (callsRows ?? []).forEach(c => {
            if (c.client_id && nameByClientId[c.client_id]) coachClientNameByCallId[c.id] = nameByClientId[c.client_id];
          });
        }
      }

      const coachNotifs: AppNotif[] = (coachRows ?? []).map(row => {
        const isAccepted = row.type === 'call_accepted';
        const topic = row.payload?.topic || 'Call coaching';
        const d = row.payload?.scheduled_at ? new Date(row.payload.scheduled_at) : null;
        const dateStr = d ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
        const timeStr = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
        const proposedSuffix = row.payload?.proposed_at ? ` — propose : ${row.payload.proposed_at}` : '';
        const clientName = row.call_id ? coachClientNameByCallId[row.call_id] : undefined;
        const nameSuffix = clientName ? ` — ${clientName}` : '';
        return {
          id: `coach_notif_${row.id}`,
          type: row.type as NotifType,
          title: isAccepted ? 'Call accepté ✓' : 'Call refusé',
          body: isAccepted
            ? `${topic} · ${dateStr} à ${timeStr}${nameSuffix}`
            : `${topic} · ${dateStr} à ${timeStr}${proposedSuffix}${nameSuffix}`,
          callId: row.call_id ?? undefined,
          inviteeName: clientName ?? null,
          scheduledAt: row.payload?.scheduled_at ?? null,
          dbId: row.id,
        };
      });

      // ── Rapports de session Google Meet en attente ──
      const { data: googleCalls } = await supabase
        .from('calls')
        .select('id, client_id, scheduled_at, duration, call_type, calendly_event_uuid, status, session_completed, session_no_show')
        .eq('coach_id', profileId)
        .eq('call_type', 'google')
        .is('calendly_event_uuid', null)
        .eq('status', 'active');

      const pendingSessionCalls = getPendingSessionRapports((googleCalls ?? []) as Call[]);
      let sessionRapportNotifs: AppNotif[] = [];
      if (pendingSessionCalls.length > 0) {
        const clientIds = [...new Set(pendingSessionCalls.map(c => c.client_id).filter((id): id is string => !!id))];
        const { data: clientsRows } = await supabase.from('clients').select('id, name').in('id', clientIds);
        const nameById: Record<string, string> = {};
        (clientsRows ?? []).forEach(c => { nameById[c.id] = c.name; });

        sessionRapportNotifs = pendingSessionCalls.map(c => ({
          id: `session_rapport_${c.id}`,
          type: 'session_rapport' as NotifType,
          title: 'Rapport de session',
          body: `Comment s'est passée ta session${c.client_id && nameById[c.client_id] ? ` avec ${nameById[c.client_id]}` : ''} ?`,
          callId: c.id,
          inviteeName: c.client_id ? (nameById[c.client_id] ?? null) : null,
          scheduledAt: c.scheduled_at,
          duration: c.duration,
        }));
      }

      const allCoachNotifs = [...coachNotifs, ...sessionRapportNotifs];
      setNotifs(allCoachNotifs);
      // Le badge natif de l'icône PWA n'était sinon jamais effacé pour ce type de
      // notification (call accepté/refusé, rapport en attente) — seul le compteur
      // de messages non lus le déclenchait. S'il n'y a plus rien en attente ici NON
      // PLUS, le badge peut enfin être effacé (voir aussi la branche élève ci-dessous).
      if (allCoachNotifs.length === 0) clearAppBadge();
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
      body: row.payload?.topic ? `${coachNameRef.current || 'Ton coach'} a annulé : ${row.payload.topic}` : `${coachNameRef.current || 'Ton coach'} a annulé ce call.`,
      callId: row.call_id ?? undefined,
      scheduledAt: row.payload?.scheduled_at ?? null,
      // on stocke le notif DB id pour pouvoir le marquer lu
      dbId: row.id,
    }));

    // ── Calls reportés non lus (persistées en DB jusqu'au clic OK) ──
    const { data: rescheduledRows } = await supabase
      .from('client_notifications')
      .select('id, payload, created_at, call_id')
      .eq('type', 'call_rescheduled')
      .is('read_at', null);

    const callRescheduledNotifs: AppNotif[] = (rescheduledRows ?? []).map(row => {
      const d = row.payload?.scheduled_at ? new Date(row.payload.scheduled_at) : null;
      const dateStr = d ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
      const timeStr = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      return {
        id: `call_rescheduled_${row.id}`,
        type: 'call_rescheduled' as NotifType,
        title: `Call déplacé — ${coachNameRef.current || 'ton coach'}`,
        body: d ? `Nouveau créneau : ${dateStr} à ${timeStr}` : (row.payload?.topic ?? 'Nouveau créneau proposé'),
        callId: row.call_id ?? undefined,
        scheduledAt: row.payload?.scheduled_at ?? null,
        dbId: row.id,
      };
    });

    const allNotifs = [...rapportNotifs, ...callRequestNotifs, ...callCanceledNotifs, ...callRescheduledNotifs];
    setNotifs(allNotifs);
    if (allNotifs.length === 0) clearAppBadge();
  }, [profileId, isClient]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!profileId) return;
    refreshRef.current();
    const interval = setInterval(() => refreshRef.current(), 60_000);
    const handler = () => refreshRef.current();
    window.addEventListener('notifs-refresh', handler);

    const supabase = createClient();
    const channel = supabase
      .channel(`notifs-rt-${profileId}-${instanceId.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_notifications', filter: `profile_id=eq.${profileId}` }, () => refreshRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', ...(isClient ? {} : { filter: `coach_id=eq.${profileId}` }) }, () => refreshRef.current())
      .subscribe();

    return () => {
      clearInterval(interval);
      window.removeEventListener('notifs-refresh', handler);
      supabase.removeChannel(channel);
    };
  }, [profileId, isClient]);

  return { notifs, refresh };
}
