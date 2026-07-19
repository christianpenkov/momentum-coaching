'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Task } from '@/lib/supabase/types';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';

interface SupabaseClientsContextValue {
  clients: ClientWithMetrics[];
  calls: import('@/lib/supabase/types').Call[];
  loading: boolean;
  error: string | null;
  getClient: (id: string) => ClientWithMetrics | undefined;
  addTask: (clientId: string, task: Omit<Task, 'id' | 'created_at'>) => Promise<void>;
  toggleTask: (clientId: string, taskId: string, done: boolean) => Promise<void>;
  refetch: () => void;
}

const SupabaseClientsContext = createContext<SupabaseClientsContextValue | null>(null);

export function SupabaseClientsProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientWithMetrics[]>([]);
  const [calls, setCalls] = useState<import('@/lib/supabase/types').Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Session peut ne pas être hydratée au 1er render — retry une fois après 400ms
        await new Promise(r => setTimeout(r, 400));
        const retry = await supabase.auth.getUser();
        user = retry.data.user;
      }
      if (!user) { setError('Non authentifié'); setLoading(false); return; }

      setUserId(user.id);

      const { data: rawClients, error: cErr } = await supabase
        .from('clients').select('*').eq('coach_id', user.id).order('created_at', { ascending: true });
      if (cErr) throw cErr;

      const ids = (rawClients || []).map((c: any) => c.id);
      const profileIds = (rawClients || []).map((c: any) => c.profile_id).filter(Boolean);

      const [metricsRes, tasksRes, callsRes, avatarsRes] = await Promise.all([
        ids.length > 0
          ? supabase.from('weekly_metrics').select('*').in('client_id', ids).order('week', { ascending: true })
          : { data: [], error: null },
        ids.length > 0
          ? supabase.from('tasks').select('*').in('client_id', ids).eq('added_by', 'coach').order('created_at', { ascending: true })
          : { data: [], error: null },
        supabase.from('calls').select('*').eq('coach_id', user.id)
          .neq('ignored', true)
          .order('scheduled_at', { ascending: false }).limit(100),
        profileIds.length > 0
          ? supabase.from('profiles').select('id, avatar_url').in('id', profileIds)
          : { data: [], error: null },
      ]);

      if (metricsRes.error) throw metricsRes.error;
      if (tasksRes.error) throw tasksRes.error;
      if (callsRes.error) throw callsRes.error;

      const metricsMap: Record<string, any[]> = {};
      (metricsRes.data || []).forEach((m: any) => {
        if (!metricsMap[m.client_id]) metricsMap[m.client_id] = [];
        metricsMap[m.client_id].push(m);
      });

      const tasksMap: Record<string, any[]> = {};
      (tasksRes.data || []).forEach((t: any) => {
        if (!tasksMap[t.client_id]) tasksMap[t.client_id] = [];
        tasksMap[t.client_id].push(t);
      });

      const avatarMap: Record<string, string | null> = {};
      (avatarsRes.data || []).forEach((p: any) => { avatarMap[p.id] = p.avatar_url; });

      setClients((rawClients || []).map((c: any) => {
        const metrics = (metricsMap[c.id] || []).sort((a: any, b: any) => a.week - b.week);
        return {
          ...c,
          weeklyMetrics: metrics,
          tasks: tasksMap[c.id] || [],
          latestMetrics: metrics[metrics.length - 1] || null,
          prevMetrics: metrics[metrics.length - 2] || null,
          resources: [],
          lastCoachMessage: null,
          avatar_url: c.profile_id ? (avatarMap[c.profile_id] || null) : null,
        };
      }));
      setCalls(callsRes.data || []);
    } catch (e: any) {
      setError(e.message || 'Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime : scoped au userId pour éviter les channels stale après reconnexion
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`calls-realtime-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, () => {
        supabase.from('calls').select('*').eq('coach_id', userId)
          .neq('ignored', true)
          .order('scheduled_at', { ascending: false }).limit(100)
          .then(({ data }) => { if (data) setCalls(data); });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const getClient = useCallback((id: string) => clients.find(c => c.id === id), [clients]);

  const addTask = useCallback(async (clientId: string, task: Omit<Task, 'id' | 'created_at'>) => {
    const { data } = await supabase.from('tasks').insert({ ...task, client_id: clientId }).select().single();
    if (data) {
      setClients(prev => prev.map(c =>
        c.id === clientId ? { ...c, tasks: [...c.tasks, data] } : c
      ));
    }
  }, []);

  const toggleTask = useCallback(async (clientId: string, taskId: string, done: boolean) => {
    await supabase.from('tasks').update({ done }).eq('id', taskId);
    setClients(prev => prev.map(c =>
      c.id === clientId
        ? { ...c, tasks: c.tasks.map(t => t.id === taskId ? { ...t, done } : t) }
        : c
    ));
  }, []);

  return (
    <SupabaseClientsContext.Provider value={{ clients, calls, loading, error, getClient, addTask, toggleTask, refetch: load }}>
      {children}
    </SupabaseClientsContext.Provider>
  );
}

export function useSupabaseClients() {
  const ctx = useContext(SupabaseClientsContext);
  if (!ctx) throw new Error('useSupabaseClients must be used inside SupabaseClientsProvider');
  return ctx;
}
