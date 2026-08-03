'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Task } from '@/lib/supabase/types';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';
import { computeSalesCallStats } from '@/lib/salesCallStats';

export interface CoachBusinessData {
  cashContracted: number;
  cashCollected: number | null;
  cashCollectedAllTime: number | null;
  prospectCallsBookedThisMonth: number;
  closingRate: number;
  leadsThisMonthCount: number;
  coachLeadsThisMonthCount: number;
}

interface SupabaseClientsContextValue {
  clients: ClientWithMetrics[];
  calls: import('@/lib/supabase/types').Call[];
  business: CoachBusinessData;
  loading: boolean;
  error: string | null;
  getClient: (id: string) => ClientWithMetrics | undefined;
  addTask: (clientId: string, task: Omit<Task, 'id' | 'created_at'>) => Promise<boolean>;
  toggleTask: (clientId: string, taskId: string, done: boolean) => Promise<boolean>;
  archiveClient: (clientId: string) => Promise<boolean>;
  unarchiveClient: (clientId: string) => Promise<boolean>;
  refetch: () => void;
}

const EMPTY_BUSINESS: CoachBusinessData = {
  cashContracted: 0,
  cashCollected: null,
  cashCollectedAllTime: null,
  prospectCallsBookedThisMonth: 0,
  closingRate: 0,
  leadsThisMonthCount: 0,
  coachLeadsThisMonthCount: 0,
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
        .from('clients').select('*').eq('coach_id', user.id).is('archived_at', null).order('created_at', { ascending: true });
      if (cErr) throw cErr;

      const ids = (rawClients || []).map((c: any) => c.id);
      const profileIds = (rawClients || []).map((c: any) => c.profile_id).filter(Boolean);

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [snapshotsRes, tasksRes, sessionReportsRes, callsRes, avatarsRes, callsThisMonthRes, integrationsRes, stripePaymentsRes, stripePaymentsAllTimeRes, leadsThisMonthRes, coachIgLeadsRes, coachProspectsRes, clientPaymentsRes, salesCallsRes] = await Promise.all([
        // Dernier snapshot par élève pour followers IG/YT + MRR actuels — remplace
        // weekly_metrics (jamais écrite par aucun cron, table morte). Fenêtre de 3
        // jours glissants pour tolérer un jour de cron manqué ; on garde ensuite le
        // plus récent par profile_id côté client, même pattern que PageClientStats.tsx.
        profileIds.length > 0
          ? supabase.from('analytics_daily_snapshots').select('profile_id, date, ig_followers, yt_subscribers, mrr')
              .in('profile_id', profileIds)
              .gte('date', new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10))
              .order('date', { ascending: false })
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
          ? supabase.from('profiles').select('id, avatar_url, full_name').in('id', profileIds)
          : { data: [], error: null },
        // Requête dédiée aux agrégats "Ton business" : bornée par date (mois en cours),
        // pas par limit(100) comme calls ci-dessus (R3-10) — évite de tronquer les KPIs
        // business dès que le coach dépasse 100 calls récents tous flux confondus.
        supabase.from('calls').select('*').eq('coach_id', user.id)
          .neq('ignored', true)
          .gte('created_at', startOfMonth),
        profileIds.length > 0
          ? supabase.from('integrations').select('profile_id, provider').in('profile_id', profileIds)
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
        // Stats personnelles du coach (distinctes de ses élèves) : "Leads générés" ce mois
        supabase.from('instagram_leads').select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id).gte('detected_at', startOfMonth),
        supabase.from('prospects').select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id).gte('created_at', startOfMonth),
        // Cash collecté all-time par élève (agrégat + tendance sparkbar, PageClients.tsx)
        profileIds.length > 0
          ? supabase.from('stripe_payments').select('profile_id, amount, date').in('profile_id', profileIds).order('date', { ascending: true })
          : { data: [], error: null },
        // Calls de vente par élève pour le closing rate — coach_id de la table calls
        // = profile_id de l'élève, pas le coach humain (piège documenté dans
        // docs/calls-coach-id-piege.md).
        profileIds.length > 0
          ? supabase.from('calls').select('*').in('coach_id', profileIds).eq('call_type', 'calendly').neq('ignored', true)
          : { data: [], error: null },
      ]);

      if (snapshotsRes.error) throw snapshotsRes.error;
      if (tasksRes.error) throw tasksRes.error;
      if (sessionReportsRes.error) throw sessionReportsRes.error;
      if (callsRes.error) throw callsRes.error;
      if (avatarsRes.error) throw avatarsRes.error;
      if (callsThisMonthRes.error) throw callsThisMonthRes.error;
      if (integrationsRes.error) throw integrationsRes.error;
      if (stripePaymentsRes.error) throw stripePaymentsRes.error;
      if (stripePaymentsAllTimeRes.error) throw stripePaymentsAllTimeRes.error;
      if ('error' in leadsThisMonthRes && leadsThisMonthRes.error) throw leadsThisMonthRes.error;
      if (coachIgLeadsRes.error) throw coachIgLeadsRes.error;
      if (coachProspectsRes.error) throw coachProspectsRes.error;
      if (clientPaymentsRes.error) throw clientPaymentsRes.error;
      if (salesCallsRes.error) throw salesCallsRes.error;

      // Snapshots triés desc par date → pour chaque métrique, on garde la première
      // valeur non-null rencontrée par profil (pas juste le tout premier snapshot :
      // yt_subscribers/mrr peuvent être null les derniers jours avant backfill du
      // cron, même pattern que PageClientStats.tsx).
      const latestSnapByProfile: Record<string, { ig_followers: number | null; yt_subscribers: number | null; mrr: number | null }> = {};
      (snapshotsRes.data || []).forEach((s: any) => {
        const cur = latestSnapByProfile[s.profile_id] ?? (latestSnapByProfile[s.profile_id] = { ig_followers: null, yt_subscribers: null, mrr: null });
        if (cur.ig_followers == null && s.ig_followers != null) cur.ig_followers = s.ig_followers;
        if (cur.yt_subscribers == null && s.yt_subscribers != null) cur.yt_subscribers = s.yt_subscribers;
        if (cur.mrr == null && s.mrr != null) cur.mrr = s.mrr;
      });

      // Paiements triés asc par élève — sert au total all-time et à la sparkbar cumulative.
      const paymentsByProfile: Record<string, { amount: number; date: string }[]> = {};
      (clientPaymentsRes.data || []).forEach((p: any) => {
        if (!paymentsByProfile[p.profile_id]) paymentsByProfile[p.profile_id] = [];
        paymentsByProfile[p.profile_id].push(p);
      });

      // Calls de vente groupés par profile_id élève (coach_id de `calls` = profile_id
      // élève, voir docs/calls-coach-id-piege.md) — utilisés pour le closing rate.
      const salesCallsByProfile: Record<string, any[]> = {};
      (salesCallsRes.data || []).forEach((c: any) => {
        if (!salesCallsByProfile[c.coach_id]) salesCallsByProfile[c.coach_id] = [];
        salesCallsByProfile[c.coach_id].push(c);
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
      const fullNameMap: Record<string, string | null> = {};
      (avatarsRes.data || []).forEach((p: any) => {
        avatarMap[p.id] = p.avatar_url;
        fullNameMap[p.id] = p.full_name;
      });

      // profile_id → ensemble des providers connectés — sert au statut d'onboarding
      // (élève invité / compte créé / intégrations en cours / actif) et, en dessous,
      // à la détection Stripe déjà existante.
      const providersByProfile: Record<string, Set<string>> = {};
      (integrationsRes.data || []).forEach((row: any) => {
        if (!providersByProfile[row.profile_id]) providersByProfile[row.profile_id] = new Set();
        providersByProfile[row.profile_id].add(row.provider);
      });
      const REQUIRED_PROVIDERS = ['instagram', 'calendly', 'youtube', 'stripe', 'shortio'];

      const now2 = new Date();
      setClients((rawClients || []).map((c: any) => {
        const snap = c.profile_id ? latestSnapByProfile[c.profile_id] : null;
        // Cash contracté depuis la création réelle du compte Momentum de l'élève
        // (onboarding_completed_at), même référence temporelle que les 8 KPI de
        // PageClientDetail.tsx — pas de connectedAt (connexion d'un provider externe).
        const allSalesCalls = c.profile_id ? (salesCallsByProfile[c.profile_id] || []) : [];
        const salesCalls = c.onboarding_completed_at
          ? allSalesCalls.filter((call: any) => call.scheduled_at >= c.onboarding_completed_at)
          : allSalesCalls;
        const currentStats = c.profile_id ? {
          followersIg: snap?.ig_followers ?? 0,
          followersYt: snap?.yt_subscribers ?? 0,
          cashContracted: computeSalesCallStats(salesCalls, now2).cashContracted,
          closingRate: computeSalesCallStats(salesCalls, now2).closingRate,
        } : null;
        const payments = c.profile_id ? (paymentsByProfile[c.profile_id] || []) : [];
        const cashCollectedAllTimeForClient = payments.reduce((s, p) => s + (p.amount || 0), 0);
        // Tendance = cash CONTRACTÉ cumulé (même source que la colonne Cash), pas le
        // cash collecté Stripe — stripe_payments est vide pour la plupart des élèves
        // tant que le chantier cash collecté (lien fiable deal↔paiement) n'est pas résolu.
        const dealsClosedSorted = [...salesCalls]
          .filter((call: any) => call.deal_closed && call.revenue)
          .sort((a: any, b: any) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''));
        let runningContracted = 0;
        const cashContractedTrend = dealsClosedSorted.map((call: any) => (runningContracted += call.revenue || 0));
        const connectedProviders = c.profile_id ? (providersByProfile[c.profile_id] ?? new Set<string>()) : new Set<string>();
        const waived: string[] = c.integrations_waived ?? [];
        const onboardingStatus: 'invited' | 'account_created' | 'integrating' | 'active' =
          !c.profile_id ? 'invited'
          : !c.onboarding_completed_at ? 'account_created'
          : REQUIRED_PROVIDERS.every(p => connectedProviders.has(p) || waived.includes(p)) ? 'active'
          : 'integrating';
        // profiles.full_name devient la seule source de vérité dès que l'élève a un
        // compte : clients.name (saisi par le coach à l'invitation) ne sert plus que
        // de repli tant que l'élève n'a pas encore renseigné/hérité d'un nom — sans
        // ce override, un changement de nom fait par l'élève dans ses réglages
        // n'apparaissait jamais côté coach (deux colonnes jamais synchronisées).
        const liveFullName = c.profile_id ? fullNameMap[c.profile_id] : null;
        return {
          ...c,
          name: liveFullName || c.name,
          tasks: tasksMap[c.id] || [],
          sessionReports: sessionReportsMap[c.id] || [],
          currentStats,
          cashCollectedAllTime: cashCollectedAllTimeForClient,
          cashContractedTrend,
          resources: [],
          lastCoachMessage: null,
          avatar_url: c.profile_id ? (avatarMap[c.profile_id] || null) : null,
          onboardingStatus,
        };
      }));
      setCalls(callsRes.data || []);

      const callsThisMonth: import('@/lib/supabase/types').Call[] = callsThisMonthRes.data || [];
      const prospectCallsThisMonth = callsThisMonth.filter(c => c.call_type === 'calendly' || c.call_type === 'manual');
      const callsHonores = callsThisMonth.filter(c => c.status === 'active' || c.session_completed).length;
      const dealsCloses = callsThisMonth.filter(c => c.deal_closed).length;
      const cashContracted = callsThisMonth.reduce((s, c) => s + (c.revenue || 0), 0);
      const closingRate = callsHonores > 0 ? Math.round((dealsCloses / callsHonores) * 100) : 0;

      const stripeConnected = (integrationsRes.data || []).some((row: any) => row.provider === 'stripe');
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
        coachLeadsThisMonthCount: (coachIgLeadsRes.count || 0) + (coachProspectsRes.count || 0),
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
          .then(({ data, error }) => {
            if (error) { console.error('[SupabaseClientsContext] refresh calls realtime:', error.message); return; }
            if (data) setCalls(data);
          });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const getClient = useCallback((id: string) => clients.find(c => c.id === id), [clients]);

  const addTask = useCallback(async (clientId: string, task: Omit<Task, 'id' | 'created_at'>) => {
    const { data, error } = await supabase.from('tasks').insert({ ...task, client_id: clientId }).select().single();
    if (error || !data) return false;
    setClients(prev => prev.map(c =>
      c.id === clientId ? { ...c, tasks: [...c.tasks, data] } : c
    ));
    return true;
  }, []);

  // Mise à jour optimiste, annulée (rollback à l'état précédent) si l'update échoue —
  // pour ne jamais laisser une checkbox cochée visuellement sans écriture réussie en base.
  const toggleTask = useCallback(async (clientId: string, taskId: string, done: boolean) => {
    let previousDone: boolean | undefined;
    setClients(prev => prev.map(c => {
      if (c.id !== clientId) return c;
      return {
        ...c,
        tasks: c.tasks.map(t => {
          if (t.id !== taskId) return t;
          previousDone = t.done;
          return { ...t, done };
        }),
      };
    }));
    const { error } = await supabase.from('tasks').update({ done }).eq('id', taskId);
    if (error) {
      setClients(prev => prev.map(c =>
        c.id === clientId
          ? { ...c, tasks: c.tasks.map(t => t.id === taskId ? { ...t, done: previousDone ?? !done } : t) }
          : c
      ));
      return false;
    }
    return true;
  }, []);

  // Archiver retire le client de la liste courante (filtrée archived_at is null au
  // chargement) sans rien supprimer — tout l'historique (calls, tasks, ressources,
  // etc.) reste intact en base, et l'élève garde un accès normal à son espace.
  const archiveClient = useCallback(async (clientId: string) => {
    const { error } = await supabase.from('clients').update({ archived_at: new Date().toISOString() }).eq('id', clientId);
    if (error) return false;
    setClients(prev => prev.filter(c => c.id !== clientId));
    return true;
  }, []);

  const unarchiveClient = useCallback(async (clientId: string) => {
    const { error } = await supabase.from('clients').update({ archived_at: null }).eq('id', clientId);
    if (error) return false;
    await load();
    return true;
  }, [load]);

  return (
    <SupabaseClientsContext.Provider value={{ clients, calls, business, loading, error, getClient, addTask, toggleTask, archiveClient, unarchiveClient, refetch: load }}>
      {children}
    </SupabaseClientsContext.Provider>
  );
}

export function useSupabaseClients() {
  const ctx = useContext(SupabaseClientsContext);
  if (!ctx) throw new Error('useSupabaseClients must be used inside SupabaseClientsProvider');
  return ctx;
}
