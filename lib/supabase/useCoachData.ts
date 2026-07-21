'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Client, WeeklyMetrics, Task, Call, SessionReport } from '@/lib/supabase/types';

export interface ClientWithMetrics extends Client {
  weeklyMetrics: WeeklyMetrics[];
  tasks: Task[];
  sessionReports: SessionReport[];
  latestMetrics: WeeklyMetrics | null;
  prevMetrics: WeeklyMetrics | null;
  resources: { id: string; title: string; description: string | null; url: string | null; week: number | null; created_at: string }[];
  lastCoachMessage: string | null;
  coachName: string | null;
  avatar_url: string | null;
}

export interface ClientSelfBusinessData {
  nextCall: Call | null;
  callsToday: Call[];
  callsBookedThisMonth: Call[];
  leadsThisMonthCount: number;
  cashContracted: number;
  cashCollected: number | null;
  closingRate: number;
}

export interface ClientSelfData extends ClientWithMetrics {
  business: ClientSelfBusinessData;
}

export interface CoachData {
  clients: ClientWithMetrics[];
  calls: Call[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCoachData(): CoachData {
  const [clients, setClients] = useState<ClientWithMetrics[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Non authentifié'); setLoading(false); return; }

      // Clients du coach
      const { data: rawClients, error: clientsErr } = await supabase
        .from('clients')
        .select('*')
        .eq('coach_id', user.id)
        .order('created_at', { ascending: true });

      if (clientsErr) throw clientsErr;

      const clientIds = (rawClients || []).map(c => c.id);

      // Métriques hebdo + tasks en parallèle
      const [metricsRes, tasksRes, callsRes] = await Promise.all([
        clientIds.length > 0
          ? supabase.from('weekly_metrics').select('*').in('client_id', clientIds).order('week', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        clientIds.length > 0
          ? supabase.from('tasks').select('*').in('client_id', clientIds).order('created_at', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        clientIds.length > 0
          ? supabase.from('calls').select('*').in('client_id', clientIds)
              .neq('ignored', true)
              .gte('scheduled_at', new Date().toISOString().split('T')[0])
              .order('scheduled_at', { ascending: true })
              .limit(20)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (metricsRes.error) throw metricsRes.error;
      if (tasksRes.error) throw tasksRes.error;

      const metricsMap: Record<string, WeeklyMetrics[]> = {};
      (metricsRes.data || []).forEach((m: WeeklyMetrics) => {
        if (!metricsMap[m.client_id]) metricsMap[m.client_id] = [];
        metricsMap[m.client_id].push(m);
      });

      const tasksMap: Record<string, Task[]> = {};
      (tasksRes.data || []).forEach((t: Task) => {
        if (!tasksMap[t.client_id]) tasksMap[t.client_id] = [];
        tasksMap[t.client_id].push(t);
      });

      const enriched: ClientWithMetrics[] = (rawClients || []).map(c => {
        const metrics = metricsMap[c.id] || [];
        const sorted = [...metrics].sort((a, b) => a.week - b.week);
        return {
          ...c,
          weeklyMetrics: sorted,
          tasks: tasksMap[c.id] || [],
          latestMetrics: sorted[sorted.length - 1] || null,
          prevMetrics: sorted[sorted.length - 2] || null,
        };
      });

      setClients(enriched);
      setCalls(callsRes.data || []);
    } catch (e: any) {
      setError(e.message || 'Erreur chargement données');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { clients, calls, loading, error, refetch: fetch };
}

export function useClientData(clientId: string) {
  const [client, setClient] = useState<ClientWithMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, metricsRes, tasksRes] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).single(),
        supabase.from('weekly_metrics').select('*').eq('client_id', clientId).order('week', { ascending: true }),
        supabase.from('tasks').select('*').eq('client_id', clientId).order('created_at', { ascending: true }),
      ]);

      if (clientRes.error) throw clientRes.error;

      const metrics = metricsRes.data || [];
      setClient({
        ...clientRes.data,
        weeklyMetrics: metrics,
        tasks: tasksRes.data || [],
        latestMetrics: metrics[metrics.length - 1] || null,
        prevMetrics: metrics[metrics.length - 2] || null,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetch(); }, [fetch]);

  const updateTask = useCallback(async (taskId: string, done: boolean) => {
    await supabase.from('tasks').update({ done }).eq('id', taskId);
    setClient(prev => {
      if (!prev) return prev;
      return { ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, done } : t) };
    });
  }, []);

  const addTask = useCallback(async (task: Omit<Task, 'id' | 'created_at'>) => {
    const { data } = await supabase.from('tasks').insert(task).select().single();
    if (data) setClient(prev => prev ? { ...prev, tasks: [...prev.tasks, data] } : prev);
  }, []);

  return { client, loading, error, refetch: fetch, updateTask, addTask };
}

// Hook léger pour l'espace client (vue client connecté)
export function useClientSelfData() {
  const [data, setData] = useState<ClientSelfData | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: clientRow } = await supabase
        .from('clients').select('*').eq('profile_id', user.id).single();
      if (!clientRow) { setLoading(false); return; }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      const [
        metricsRes, tasksRes, resourcesRes, lastMsgRes, coachProfileRes,
        nextCallRes, callsTodayRes, callsThisMonthRes, leadsThisMonthRes,
        stripeIntegRes, stripePaymentsRes,
      ] = await Promise.all([
        supabase.from('weekly_metrics').select('*').eq('client_id', clientRow.id).order('week', { ascending: true }),
        supabase.from('tasks').select('*').eq('client_id', clientRow.id).order('created_at', { ascending: true }),
        supabase.from('resources').select('*').eq('coach_id', clientRow.coach_id).order('created_at', { ascending: false }).limit(3),
        supabase.from('messages').select('text, created_at').eq('client_id', clientRow.id).eq('sender_id', clientRow.coach_id).order('created_at', { ascending: false }).limit(1),
        supabase.from('profiles').select('full_name').eq('id', clientRow.coach_id).maybeSingle(),
        supabase.from('calls').select('*').eq('client_id', clientRow.id)
          .neq('ignored', true)
          .gte('scheduled_at', now.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1),
        supabase.from('calls').select('*').eq('client_id', clientRow.id)
          .neq('ignored', true)
          .gte('scheduled_at', startOfToday).lt('scheduled_at', startOfTomorrow),
        supabase.from('calls').select('*').eq('client_id', clientRow.id)
          .neq('ignored', true)
          .gte('created_at', startOfMonth),
        clientRow.profile_id
          ? supabase.from('instagram_leads').select('id', { count: 'exact', head: true }).eq('profile_id', clientRow.profile_id).gte('detected_at', startOfMonth)
          : Promise.resolve({ count: 0 }),
        clientRow.profile_id
          ? supabase.from('integrations').select('id').eq('profile_id', clientRow.profile_id).eq('provider', 'stripe').maybeSingle()
          : Promise.resolve({ data: null }),
        clientRow.profile_id
          ? supabase.from('stripe_payments').select('amount').eq('profile_id', clientRow.profile_id).gte('date', startOfMonth)
          : Promise.resolve({ data: [] }),
      ]);

      const metrics = metricsRes.data || [];
      const coachFullName: string | null = coachProfileRes.data?.full_name ?? null;
      const coachName = coachFullName ? coachFullName.split(' ')[0] : null;

      const allCallsThisMonth: Call[] = callsThisMonthRes.data || [];
      // "Bookés ce mois"/closing/cash contracté ne comptent que les calls prospects
      // (calendly/manual) — les calls coaching (google) n'ont pas de notion de deal
      // closé/revenue et fausseraient ces stats business si mélangés.
      const callsThisMonth = allCallsThisMonth.filter(c => c.call_type === 'calendly' || c.call_type === 'manual');
      const callsHonores = callsThisMonth.filter(c => c.status === 'active' || c.session_completed).length;
      const dealsCloses = callsThisMonth.filter(c => c.deal_closed).length;
      const cashContracted = callsThisMonth.reduce((s, c) => s + (c.revenue || 0), 0);
      const closingRate = callsHonores > 0 ? Math.round((dealsCloses / callsHonores) * 100) : 0;

      const stripeConnected = !!(stripeIntegRes as { data: { id: string } | null }).data;
      const cashCollected = stripeConnected
        ? (stripePaymentsRes.data || []).reduce((s: number, p: { amount: number }) => s + (p.amount || 0), 0)
        : null;

      setData({
        ...clientRow,
        weeklyMetrics: metrics,
        tasks: tasksRes.data || [],
        latestMetrics: metrics[metrics.length - 1] || null,
        prevMetrics: metrics[metrics.length - 2] || null,
        resources: resourcesRes.data || [],
        lastCoachMessage: lastMsgRes.data?.[0]?.text || null,
        coachName,
        business: {
          nextCall: nextCallRes.data?.[0] || null,
          callsToday: callsTodayRes.data || [],
          callsBookedThisMonth: callsThisMonth,
          leadsThisMonthCount: leadsThisMonthRes.count || 0,
          cashContracted,
          cashCollected,
          closingRate,
        },
      });
      setLoading(false);
    }
    load();
  }, []);

  return { data, loading };
}
