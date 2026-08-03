'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Client, Task, Call, SessionReport } from '@/lib/supabase/types';
import { isCallReallyOver } from '@/lib/sessionRapport';

export interface CurrentStats {
  followersIg: number;
  followersYt: number;
  cashContracted: number;
  closingRate: number;
}

export interface ClientWithMetrics extends Client {
  tasks: Task[];
  sessionReports: SessionReport[];
  currentStats: CurrentStats | null;
  cashCollectedAllTime: number;
  cashContractedTrend: number[];
  resources: { id: string; title: string; description: string | null; url: string | null; week: number | null; created_at: string }[];
  lastCoachMessage: string | null;
  coachName: string | null;
  avatar_url: string | null;
  onboardingStatus?: 'invited' | 'account_created' | 'integrating' | 'active';
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

// Hook léger pour l'espace client (vue client connecté)
export function useClientSelfData() {
  const [data, setData] = useState<ClientSelfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState<string | null>(null);
  const supabase = createClient();

  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: clientRow } = await supabase
        .from('clients').select('*').eq('profile_id', user.id).single();
      if (!clientRow) { setLoading(false); return; }
      setClientId(clientRow.id);

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      const [
        tasksRes, resourcesRes, lastMsgRes, coachProfileRes,
        nextCallRes, callsTodayRes, callsThisMonthRes, leadsThisMonthRes,
        stripeIntegRes, stripePaymentsRes, ownProfileRes,
      ] = await Promise.all([
        supabase.from('tasks').select('*').eq('client_id', clientRow.id).order('created_at', { ascending: true }),
        supabase.from('resources').select('*').eq('coach_id', clientRow.coach_id).order('created_at', { ascending: false }).limit(3),
        supabase.from('messages').select('text, created_at').eq('client_id', clientRow.id).eq('sender_id', clientRow.coach_id).order('created_at', { ascending: false }).limit(1),
        supabase.from('profiles').select('full_name').eq('id', clientRow.coach_id).maybeSingle(),
        // Pas de .limit(1) ici : un call peut avoir scheduled_at futur mais déjà un
        // rapport rempli (coach en avance) — filtré côté client via isCallReallyOver,
        // donc on doit pouvoir passer au suivant si le premier résultat est écarté.
        supabase.from('calls').select('*').eq('client_id', clientRow.id)
          .eq('status', 'active')
          .neq('ignored', true)
          .gte('scheduled_at', now.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(5),
        supabase.from('calls').select('*').eq('client_id', clientRow.id)
          .eq('status', 'active')
          .neq('ignored', true)
          .gte('scheduled_at', startOfToday).lt('scheduled_at', startOfTomorrow),
        supabase.from('calls').select('*').eq('client_id', clientRow.id)
          .eq('status', 'active')
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
        clientRow.profile_id
          ? supabase.from('profiles').select('avatar_url').eq('id', clientRow.profile_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

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
        tasks: tasksRes.data || [],
        currentStats: null,
        cashCollectedAllTime: 0,
        cashContractedTrend: [],
        resources: resourcesRes.data || [],
        lastCoachMessage: lastMsgRes.data?.[0]?.text || null,
        coachName,
        avatar_url: (ownProfileRes as { data: { avatar_url: string | null } | null }).data?.avatar_url ?? null,
        business: {
          nextCall: (nextCallRes.data || []).find(c => !isCallReallyOver(c)) || null,
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
    loadRef.current = load;
    load();
  }, []);

  // Realtime : le premier chargement ne voit que les calls existants au montage —
  // sans ça, un call créé (ou accepté/refusé) après coup ne remplace jamais nextCall
  // tant que la page n'est pas rechargée. Refetch complet plutôt qu'un patch ciblé,
  // pour garder nextCall/callsToday/callsBookedThisMonth cohérents entre eux.
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`client-self-calls-${clientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `client_id=eq.${clientId}` }, () => loadRef.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId]);

  return { data, loading };
}
