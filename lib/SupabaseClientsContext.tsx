'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CALL_COLUMNS } from '@/lib/supabase/types';
import type { Task } from '@/lib/supabase/types';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';
import { computeSalesCallStats, fetchIgLeadsCount, isNotCanceled, type DealForStats } from '@/lib/salesCallStats';
import { getPeriodWindow } from '@/lib/period';

export interface CoachBusinessData {
  cashContracted: number;
  cashContractedThisMonth: number;
  cashCollected: number | null;
  cashCollectedAllTime: number | null;
  cashCollectedThisMonth: number | null;
  prospectCallsBooked: number;
  prospectCallsBookedThisMonth: number;
  closingRate: number;
  closingRateThisMonth: number;
  leadsAllTimeCount: number;
  leadsThisMonthCount: number;
  /** Cash collecté par TOUS les élèves (Stripe, cumulé) — distinct du cash
   * perso du coach ci-dessus. null si aucun élève n'a Stripe connecté. */
  studentsCashCollectedAllTime: number | null;
  studentsCashCollectedThisMonth: number | null;
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
  cashContractedThisMonth: 0,
  cashCollected: null,
  cashCollectedAllTime: null,
  cashCollectedThisMonth: null,
  prospectCallsBooked: 0,
  prospectCallsBookedThisMonth: 0,
  closingRate: 0,
  closingRateThisMonth: 0,
  leadsAllTimeCount: 0,
  leadsThisMonthCount: 0,
  studentsCashCollectedAllTime: null,
  studentsCashCollectedThisMonth: null,
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
      const startOfMonth = getPeriodWindow(0, 'month').periodStart.toISOString();

      const [snapshotsRes, tasksRes, sessionReportsRes, callsRes, avatarsRes, integrationsRes, stripePaymentsRes, stripePaymentsAllTimeRes, clientPaymentsRes, clientDealsRes, salesCallsRes, manualCallsRes, coachSalesCallsRes, coachLeadsAllTime, coachLeadsThisMonth, coachIntegrationsRes, coachStripePaymentsAllTimeRes] = await Promise.all([
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
        // Plafond volontairement large plutôt qu'absent : ce contexte est chargé sur
        // TOUTES les pages coach, donc une requête non bornée alourdirait chaque
        // navigation. L'ancienne limite de 100 était atteinte en quelques mois (20
        // élèves × ~3 coachings/semaine) et faisait alors disparaître silencieusement
        // les calls les plus anciens de l'historique. La page Calls pagine par
        // période, donc rien n'est rendu d'un coup.
        supabase.from('calls').select(CALL_COLUMNS).eq('coach_id', user.id)
          .neq('ignored', true)
          .order('scheduled_at', { ascending: false }).limit(2000),
        profileIds.length > 0
          ? supabase.from('profiles').select('id, avatar_url, full_name').in('id', profileIds)
          : { data: [], error: null },
        profileIds.length > 0
          ? supabase.from('integrations').select('profile_id, provider, first_connected_at, status').in('profile_id', profileIds)
          : { data: [], error: null },
        // Cash collecté = paiements RATTACHÉS À UN DEAL, pas l'encaissé Stripe brut.
        // Un élève peut encaisser hors Momentum (formation vendue ailleurs, virement
        // manuel) : compter ces paiements rendrait le taux collecté/contracté
        // incohérent (>100 %) et viderait de son sens la file « À rattacher », dont
        // l'intérêt est justement de faire entrer un paiement dans le total.
        // Décision du 19/08/2026.
        profileIds.length > 0
          ? supabase.from('deal_payments')
              .select('amount, status, paid_at, deals!inner(profile_id)')
              .in('deals.profile_id', profileIds)
              .eq('status', 'succeeded')
              .gte('paid_at', startOfMonth)
          : { data: [], error: null },
        profileIds.length > 0
          ? supabase.from('deal_payments')
              .select('amount, status, deals!inner(profile_id)')
              .in('deals.profile_id', profileIds)
              .eq('status', 'succeeded')
          : { data: [], error: null },
        // Cash collecté all-time par élève (agrégat + tendance sparkbar, PageClients.tsx)
        profileIds.length > 0
          ? supabase.from('deal_payments')
              .select('amount, paid_at, deals!inner(profile_id)')
              .in('deals.profile_id', profileIds)
              .eq('status', 'succeeded')
              .order('paid_at', { ascending: true })
          : { data: [], error: null },
        // Deals par élève — source du cash contracté, en remplacement de la somme
        // des `calls.revenue`. Un deal hors call (upsell, vente directe) est
        // invisible côté calls : le sommer là revenait à sous-estimer le cash.
        // Le coach est inclus : il a ses propres deals (ses ventes à lui), et son
        // profile_id n'est pas dans profileIds qui ne liste que ses élèves.
        supabase.from('deals')
          .select('id, profile_id, amount_total, signed_at, call_id, status')
          .in('profile_id', [...profileIds, user.id]),
        // Calls de vente calendly par élève — coach_id de la table calls = profile_id
        // de l'élève, pas le coach humain (piège documenté dans docs/calls-coach-id-piege.md).
        // Utilisé pour currentStats par-élève (fiches clients), pas pour business
        // (business = stats PERSONNELLES du coach, cf. requêtes coachSalesCallsRes
        // ci-dessous — le coach vend son propre coaching, distinct de ses élèves).
        profileIds.length > 0
          ? supabase.from('calls').select(CALL_COLUMNS).in('coach_id', profileIds).eq('call_type', 'calendly').neq('ignored', true)
          : { data: [], error: null },
        // Calls manuels par élève (créés via le pipeline élève, drag vers "Call
        // booké") — même remarque, sert à currentStats par-élève uniquement.
        ids.length > 0
          ? supabase.from('calls').select(CALL_COLUMNS).in('client_id', ids).eq('call_type', 'manual').neq('ignored', true)
          : { data: [], error: null },
        // Stats PERSONNELLES du coach (son propre profile_id) : leads/calls/cash
        // de SON activité de vente à lui, distincte de celle de ses élèves. Le
        // tracking coach (connexion Calendly/Instagram perso) reste à mettre en
        // place — ces requêtes renverront 0 tant que rien n'est connecté, mais
        // fonctionneront automatiquement une fois l'infra branchée.
        supabase.from('calls').select(CALL_COLUMNS).eq('coach_id', user.id)
          .eq('call_type', 'calendly').neq('ignored', true),
        fetchIgLeadsCount(supabase, user.id, null),
        fetchIgLeadsCount(supabase, user.id, startOfMonth),
        // Intégrations et paiements Stripe PERSO du coach (profile_id = user.id, pas
        // les élèves) — manquaient jusqu'ici, business.cashCollected lisait par erreur
        // stripePaymentsRes (scopé profileIds élèves, cf. plus haut).
        supabase.from('integrations').select('provider').eq('profile_id', user.id),
        // Même règle que pour les élèves : le cash collecté du coach compte les
        // paiements rattachés à ses deals, pas son encaissé Stripe brut.
        supabase.from('deal_payments')
          .select('amount, paid_at, deals!inner(profile_id)')
          .eq('deals.profile_id', user.id)
          .eq('status', 'succeeded')
          .order('paid_at', { ascending: true }),
      ]);

      if (snapshotsRes.error) throw snapshotsRes.error;
      if (tasksRes.error) throw tasksRes.error;
      if (sessionReportsRes.error) throw sessionReportsRes.error;
      if (callsRes.error) throw callsRes.error;
      if (avatarsRes.error) throw avatarsRes.error;
      if (integrationsRes.error) throw integrationsRes.error;
      if (stripePaymentsRes.error) throw stripePaymentsRes.error;
      if (stripePaymentsAllTimeRes.error) throw stripePaymentsAllTimeRes.error;
      if (clientPaymentsRes.error) throw clientPaymentsRes.error;
      if (clientDealsRes.error) throw clientDealsRes.error;
      if (coachIntegrationsRes.error) throw coachIntegrationsRes.error;
      if (coachStripePaymentsAllTimeRes.error) throw coachStripePaymentsAllTimeRes.error;
      if (coachSalesCallsRes.error) throw coachSalesCallsRes.error;
      if (salesCallsRes.error) throw salesCallsRes.error;
      if (manualCallsRes.error) throw manualCallsRes.error;

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
      // Le profile_id vient de la jointure `deals` : la table deal_payments ne le
      // porte pas, elle est rattachée au deal qui, lui, appartient à un profil.
      const paymentsByProfile: Record<string, { amount: number; date: string }[]> = {};
      (clientPaymentsRes.data || []).forEach((p: any) => {
        const pid = p.deals?.profile_id;
        if (!pid) return;
        if (!paymentsByProfile[pid]) paymentsByProfile[pid] = [];
        paymentsByProfile[pid].push({ amount: Number(p.amount), date: p.paid_at });
      });

      // Deals groupés par élève — passés à computeSalesCallStats pour que le cash
      // contracté vienne de `deals` et non de la somme des `calls.revenue`.
      const dealsByProfile: Record<string, DealForStats[]> = {};
      (clientDealsRes.data || []).forEach((d: any) => {
        if (!dealsByProfile[d.profile_id]) dealsByProfile[d.profile_id] = [];
        dealsByProfile[d.profile_id].push(d);
      });

      // Calls de vente groupés par profile_id élève (coach_id de `calls` = profile_id
      // élève, voir docs/calls-coach-id-piege.md) — calendly + manual fusionnés,
      // utilisés pour le closing rate / cash contracté / calls bookés.
      const salesCallsByProfile: Record<string, any[]> = {};
      (salesCallsRes.data || []).forEach((c: any) => {
        if (!salesCallsByProfile[c.coach_id]) salesCallsByProfile[c.coach_id] = [];
        salesCallsByProfile[c.coach_id].push(c);
      });
      const clientIdToProfileId: Record<string, string> = {};
      (rawClients || []).forEach((c: any) => { if (c.profile_id) clientIdToProfileId[c.id] = c.profile_id; });
      (manualCallsRes.data || []).forEach((c: any) => {
        const pid = clientIdToProfileId[c.client_id];
        if (!pid) return;
        if (!salesCallsByProfile[pid]) salesCallsByProfile[pid] = [];
        salesCallsByProfile[pid].push(c);
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

      // profile_id → ensemble des providers connectés — sert à la détection Stripe
      // déjà existante plus bas. Le statut d'onboarding lui-même (invité / compte créé
      // / intégrations en cours / actif / reconnexion requise) se base désormais sur
      // clients.integrations_ready_at (posé par un trigger DB dès que les 7 intégrations
      // obligatoires sont connectées, jamais réécrit ensuite) plutôt que sur un calcul
      // dynamique ici — voir docs/integrations-ready-at-vs-onboarding-completed-at.md.
      const providersByProfile: Record<string, Set<string>> = {};
      const failedProvidersByProfile: Record<string, Set<string>> = {};
      (integrationsRes.data || []).forEach((row: any) => {
        if (!providersByProfile[row.profile_id]) providersByProfile[row.profile_id] = new Set();
        providersByProfile[row.profile_id].add(row.provider);
        if (row.status === 'failed') {
          if (!failedProvidersByProfile[row.profile_id]) failedProvidersByProfile[row.profile_id] = new Set();
          failedProvidersByProfile[row.profile_id].add(row.provider);
        }
      });

      const now2 = new Date();
      setClients((rawClients || []).map((c: any) => {
        const snap = c.profile_id ? latestSnapByProfile[c.profile_id] : null;
        // Cash contracté / closing rate calculés sur les calls générés par le pipeline
        // Momentum uniquement : booked_at (date de réservation réelle) >= toutes les
        // intégrations obligatoires connectées pour la 1ère fois (integrations_ready_at)
        // — même règle que PageClientDetail.tsx (fiche élève), pour ne jamais afficher un
        // chiffre différent entre la liste des élèves (cette carte) et sa fiche
        // détaillée. Fallback sur scheduled_at si booked_at manque.
        const allSalesCalls = c.profile_id ? (salesCallsByProfile[c.profile_id] || []) : [];
        const integrationsReadyAt = c.integrations_ready_at ?? null;
        const salesCalls = integrationsReadyAt
          ? allSalesCalls.filter((call: any) =>
              call.call_type !== 'calendly'
              || (call.booked_at ? call.booked_at >= integrationsReadyAt : call.scheduled_at >= integrationsReadyAt))
          : allSalesCalls;
        // Les deals suivent le même périmètre que les calls retenus ci-dessus :
        // un deal issu d'un call antérieur à integrations_ready_at doit être
        // exclu comme l'est son call, sinon la carte afficherait un cash que le
        // closing rate juste à côté ignore. Un deal SANS call (upsell, vente
        // directe) n'a pas de date de réservation à comparer : il est toujours
        // compté, c'est précisément le cash que `calls.revenue` rendait invisible.
        const keptCallIds = new Set(salesCalls.map((call: any) => call.id));
        const allDeals = c.profile_id ? (dealsByProfile[c.profile_id] || []) : [];
        const clientDeals = integrationsReadyAt
          ? allDeals.filter((d: any) => !d.call_id || keptCallIds.has(d.call_id))
          : allDeals;
        const stats = c.profile_id ? computeSalesCallStats(salesCalls, now2, clientDeals) : null;
        const currentStats = c.profile_id ? {
          followersIg: snap?.ig_followers ?? 0,
          followersYt: snap?.yt_subscribers ?? 0,
          cashContracted: stats!.cashContracted,
          closingRate: stats!.closingRate,
        } : null;
        const payments = c.profile_id ? (paymentsByProfile[c.profile_id] || []) : [];
        const cashCollectedAllTimeForClient = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        // Tendance = cash COLLECTÉ cumulé. C'était le contracté jusqu'ici, faute de
        // lien fiable deal↔paiement ; ce lien existe maintenant (deal_payments), donc
        // la sparkbar montre l'argent réellement entré plutôt que l'argent promis.
        let runningCollected = 0;
        const cashContractedTrend = payments.map(p => (runningCollected += Number(p.amount || 0)));
        const hasFailedIntegration = c.profile_id ? (failedProvidersByProfile[c.profile_id]?.size ?? 0) > 0 : false;
        const onboardingStatus: 'invited' | 'account_created' | 'integrating' | 'reconnect_needed' | 'active' =
          !c.profile_id ? 'invited'
          : !c.onboarding_completed_at ? 'account_created'
          : !c.integrations_ready_at ? 'integrating'
          : hasFailedIntegration ? 'reconnect_needed'
          : 'active';
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

      // Stats PERSONNELLES du coach (son activité de vente à lui, distincte de
      // celle de ses élèves) — à 0 tant que le coach n'a pas connecté ses propres
      // intégrations Calendly/Instagram (tracking coach pas encore mis en place).
      const coachSalesCalls: any[] = coachSalesCallsRes.data || [];
      // Deals du coach lui-même : son profile_id est son user.id.
      const coachDeals = (clientDealsRes.data || []).filter((d: any) => d.profile_id === user.id);
      // Découpe mensuelle sur `signed_at`, la date de signature du deal — et non
      // sur celle du call. Un deal signé en relance trois semaines après le call
      // appartient au mois où l'argent a été engagé, pas à celui de l'entretien.
      const coachDealsThisMonth = coachDeals.filter((d: any) => (d.signed_at ?? '') >= startOfMonth);
      const coachAllTimeStats = computeSalesCallStats(coachSalesCalls, now2, coachDeals);
      const coachCallsThisMonth = coachSalesCalls.filter((c: any) => (c.scheduled_at ?? '') >= startOfMonth);
      const coachThisMonthStats = computeSalesCallStats(coachCallsThisMonth, now2, coachDealsThisMonth);
      const coachYtBookedAllTime = coachSalesCalls.filter((c: any) => isNotCanceled(c) && (c.source ?? '').toLowerCase().startsWith('yt')).length;
      const coachYtBookedThisMonth = coachCallsThisMonth.filter((c: any) => isNotCanceled(c) && (c.source ?? '').toLowerCase().startsWith('yt')).length;

      // Cash PERSO du coach — Stripe connecté sur SON profil (profile_id = user.id).
      const coachStripeConnected = (coachIntegrationsRes.data || []).some((row: any) => row.provider === 'stripe');
      const coachPayments = coachStripePaymentsAllTimeRes.data || [];
      const cashCollectedAllTime = coachStripeConnected
        ? coachPayments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
        : null;
      // paid_at et non date : deal_payments date le moment de l'encaissement réel.
      const cashCollected = coachStripeConnected
        ? coachPayments.filter((p: any) => (p.paid_at ?? '') >= startOfMonth)
            .reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
        : null;

      // Cash collecté par TOUS LES ÉLÈVES — Stripe connecté sur au moins un profil élève.
      const studentsStripeConnected = (integrationsRes.data || []).some((row: any) => row.provider === 'stripe');
      // Number() explicite : Postgres renvoie les numeric en chaîne, et une
      // concaténation silencieuse ("10" + "20" = "1020") passerait le typage.
      const studentsCashCollectedAllTime = studentsStripeConnected
        ? (stripePaymentsAllTimeRes.data || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
        : null;
      const studentsCashCollectedThisMonth = studentsStripeConnected
        ? (stripePaymentsRes.data || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
        : null;

      setBusiness({
        cashContracted: coachAllTimeStats.cashContracted,
        cashContractedThisMonth: coachThisMonthStats.cashContracted,
        cashCollected,
        cashCollectedAllTime,
        cashCollectedThisMonth: cashCollected,
        studentsCashCollectedAllTime,
        studentsCashCollectedThisMonth,
        prospectCallsBooked: coachAllTimeStats.callsBookedCount,
        prospectCallsBookedThisMonth: coachThisMonthStats.callsBookedCount,
        closingRate: coachAllTimeStats.closingRate,
        closingRateThisMonth: coachThisMonthStats.closingRate,
        leadsAllTimeCount: coachLeadsAllTime + coachYtBookedAllTime,
        leadsThisMonthCount: coachLeadsThisMonth + coachYtBookedThisMonth,
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
      // filter serveur : sans lui, l'abonnement portait sur TOUTE la table `calls`
      // — chaque coach était réveillé par les changements des autres coachs et par
      // les écritures des crons, pour un refetch dont le résultat était identique.
      // Aucune fuite de données (le refetch est scopé, RLS actif), mais du travail
      // pur perte qui croît avec l'activité globale. Même pattern qu'useNotifications.ts:286.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `coach_id=eq.${userId}` }, (payload) => {
        // Patch INCRÉMENTAL, pas de rechargement complet.
        //
        // Recharger 2000 calls à chaque événement représentait ~1,3 Mo par
        // écriture, chez chaque coach connecté — et les crons écrivent dans
        // `calls` en continu. C'était le premier poste d'egress projeté à 30
        // élèves (quota Supabase : 5 Go/mois en plan gratuit).
        //
        // Le payload Realtime porte déjà la ligne modifiée : on l'applique
        // directement. Le rechargement complet ne servait qu'à contourner
        // l'absence de patch — au prix de tout retransmettre pour une ligne.
        //
        // Historique : cette requête était à `.limit(100)` alors que le
        // chargement initial en prend 2000, ce qui tronquait silencieusement
        // l'historique dès le premier événement. Le patch supprime le problème
        // à la racine : on ne remplace plus la liste, on la modifie.
        const row = (payload.new ?? payload.old) as import('@/lib/supabase/types').Call | undefined;
        if (!row?.id) return;

        setCalls(prev => {
          if (payload.eventType === 'DELETE') return prev.filter(c => c.id !== row.id);
          // `ignored` masque un call sans le supprimer : le retirer de la liste
          // revient au même côté affichage.
          if ((row as { ignored?: boolean }).ignored === true) return prev.filter(c => c.id !== row.id);

          const idx = prev.findIndex(c => c.id === row.id);
          if (idx === -1) {
            // Nouveau call : inséré à sa place chronologique plutôt qu'en tête,
            // pour que l'ordre reste celui du chargement initial (desc).
            const next = [...prev, row];
            next.sort((a, b) =>
              new Date(b.scheduled_at ?? 0).getTime() - new Date(a.scheduled_at ?? 0).getTime());
            return next;
          }
          const next = [...prev];
          next[idx] = { ...next[idx], ...row };
          return next;
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
