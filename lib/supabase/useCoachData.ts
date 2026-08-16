'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Client, Task, Call, SessionReport } from '@/lib/supabase/types';
import { computeSalesCallStats, fetchAllLeadsCount } from '@/lib/salesCallStats';
import { getPeriodWindow } from '@/lib/period';

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
  onboardingStatus?: 'invited' | 'account_created' | 'integrating' | 'reconnect_needed' | 'active';
}

export interface ClientSelfBusinessData {
  // Liste brute triée (pas un seul call déjà résolu) — le composant choisit lequel
  // afficher, recalculé localement chaque minute (bascule + fenêtre de grâce), sans
  // requête réseau supplémentaire. Voir components/pages/client/PageClientView.tsx.
  upcomingCalls: Call[];
  callsToday: Call[];
  callsBookedAllTime: number;
  leadsAllTimeCount: number;
  cashContractedAllTime: number;
  cashCollectedAllTime: number | null;
  closingRateAllTime: number;
  callsBookedThisMonthCount: number;
  leadsThisMonthCount: number;
  cashContractedThisMonth: number;
  cashCollectedThisMonth: number | null;
  closingRateThisMonth: number;
}

export interface ClientSelfData extends ClientWithMetrics {
  business: ClientSelfBusinessData;
  coachFullName: string | null;
  coachAvatarUrl: string | null;
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
      const startOfMonth = getPeriodWindow(0, 'month').periodStart.toISOString();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      const onboardingStart = clientRow.onboarding_completed_at;

      // Cutoff des calls/leads : integrations_ready_at (toutes les intégrations
      // obligatoires connectées pour la 1ère fois, trigger DB, jamais réécrit ensuite),
      // pas onboarding_completed_at — un call/lead généré avant que le pipeline complet
      // soit opérationnel n'a pas pu venir de Momentum. Même logique que
      // useClientAllCalls.ts / pipeline/route.ts. Voir
      // docs/integrations-ready-at-vs-onboarding-completed-at.md.
      const integrationsReadyAt: string | null = clientRow.integrations_ready_at ?? null;

      const [
        tasksRes, resourcesRes, lastMsgRes, coachProfileRes,
        nextCallRes, callsTodayRes, salesCallsAllTimeRes, manualCallsAllTimeRes,
        stripeIntegRes, stripePaymentsRes, stripePaymentsAllTimeRes, ownProfileRes,
        leadsAllTimeCount, leadsThisMonthCount,
      ] = await Promise.all([
        supabase.from('tasks').select('*').eq('client_id', clientRow.id).order('created_at', { ascending: true }),
        supabase.from('resources').select('*').eq('coach_id', clientRow.coach_id).order('created_at', { ascending: false }).limit(3),
        supabase.from('messages').select('text, created_at').eq('client_id', clientRow.id).eq('sender_id', clientRow.coach_id).order('created_at', { ascending: false }).limit(1),
        supabase.from('profiles').select('full_name, avatar_url').eq('id', clientRow.coach_id).maybeSingle(),
        // Pas de .limit(1) ici : un call peut avoir scheduled_at futur mais déjà un
        // rapport rempli (coach en avance) — filtré côté client via isCallReallyOver,
        // donc on doit pouvoir passer au suivant si le premier résultat est écarté.
        // Marge de 2h avant `now` : inclut aussi les calls tout juste terminés (fenêtre
        // de rattrapage isCallJoinable de 15min gérée côté client dans PageClientView.tsx),
        // sans avoir à refaire une requête réseau pour ce cas précis.
        supabase.from('calls').select('*').eq('client_id', clientRow.id)
          .eq('status', 'active')
          .neq('ignored', true)
          .gte('scheduled_at', new Date(now.getTime() - 2 * 3600_000).toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(5),
        supabase.from('calls').select('*').eq('client_id', clientRow.id)
          .eq('status', 'active')
          .neq('ignored', true)
          .gte('scheduled_at', startOfToday).lt('scheduled_at', startOfTomorrow),
        // Calls calendly (vente) : piège calls.coach_id — cette colonne contient en
        // réalité le profile_id de l'élève pour les calls calendly, jamais client_id
        // (systématiquement NULL). Voir docs/calls-coach-id-piege.md.
        // computeSalesCallStats() fait son propre filtrage de statut en interne.
        clientRow.profile_id
          ? (() => {
              // booked_at (date de réservation réelle), pas scheduled_at (heure du call) :
              // un call réservé avant que toutes les intégrations obligatoires soient
              // connectées n'a pas pu être généré par le pipeline Momentum, même si son
              // scheduled_at tombe après. Fallback sur scheduled_at si booked_at manque.
              let q = supabase.from('calls').select('*').eq('coach_id', clientRow.profile_id)
                .eq('call_type', 'calendly')
                .neq('ignored', true);
              if (integrationsReadyAt) {
                q = q.or(`booked_at.gte.${integrationsReadyAt},and(booked_at.is.null,scheduled_at.gte.${integrationsReadyAt})`);
              }
              return q;
            })()
          : Promise.resolve({ data: [] }),
        // Calls manuels : pas concernés par le piège coach_id (non documenté comme
        // tel), client_id reste fiable ici.
        (() => {
          let q = supabase.from('calls').select('*').eq('client_id', clientRow.id)
            .eq('call_type', 'manual')
            .neq('ignored', true);
          if (onboardingStart) q = q.gte('scheduled_at', onboardingStart);
          return q;
        })(),
        clientRow.profile_id
          ? supabase.from('integrations').select('id').eq('profile_id', clientRow.profile_id).eq('provider', 'stripe').maybeSingle()
          : Promise.resolve({ data: null }),
        clientRow.profile_id
          ? supabase.from('stripe_payments').select('amount').eq('profile_id', clientRow.profile_id).gte('date', startOfMonth)
          : Promise.resolve({ data: [] }),
        clientRow.profile_id
          ? supabase.from('stripe_payments').select('amount').eq('profile_id', clientRow.profile_id)
          : Promise.resolve({ data: [] }),
        clientRow.profile_id
          ? supabase.from('profiles').select('avatar_url').eq('id', clientRow.profile_id).maybeSingle()
          : Promise.resolve({ data: null }),
        // Leads "depuis connexion" : integrations_ready_at (première fois que TOUTES
        // les intégrations obligatoires ont été connectées), pas une intégration
        // spécifique — un lead détecté sur Instagram avant que Calendly soit connecté
        // reste un vrai lead, il ne doit pas disparaître selon l'écran regardé. Même
        // référence que le gate d'onboarding, voir
        // docs/integrations-ready-at-vs-onboarding-completed-at.md.
        // fetchAllLeadsCount (Instagram + YouTube) : point d'entrée unique réutilisé
        // par la fiche coach et Mes Stats, pour ne plus jamais diverger sur ce calcul.
        clientRow.profile_id ? fetchAllLeadsCount(supabase, clientRow.profile_id, clientRow.integrations_ready_at ?? null) : Promise.resolve(0),
        clientRow.profile_id ? fetchAllLeadsCount(supabase, clientRow.profile_id, startOfMonth) : Promise.resolve(0),
      ]);

      const coachFullName: string | null = coachProfileRes.data?.full_name ?? null;
      const coachName = coachFullName ? coachFullName.split(' ')[0] : null;
      const coachAvatarUrl: string | null = coachProfileRes.data?.avatar_url ?? null;

      // "Bookés"/closing/cash contracté ne comptent que les calls prospects
      // (calendly/manual, déjà filtré côté requête) — les calls coaching (google)
      // n'ont pas de notion de deal closé/revenue et fausseraient ces stats.
      const allSalesCalls: Call[] = [...(salesCallsAllTimeRes.data || []), ...(manualCallsAllTimeRes.data || [])];
      const allTimeStats = computeSalesCallStats(allSalesCalls, now);
      const callsBookedAllTime = allTimeStats.callsBookedCount;
      const cashContractedAllTime = allTimeStats.cashContracted;
      const closingRateAllTime = allTimeStats.closingRate;

      const callsThisMonth = allSalesCalls.filter(c => (c.scheduled_at ?? '') >= startOfMonth);
      const thisMonthStats = computeSalesCallStats(callsThisMonth, now);
      const callsBookedThisMonthCount = thisMonthStats.callsBookedCount;
      const cashContractedThisMonth = thisMonthStats.cashContracted;
      const closingRateThisMonth = thisMonthStats.closingRate;

      // Leads totaux = fetchAllLeadsCount (Instagram + YouTube), calculé plus haut —
      // même fonction que la fiche coach et Mes Stats, pour un chiffre garanti
      // identique entre les 3 écrans.

      const stripeConnected = !!(stripeIntegRes as { data: { id: string } | null }).data;
      const cashCollectedAllTime = stripeConnected
        ? (stripePaymentsAllTimeRes.data || []).reduce((s: number, p: { amount: number }) => s + (p.amount || 0), 0)
        : null;
      const cashCollectedThisMonth = stripeConnected
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
        coachFullName,
        coachAvatarUrl,
        avatar_url: (ownProfileRes as { data: { avatar_url: string | null } | null }).data?.avatar_url ?? null,
        business: {
          upcomingCalls: (nextCallRes.data || []) as Call[],
          callsToday: callsTodayRes.data || [],
          callsBookedAllTime,
          leadsAllTimeCount,
          cashContractedAllTime,
          cashCollectedAllTime,
          closingRateAllTime,
          callsBookedThisMonthCount,
          leadsThisMonthCount,
          cashContractedThisMonth,
          cashCollectedThisMonth,
          closingRateThisMonth,
        },
      });
      setLoading(false);
    }
    loadRef.current = load;
    load();
  }, []);

  // Realtime : le premier chargement ne voit que les calls existants au montage —
  // sans ça, un call créé (ou accepté/refusé) après coup ne remplace jamais upcomingCalls
  // tant que la page n'est pas rechargée. Refetch complet plutôt qu'un patch ciblé,
  // pour garder upcomingCalls/callsToday/les KPI all-time cohérents entre eux.
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
