'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Task } from '@/lib/supabase/types';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';

export interface CoachBusinessData {
  cashContracted: number;
  cashCollected: number | null;
  cashCollectedAllTime: number | null;
  prospectCallsBookedThisMonth: number;
  closingRate: number;
  leadsThisMonthCount: number;
}

interface SupabaseClientsContextValue {
  clients: ClientWithMetrics[];
  calls: import('@/lib/supabase/types').Call[];
  business: CoachBusinessData;
  loading: boolean;
  error: string | null;
  getClient: (id: string) => ClientWithMetrics | undefined;
  addTask: (clientId: string, task: Omit<Task, 'id' | 'created_at'>) => Promise<void>;
  toggleTask: (clientId: string, taskId: string, done: boolean) => Promise<void>;
  refetch: () => void;
}

const EMPTY_BUSINESS: CoachBusinessData = {
  cashContracted: 0,
  cashCollected: null,
  cashCollectedAllTime: null,
  prospectCallsBookedThisMonth: 0,
  closingRate: 0,
  leadsThisMonthCount: 0,
};

const SupabaseClientsContext = createContext<SupabaseClientsContextValue | null>(null);

export function SupabaseClientsProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<ClientWithMetrics[]>([]);
  const [calls, setCalls] = useState<import('@/lib/supabase/types').Call[]>([]);
  const [business, setBusiness] = useState<CoachBusinessData>(EMPTY_BUSINESS);
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

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [metricsRes, tasksRes, sessionReportsRes, callsRes, avatarsRes, callsThisMonthRes, stripeIntegRes, stripePaymentsRes, stripePaymentsAllTimeRes, leadsThisMonthRes] = await Promise.all([
        ids.length > 0
          ? supabase.from('weekly_metrics').select('*').in('client_id', ids).order('week', { ascending: true })
          : { data: [], error: null },
        ids.length > 0
          ? supabase.from('tasks').select('*').in('client_id', ids).eq('added_by', 'coach').order('created_at', { ascending: true })
          : { data: [], error: null },
        ids.length > 0
          ? supabase.from('session_reports').select('*').in('client_id', ids)
          : { data: [], error: null },
        supabase.from('calls').select('*').eq('coach_id', user.id)
          .neq('ignored', true)
          .order('scheduled_at', { ascending: false }).limit(100),
        profileIds.length > 0
          ? supabase.from('profiles').select('id, avatar_url').in('id', profileIds)
          : { data: [], error: null },
        // Requête dédiée aux agrégats "Ton business" : bornée par date (mois en cours),
        // pas par limit(100) comme calls ci-dessus (R3-10) — évite de tronquer les KPIs
        // business dès que le coach dépasse 100 calls récents tous flux confondus.
        supabase.from('calls').select('*').eq('coach_id', user.id)
          .neq('ignored', true)
          .gte('created_at', startOfMonth),
        profileIds.length > 0
          ? supabase.from('integrations').select('profile_id').in('profile_id', profileIds).eq('provider', 'stripe')
          : { data: [], error: null },
        profileIds.length > 0
          ? supabase.from('stripe_payments').select('amount').in('profile_id', profileIds).gte('date', startOfMonth)
          : { data: [], error: null },
        profileIds.length > 0
          ? supabase.from('stripe_payments').select('amount').in('profile_id', profileIds)
          : { data: [], error: null },
        profileIds.length > 0
          ? supabase.from('instagram_leads').select('id', { count: 'exact', head: true }).in('profile_id', profileIds).gte('detected_at', startOfMonth)
          : { count: 0 },
      ]);

      if (metricsRes.error) throw metricsRes.error;
      if (tasksRes.error) throw tasksRes.error;
      if (sessionReportsRes.error) throw sessionReportsRes.error;
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

      const sessionReportsMap: Record<string, any[]> = {};
      (sessionReportsRes.data || []).forEach((r: any) => {
        if (!sessionReportsMap[r.client_id]) sessionReportsMap[r.client_id] = [];
        sessionReportsMap[r.client_id].push(r);
      });

      const avatarMap: Record<string, string | null> = {};
      (avatarsRes.data || []).forEach((p: any) => { avatarMap[p.id] = p.avatar_url; });

      setClients((rawClients || []).map((c: any) => {
        const metrics = (metricsMap[c.id] || []).sort((a: any, b: any) => a.week - b.week);
        return {
          ...c,
          weeklyMetrics: metrics,
          tasks: tasksMap[c.id] || [],
          sessionReports: sessionReportsMap[c.id] || [],
          latestMetrics: metrics[metrics.length - 1] || null,
          prevMetrics: metrics[metrics.length - 2] || null,
          resources: [],
          lastCoachMessage: null,
          avatar_url: c.profile_id ? (avatarMap[c.profile_id] || null) : null,
        };
      }));
      setCalls(callsRes.data || []);

      const callsThisMonth: import('@/lib/supabase/types').Call[] = callsThisMonthRes.data || [];
      const prospectCallsThisMonth = callsThisMonth.filter(c => c.call_type === 'calendly' || c.call_type === 'manual');
      const callsHonores = callsThisMonth.filter(c => c.status === 'active' || c.session_completed).length;
      const dealsCloses = callsThisMonth.filter(c => c.deal_closed).length;
      const cashContracted = callsThisMonth.reduce((s, c) => s + (c.revenue || 0), 0);
      const closingRate = callsHonores > 0 ? Math.round((dealsCloses / callsHonores) * 100) : 0;

      const stripeConnected = (stripeIntegRes.data || []).length > 0;
      const cashCollected = stripeConnected
        ? (stripePaymentsRes.data || []).reduce((s: number, p: { amount: number }) => s + (p.amount || 0), 0)
        : null;
      const cashCollectedAllTime = stripeConnected
        ? (stripePaymentsAllTimeRes.data || []).reduce((s: number, p: { amount: number }) => s + (p.amount || 0), 0)
        : null;

      setBusiness({
        cashContracted,
        cashCollected,
        cashCollectedAllTime,
        prospectCallsBookedThisMonth: prospectCallsThisMonth.length,
        closingRate,
        leadsThisMonthCount: leadsThisMonthRes.count || 0,
      });
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
    <SupabaseClientsContext.Provider value={{ clients, calls, business, loading, error, getClient, addTask, toggleTask, refetch: load }}>
      {children}
    </SupabaseClientsContext.Provider>
  );
}

export function useSupabaseClients() {
  const ctx = useContext(SupabaseClientsContext);
  if (!ctx) throw new Error('useSupabaseClients must be used inside SupabaseClientsProvider');
  return ctx;
}
