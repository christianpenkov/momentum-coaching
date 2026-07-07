'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/UserContext';

/**
 * Présence "plateforme entière" — en ligne dès que l'utilisateur a un onglet/l'app ouvert sur
 * N'IMPORTE quelle page, pas seulement la messagerie. Un seul canal par élève
 * (`global-presence-${clientId}`), monté une fois dans le layout (coach ou client) et
 * consommé partout via ce contexte. Même pattern robuste que la présence de conversation
 * (voir docs/architecture-messagerie.md §4) : heartbeat + TTL + backoff + worker — on ne fait
 * jamais confiance au seul état join/leave du canal.
 */

const HEARTBEAT_MS = 60_000;
const STALE_TTL_MS = 150_000;
const STALE_CHECK_MS = 10_000;

type PresenceEntry = { user_id: string; role: 'coach' | 'client'; online_at: string };

// Côté élève : un seul peer (le coach) → simple booléen.
interface ClientPresenceValue { coachOnline: boolean }
const ClientPresenceContext = createContext<ClientPresenceValue>({ coachOnline: false });

// Côté coach : un peer par élève → Map clientId -> en ligne.
interface CoachPresenceValue { isClientOnline: (clientId: string) => boolean }
const CoachPresenceContext = createContext<CoachPresenceValue>({ isClientOnline: () => false });

export function GlobalPresenceClientProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [clientId, setClientId] = useState<string | null>(null);
  const [coachOnline, setCoachOnline] = useState(false);
  const supabase = useRef(createClient({ worker: true, heartbeatIntervalMs: 15_000 })).current;
  const isSubscribedRef = useRef(false);
  const lastCoachSeenRef = useRef<number | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('clients').select('id').eq('profile_id', user.id).single()
      .then(({ data }) => { if (data) setClientId(data.id); });
  }, [user, supabase]);

  useEffect(() => {
    const onOnline = () => { retryAttemptRef.current = 0; setRetryKey(k => k + 1); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  useEffect(() => {
    if (!user || !clientId) return;

    const ch = supabase.channel(`global-presence-${clientId}`, {
      config: { presence: { key: user.id } },
    });
    const track = () => ch.track({ user_id: user.id, role: 'client', online_at: new Date().toISOString() } satisfies PresenceEntry);

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PresenceEntry>();
      const coachEntry = Object.entries(state).find(([key, entries]) =>
        key !== user.id && entries.some(e => e.role === 'coach'));
      if (coachEntry) {
        const entry = coachEntry[1].find(e => e.role === 'coach');
        lastCoachSeenRef.current = entry?.online_at ? new Date(entry.online_at).getTime() : Date.now();
        setCoachOnline(true);
      } else {
        lastCoachSeenRef.current = null;
        setCoachOnline(false);
      }
    });

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        isSubscribedRef.current = true;
        retryAttemptRef.current = 0;
        if (document.visibilityState === 'visible') track();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        isSubscribedRef.current = false;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        const attempt = retryAttemptRef.current;
        const delay = Math.min(1000 * 2 ** attempt, 30_000);
        retryAttemptRef.current = attempt + 1;
        retryTimerRef.current = setTimeout(() => setRetryKey(k => k + 1), delay);
      }
    });

    const heartbeatId = setInterval(() => {
      if (isSubscribedRef.current && document.visibilityState === 'visible') track();
    }, HEARTBEAT_MS);

    const staleCheckId = setInterval(() => {
      if (lastCoachSeenRef.current !== null && Date.now() - lastCoachSeenRef.current > STALE_TTL_MS) {
        setCoachOnline(false);
      }
    }, STALE_CHECK_MS);

    const handleVisibility = () => {
      if (!isSubscribedRef.current) return;
      if (document.visibilityState === 'hidden') ch.untrack();
      else track();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isSubscribedRef.current = false;
      clearInterval(heartbeatId);
      clearInterval(staleCheckId);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(ch);
    };
  }, [user, clientId, supabase, retryKey]);

  return <ClientPresenceContext.Provider value={{ coachOnline }}>{children}</ClientPresenceContext.Provider>;
}

export function GlobalPresenceCoachProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [onlineMap, setOnlineMap] = useState<Record<string, boolean>>({});
  const supabase = useRef(createClient({ worker: true, heartbeatIntervalMs: 15_000 })).current;
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    supabase.from('clients').select('id').eq('coach_id', user.id)
      .then(({ data }) => setClientIds((data ?? []).map(c => c.id)));
  }, [user, supabase]);

  useEffect(() => {
    const onOnline = () => setRetryKey(k => k + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  useEffect(() => {
    if (!user || clientIds.length === 0) return;

    const cleanups: (() => void)[] = [];

    for (const clientId of clientIds) {
      const ch = supabase.channel(`global-presence-${clientId}`, {
        config: { presence: { key: user.id } },
      });
      const track = () => ch.track({ user_id: user.id, role: 'coach', online_at: new Date().toISOString() } satisfies PresenceEntry);
      const isSubscribedRef = { current: false };
      const lastSeenRef = { current: null as number | null };
      const retryAttemptRef = { current: 0 };
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<PresenceEntry>();
        const clientEntry = Object.entries(state).find(([key, entries]) =>
          key !== user.id && entries.some(e => e.role === 'client'));
        if (clientEntry) {
          const entry = clientEntry[1].find(e => e.role === 'client');
          lastSeenRef.current = entry?.online_at ? new Date(entry.online_at).getTime() : Date.now();
          setOnlineMap(prev => ({ ...prev, [clientId]: true }));
        } else {
          lastSeenRef.current = null;
          setOnlineMap(prev => ({ ...prev, [clientId]: false }));
        }
      });

      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          isSubscribedRef.current = true;
          retryAttemptRef.current = 0;
          if (document.visibilityState === 'visible') track();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          isSubscribedRef.current = false;
          if (retryTimer) clearTimeout(retryTimer);
          const attempt = retryAttemptRef.current;
          const delay = Math.min(1000 * 2 ** attempt, 30_000);
          retryAttemptRef.current = attempt + 1;
          retryTimer = setTimeout(() => setRetryKey(k => k + 1), delay);
        }
      });

      const heartbeatId = setInterval(() => {
        if (isSubscribedRef.current && document.visibilityState === 'visible') track();
      }, HEARTBEAT_MS);

      const staleCheckId = setInterval(() => {
        if (lastSeenRef.current !== null && Date.now() - lastSeenRef.current > STALE_TTL_MS) {
          setOnlineMap(prev => ({ ...prev, [clientId]: false }));
        }
      }, STALE_CHECK_MS);

      const handleVisibility = () => {
        if (!isSubscribedRef.current) return;
        if (document.visibilityState === 'hidden') ch.untrack();
        else track();
      };
      document.addEventListener('visibilitychange', handleVisibility);

      cleanups.push(() => {
        isSubscribedRef.current = false;
        clearInterval(heartbeatId);
        clearInterval(staleCheckId);
        if (retryTimer) clearTimeout(retryTimer);
        document.removeEventListener('visibilitychange', handleVisibility);
        supabase.removeChannel(ch);
      });
    }

    return () => cleanups.forEach(fn => fn());
  }, [user, clientIds, supabase, retryKey]);

  const isClientOnline = (clientId: string) => !!onlineMap[clientId];

  return <CoachPresenceContext.Provider value={{ isClientOnline }}>{children}</CoachPresenceContext.Provider>;
}

export function useGlobalClientPresence() {
  return useContext(ClientPresenceContext);
}

export function useGlobalCoachPresence() {
  return useContext(CoachPresenceContext);
}
