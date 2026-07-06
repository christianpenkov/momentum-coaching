'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { clearAppBadge } from '@/lib/pwaBadge';

let instanceCounter = 0;

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
      // Le badge natif de l'icône PWA n'était sinon jamais effacé pour ce type de
      // notification (call accepté/refusé, rapport en attente) — seul le compteur
      // de messages non lus le déclenchait. S'il n'y a plus rien en attente ici NON
      // PLUS, le badge peut enfin être effacé (voir aussi la branche élève ci-dessous).
      if (coachNotifs.length === 0) clearAppBadge();
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

    const allNotifs = [...rapportNotifs, ...callRequestNotifs, ...callCanceledNotifs];
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
