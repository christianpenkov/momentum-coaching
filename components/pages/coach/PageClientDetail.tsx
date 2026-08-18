'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import InlineLoader from '@/components/ui/InlineLoader';
import Ring from '@/components/ui/Ring';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon, { type IconName } from '@/components/ui/Icon';
import TaskModal from '@/components/ui/TaskModal';
import SessionRapportModal from '@/components/ui/SessionRapportModal';
import CallInfosModal from '@/components/ui/CallInfosModal';
import ModalShell from '@/components/ui/ModalShell';
import { useUser } from '@/lib/UserContext';
import { createClient as createSupabase } from '@/lib/supabase/client';
import { getPendingSessionRapports, SESSION_TOPICS } from '@/lib/sessionRapport';
import { isTaskOverdue } from '@/lib/clientSignals';
import { computeSalesCallStats, isNotCanceled, fetchAllLeadsCount, fetchDealsForStats } from '@/lib/salesCallStats';
import { getClientWeek } from '@/lib/clientWeek';
import DeadlineBadge from '@/components/ui/DeadlineBadge';
import { CALL_COLUMNS } from '@/lib/supabase/types';
import type { Task, SessionReport, Call, Client } from '@/lib/supabase/types';

interface ClientDetailData extends Client {
  tasks: Task[];
  avatar_url: string | null;
}

// Toutes les données de CETTE fiche client, indépendantes du portefeuille complet
// du coach (contrairement à useSupabaseClients qui charge 12 requêtes portant sur
// TOUS les élèves avant de pouvoir afficher un seul client — c'est la cause
// identifiée de la lenteur 2-3s). Même pattern que PageClientStats.tsx : useQuery
// avec staleTime généreux, cache par clé, pas de Promise.all bloquant global.
async function fetchClientDetail(clientId: string): Promise<ClientDetailData | null> {
  const supabase = createSupabase();
  const [clientRes, tasksRes] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('tasks').select('*').eq('client_id', clientId).order('created_at', { ascending: true }),
  ]);
  if (clientRes.error || !clientRes.data) return null;
  let avatarUrl: string | null = null;
  if (clientRes.data.profile_id) {
    const { data: profile } = await supabase.from('profiles').select('avatar_url').eq('id', clientRes.data.profile_id).single();
    avatarUrl = profile?.avatar_url ?? null;
  }
  return { ...clientRes.data, tasks: tasksRes.data || [], avatar_url: avatarUrl };
}

// Calls de vente (call_type='calendly') d'un élève — calls.client_id n'étant pas
// fiable pour ce cas, la route filtre par calls.coach_id = client.profile_id
// (piège documenté dans docs/calls-coach-id-piege.md), en service-role côté serveur.
async function fetchSalesCalls(clientId: string): Promise<Call[]> {
  const res = await fetch(`/api/coach/clients/${clientId}/sales-calls`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.calls || [];
}

async function fetchStoriesCount(profileId: string, since: string | null): Promise<number> {
  const supabase = createSupabase();
  let query = supabase.from('ig_stories').select('id', { count: 'exact', head: true }).eq('profile_id', profileId);
  if (since) query = query.gte('posted_at', since);
  const { count } = await query;
  return count ?? 0;
}

// fetchAllLeadsCount (lib/salesCallStats.ts) fait ce calcul — voir
// docs/pipeline-leads-ig-sources.md pour le détail des sources cumulées.

interface ResourceForClient {
  id: string;
  title: string;
  type: string | null;
}

interface DepotComment {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  author: { full_name: string | null; role: string } | null;
}

interface DepotFile {
  id: string;
  file_name: string;
  file_type: string | null;
  created_at: string;
  uploader_id: string;
  uploader: { full_name: string | null; role: string } | null;
  signed_url: string | null;
  comments: DepotComment[];
}

// Remplace la valeur d'une carte KPI tant que les 8 KPI n'ont pas TOUS fini de
// charger — évite l'effet de saut (0 puis vraie valeur, cartes qui apparaissent
// l'une après l'autre) : tout le bloc s'affiche d'un coup une fois prêt.
function KpiSkeleton() {
  return (
    <>
      <div className="skeleton-shimmer" style={{ height: 26, width: '55%', borderRadius: 4, marginTop: 2 }} />
      <div className="skeleton-shimmer" style={{ height: 11, width: '75%', borderRadius: 4, marginTop: 6 }} />
    </>
  );
}

function ClientResourcesPanel({ clientProfileId, coachId }: { clientProfileId: string; coachId: string }) {
  const supabase = createSupabase();
  const [resources, setResources] = useState<ResourceForClient[]>([]);
  const [accessMap, setAccessMap] = useState<Record<string, boolean>>({});
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [resourcesRes, accessRes] = await Promise.all([
      supabase.from('resources').select('id, title, type').eq('coach_id', coachId).order('position'),
      supabase.from('resource_access').select('resource_id, unlocked').eq('client_id', clientProfileId),
    ]);
    if (resourcesRes.error || accessRes.error) {
      setError('Erreur de chargement des ressources');
      setLoading(false);
      return;
    }
    setResources(resourcesRes.data || []);
    const map: Record<string, boolean> = {};
    for (const row of accessRes.data || []) map[row.resource_id] = row.unlocked;
    setAccessMap(map);
    setLoading(false);
  }, [clientProfileId, coachId]);

  useEffect(() => { load(); }, [load]);

  async function toggleAccess(resourceId: string) {
    setToggling(t => ({ ...t, [resourceId]: true }));
    setError(null);
    const current = accessMap[resourceId] ?? false;
    const newVal = !current;
    const { error: upsertErr } = await supabase.from('resource_access').upsert({
      resource_id: resourceId,
      client_id: clientProfileId,
      unlocked: newVal,
      unlocked_at: newVal ? new Date().toISOString() : null,
    }, { onConflict: 'resource_id,client_id' });
    if (upsertErr) {
      setError("Erreur — l'accès n'a pas pu être modifié");
      setToggling(t => ({ ...t, [resourceId]: false }));
      return;
    }
    if (newVal) await supabase.from('resources').update({ is_new: true }).eq('id', resourceId);
    setAccessMap(prev => ({ ...prev, [resourceId]: newVal }));
    setToggling(t => ({ ...t, [resourceId]: false }));
  }

  const TYPE_ICON: Record<string, IconName> = { link: 'link', file: 'folder', video: 'play' };
  const TYPE_COLOR: Record<string, string> = { link: 'var(--accent-brand)', file: 'var(--amber)', video: 'var(--red)' };
  const unlockedCount = Object.values(accessMap).filter(Boolean).length;

  if (loading) return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 0' }}>Chargement des ressources…</div>;
  if (error && resources.length === 0) return (
    <div style={{ fontSize: 13, color: 'var(--red)', padding: '16px 0' }}>{error}</div>
  );
  if (resources.length === 0) return (
    <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 0' }}>
      Aucune ressource créée. Crée des ressources depuis la page <Link href="/ressources" style={{ color: 'var(--accent)' }}>Ressources</Link>.
    </div>
  );

  return (
    <div>
      {error && (
        <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        {unlockedCount}/{resources.length} ressource{resources.length !== 1 ? 's' : ''} débloquée{unlockedCount !== 1 ? 's' : ''} pour cet élève
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {resources.map(r => {
          const isOn = accessMap[r.id] ?? false;
          const isToggling = toggling[r.id];
          const color = TYPE_COLOR[r.type || 'link'] || '#888';
          return (
            <button
              key={r.id}
              type="button"
              disabled={isToggling}
              onClick={() => toggleAccess(r.id)}
              title={isOn ? 'Cliquer pour retirer l\'accès' : 'Cliquer pour donner l\'accès'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 20,
                border: `1.5px solid ${isOn ? 'var(--green)' : 'var(--border)'}`,
                background: isOn ? 'rgba(63,138,82,0.08)' : 'var(--surface-2)',
                cursor: isToggling ? 'default' : 'pointer',
                opacity: isToggling ? 0.6 : 1,
                transition: 'border-color 180ms, background 180ms',
                fontSize: 12, fontWeight: isOn ? 600 : 400,
                color: isOn ? 'var(--green)' : 'var(--muted)',
                maxWidth: 180,
              }}
            >
              <Icon
                name={TYPE_ICON[r.type || 'link'] || 'link'}
                size={11}
                style={{ color: isOn ? 'var(--green)' : color, flexShrink: 0 }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.title}
              </span>
              {isOn && <Icon name="check" size={10} style={{ color: 'var(--green)', flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const PRIORITY_CONFIG = {
  high:   { label: 'Haute',   color: 'var(--red)',   bg: '#ef444420' },
  medium: { label: 'Moyenne', color: 'var(--amber)', bg: 'var(--amber-soft)' },
  low:    { label: 'Basse',   color: 'var(--green)', bg: '#22c55e20' },
};

interface Props { id: string }

export default function PageClientDetail({ id }: Props) {
  const queryClient = useQueryClient();

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ['client-detail', id],
    queryFn: () => fetchClientDetail(id),
    staleTime: 60 * 1000,
  });
  // Calls de coaching (call_type='google') et rapports de session sont filtrés par
  // client_id, fiable pour ce cas : un call de coaching est toujours booké après
  // que l'élève ait déjà un compte (contrairement aux calls de vente, cf.
  // fetchSalesCalls plus bas et docs sur calls.client_id).
  const { data: calls = [], isLoading: callsLoading } = useQuery({
    queryKey: ['client-detail-calls', id],
    queryFn: async () => {
      const supabase = createSupabase();
      const { data } = await supabase.from('calls').select(CALL_COLUMNS).eq('client_id', id).order('scheduled_at', { ascending: false });
      return data || [];
    },
    staleTime: 60 * 1000,
  });
  const { data: salesCallsData = [], isLoading: salesCallsLoading } = useQuery({
    queryKey: ['client-sales-calls', id],
    queryFn: () => fetchSalesCalls(id),
    staleTime: 60 * 1000,
  });
  function refetchClient() {
    queryClient.invalidateQueries({ queryKey: ['client-detail', id] });
  }
  function refetchCalls() {
    queryClient.invalidateQueries({ queryKey: ['client-detail-calls', id] });
    queryClient.invalidateQueries({ queryKey: ['client-sales-calls', id] });
  }

  const allTasks = client?.tasks || [];
  const tasks = allTasks.filter(t => !t.resolved_by_coach);
  const resolvedTasks = allTasks.filter(t => t.resolved_by_coach);
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteError, setNoteError] = useState(false);

  // client arrive après le premier render (useQuery async) — synchronise l'état
  // local une fois la donnée chargée, sans écraser une saisie déjà en cours.
  const noteInitialized = useRef(false);
  useEffect(() => {
    if (client && !noteInitialized.current) {
      setNote(client.private_notes || '');
      noteInitialized.current = true;
    }
  }, [client]);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [taskHistoryOpen, setTaskHistoryOpen] = useState(false);
  const [activeTasksExpanded, setActiveTasksExpanded] = useState(false);
  const { user } = useUser();
  const [depotFiles, setDepotFiles] = useState<DepotFile[]>([]);
  const [depotLoading, setDepotLoading] = useState(true);
  const [depotUploading, setDepotUploading] = useState(false);
  const [depotError, setDepotError] = useState<string | null>(null);
  const [depotCommentDrafts, setDepotCommentDrafts] = useState<Record<string, string>>({});
  const [depotCommentSending, setDepotCommentSending] = useState<Record<string, boolean>>({});
  const [depotConfirmDelete, setDepotConfirmDelete] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDepotFiles = useCallback(async () => {
    setDepotLoading(true);
    setDepotError(null);
    const res = await fetch(`/api/clients/${id}/depot-files`);
    if (!res.ok) { setDepotError('Erreur de chargement des fichiers'); setDepotLoading(false); return; }
    const data = await res.json();
    setDepotFiles(data.files || []);
    setDepotLoading(false);
  }, [id]);

  useEffect(() => { loadDepotFiles(); }, [loadDepotFiles]);

  async function uploadDepotFiles(files: File[]) {
    setDepotUploading(true);
    setDepotError(null);
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/clients/${id}/depot-files`, { method: 'POST', body: form });
      if (!res.ok) { setDepotError("Erreur — le fichier n'a pas pu être déposé"); continue; }
      const data = await res.json();
      setDepotFiles(prev => [data.file, ...prev]);
    }
    setDepotUploading(false);
  }

  async function sendDepotComment(fileId: string) {
    const text = (depotCommentDrafts[fileId] || '').trim();
    if (!text) return;
    setDepotCommentSending(s => ({ ...s, [fileId]: true }));
    const res = await fetch(`/api/depot-files/${fileId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const data = await res.json();
      setDepotFiles(prev => prev.map(f => f.id === fileId ? { ...f, comments: [...f.comments, data.comment] } : f));
      setDepotCommentDrafts(d => ({ ...d, [fileId]: '' }));
    } else {
      setDepotError("Erreur — le commentaire n'a pas pu être envoyé");
    }
    setDepotCommentSending(s => ({ ...s, [fileId]: false }));
  }

  async function deleteDepotFile(fileId: string, force: boolean) {
    const res = await fetch(`/api/depot-files/${fileId}${force ? '?force=true' : ''}`, { method: 'DELETE' });
    if (res.status === 409) {
      setDepotConfirmDelete(fileId);
      return;
    }
    if (!res.ok) { setDepotError("Erreur — le fichier n'a pas pu être supprimé"); return; }
    setDepotFiles(prev => prev.filter(f => f.id !== fileId));
    setDepotConfirmDelete(null);
  }

  async function deleteDepotComment(fileId: string, commentId: string) {
    const res = await fetch(`/api/depot-files/${fileId}/comments/${commentId}`, { method: 'DELETE' });
    if (!res.ok) { setDepotError("Erreur — le commentaire n'a pas pu être supprimé"); return; }
    setDepotFiles(prev => prev.map(f => f.id === fileId ? { ...f, comments: f.comments.filter(c => c.id !== commentId) } : f));
  }

  // Rapport de fin d'appel coach-élève (Google Meet)
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessionRapportCallId, setSessionRapportCallId] = useState<string | null>(null);
  const [editingReport, setEditingReport] = useState<SessionReport | null>(null);
  const [sessionReports, setSessionReports] = useState<SessionReport[]>([]);
  const deepLinkHandled = useRef(false);

  // Modale de consultation (rapport déjà rempli + infos Fathom) — jamais de formulaire.
  const [infosModalReport, setInfosModalReport] = useState<SessionReport | null>(null);
  // Même modale, mais pour un call avec replay Fathom sans rapport de session rempli
  // (ex. cron de rattrapage arrivé avant que le coach n'ait rapporté le call).
  const [infosModalCall, setInfosModalCall] = useState<Call | null>(null);

  const clientCalls = calls.filter(c => c.client_id === id);
  const pendingSessionRapports = getPendingSessionRapports(clientCalls);

  const loadSessionReports = useCallback(async () => {
    const supabase = createSupabase();
    const { data } = await supabase
      .from('session_reports')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false });
    setSessionReports(data || []);
  }, [id]);

  useEffect(() => { loadSessionReports(); }, [loadSessionReports]);

  // Deep link : ?session-rapport=<call_id> → ouvre la modal une seule fois (depuis push notif)
  useEffect(() => {
    const callId = searchParams.get('session-rapport');
    if (!callId || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    setSessionRapportCallId(callId);
  }, [searchParams]);

  function closeSessionRapportModal() {
    setSessionRapportCallId(null);
    setEditingReport(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('session-rapport');
    router.replace(url.pathname + url.search, { scroll: false });
    loadSessionReports();
  }

  const sessionRapportCall = pendingSessionRapports.find(c => c.id === sessionRapportCallId)
    || clientCalls.find(c => c.id === sessionRapportCallId)
    || null;

  // 8 KPI all-time — mêmes queryKey que PageClientStats.tsx (stats-ig/stats-yt)
  // pour bénéficier du cache déjà chaud si le coach vient de visiter la page
  // Analytics du même élève.
  const profileId = client?.profile_id ?? undefined;

  // Point de départ "all-time" = création réelle du compte Momentum de l'élève
  // (moment où il choisit son mot de passe, cf. app/invite/callback/page.tsx),
  // pas la connexion d'un provider externe (IG/YT) — remplace l'ancien
  // connectedAt/fetchConnectedAt sur demande explicite de Chris.
  const sinceAccountCreated = client?.onboarding_completed_at ?? null;

  const { data: igRaw, isLoading: igLoading } = useQuery({
    queryKey: ['stats-ig', profileId],
    queryFn: () => fetch(`/api/instagram/stats?profileId=${profileId}`).then(r => r.ok ? r.json() : null),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const { data: ytRaw, isLoading: ytLoading } = useQuery({
    queryKey: ['stats-yt', profileId],
    queryFn: () => fetch(`/api/youtube/stats?profileId=${profileId}`).then(r => r.ok ? r.json() : null),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const { data: stripeRaw, isLoading: stripeLoading } = useQuery({
    queryKey: ['stats-stripe', profileId],
    queryFn: () => fetch(`/api/stripe/client-data?profileId=${profileId}`).then(r => r.ok ? r.json() : null),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const { data: storiesCount, isLoading: storiesLoading } = useQuery({
    queryKey: ['client-stories-count', profileId, sinceAccountCreated],
    queryFn: () => fetchStoriesCount(profileId!, sinceAccountCreated),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const { data: leadsTotalCount, isLoading: igLeadsLoading } = useQuery({
    queryKey: ['client-all-leads-count', profileId, sinceAccountCreated],
    queryFn: () => fetchAllLeadsCount(createSupabase(), profileId!, sinceAccountCreated),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  // Deals de l'élève — source du cash contracté ET collecté. Remplace la somme de
  // calls.revenue, qui ne voyait que les deals nés d'un call (donc ni les upsells
  // ni les ventes hors pipeline) et n'avait aucune notion d'encaissement réel.
  const { data: dealsForStats } = useQuery({
    queryKey: ['client-deals-stats', profileId],
    queryFn: () => fetchDealsForStats(createSupabase(), profileId!),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });

  // Statut des 7 intégrations obligatoires — lecture seule côté coach (plus de
  // waiver possible, voir docs/integrations-ready-at-vs-onboarding-completed-at.md).
  const { data: clientIntegrations } = useQuery({
    queryKey: ['client-integrations-status', profileId],
    queryFn: async () => {
      const supabase = createSupabase();
      const { data } = await supabase.from('integrations').select('provider, status').eq('profile_id', profileId!);
      return data ?? [];
    },
    enabled: !!profileId,
    staleTime: 60 * 1000,
  });

  // Un seul flag pour les 8 KPI — tout le bloc apparaît d'un coup une fois prêt,
  // plutôt que carte par carte au fur et à mesure que chaque requête résout.
  const kpiLoading = igLoading || ytLoading || storiesLoading || igLeadsLoading || stripeLoading
    || callsLoading || salesCallsLoading;

  if (!client && clientLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>
  );

  if (!client) return (
    <div className="page-content">
      <div className="page-header"><h1 className="page-title">Client introuvable</h1></div>
    </div>
  );

  // ── 8 KPI all-time (funnel de vente de l'élève, résumé global) ──────────────
  // Calls de vente = call_type='calendly' uniquement (jamais 'google', réservé au
  // coaching) — bug identifié sur l'ancien calls30 qui ne filtrait pas du tout par
  // call_type. Statuts annulés exclus des deux côtés (vente et coaching). Source :
  // fetchSalesCalls (route API, filtrée par coach_id = profile_id de l'élève,
  // cf. docs/calls-coach-id-piege.md). Calcul partagé avec la liste clients via
  // lib/salesCallStats.ts pour éviter toute divergence entre les deux vues.
  const now = new Date();
  const { callsBookedCount, callsHonoredCount, dealsClosedCount, closingRate, cashContracted, cashCollected } = computeSalesCallStats(salesCallsData, now, dealsForStats);
  const showUpRate = callsBookedCount > 0 ? Math.round((callsHonoredCount / callsBookedCount) * 100) : 0;
  const revenuePerCall = callsBookedCount > 0 ? Math.round(cashContracted / callsBookedCount) : 0;

  // Leads totaux = fetchAllLeadsCount (Instagram + YouTube), calculé plus haut — même
  // fonction que l'accueil élève et Mes Stats, pour un chiffre garanti identique.
  const leadsTotal = leadsTotalCount ?? 0;

  const postsIg = igRaw?.posts?.length ?? null;
  const postsYt = ytRaw?.videos?.length ?? null;
  const publicationsTotal = (postsIg ?? 0) + (postsYt ?? 0) + (storiesCount ?? 0);
  const followersTotal = (igRaw?.followers ?? 0) + (ytRaw?.subscribers ?? 0);


  // ── Suivi de l'accompagnement (coaching, distinct du funnel de vente ci-dessus) ──
  const coachingCalls = calls.filter(c => c.call_type === 'google' && isNotCanceled(c));
  const coachingCallsCount = coachingCalls.length;
  // session_no_show (pas no_show, réservé au flux vente) — rempli par SessionRapportModal.
  const coachingNoShowCount = coachingCalls.filter(c => c.session_no_show).length;
  const nextCoachingCall = coachingCalls
    .filter(c => c.status === 'active' && c.scheduled_at && new Date(c.scheduled_at) > now)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0] ?? null;

  const completedTasksAll = allTasks.filter(t => t.done);
  const tasksOnTimeCount = completedTasksAll.filter(t => t.completed_at && t.deadline && new Date(t.completed_at) <= new Date(t.deadline)).length;
  const tasksLateCount = completedTasksAll.filter(t => t.completed_at && t.deadline && new Date(t.completed_at) > new Date(t.deadline)).length;

  const doneCount = tasks.filter(t => t.done).length;
  const progress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  // Tâches en cours triées par urgence : en retard toujours en premier, puis
  // deadline croissante (deadline nulle en dernier) — même pattern que
  // PageTasks.tsx:222-226, réutilisé plutôt que réinventé. 3 affichées par défaut,
  // "voir plus" étend à la liste complète.
  const activeTasksSorted = [...tasks.filter(t => !t.done)].sort((a, b) => {
    const aOverdue = isTaskOverdue(a);
    const bOverdue = isTaskOverdue(b);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });
  const activeTasksVisible = activeTasksExpanded ? activeTasksSorted : activeTasksSorted.slice(0, 3);
  const doneTasksAll = tasks.filter(t => t.done);
  const doneTasksVisible = doneTasksAll.slice(0, 2);

  // Update optimiste sur le cache React Query local (pas le state global du
  // portefeuille) — même principe que l'ancien toggleTask du contexte (annulé si
  // l'écriture échoue), mais scopé à ce seul client. completed_at posé/retiré ici
  // (pas dans la route API tasks/[id], utilisée par l'élève) car c'est l'action
  // coach qui déclenche ce toggle direct sur Supabase.
  async function toggleTask(taskId: string, done: boolean) {
    const completedAt = done ? new Date().toISOString() : null;
    queryClient.setQueryData(['client-detail', id], (prev: ClientDetailData | null | undefined) =>
      prev ? { ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, done, completed_at: completedAt } : t) } : prev
    );
    const supabase = createSupabase();
    const { error } = await supabase.from('tasks').update({ done, completed_at: completedAt }).eq('id', taskId);
    if (error) refetchClient();
  }

  async function resolveTask(taskId: string) {
    setTaskActionError(null);
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved_by_coach: true }),
    });
    if (!res.ok) { setTaskActionError('Erreur — la tâche n\'a pas pu être résolue'); return; }
    refetchClient();
  }

  async function acknowledgeNoShow(reportId: string) {
    setTaskActionError(null);
    const res = await fetch(`/api/session-reports/${reportId}/acknowledge`, { method: 'PATCH' });
    if (!res.ok) { setTaskActionError('Erreur — l\'action n\'a pas pu être enregistrée'); return; }
    loadSessionReports();
  }

  async function saveNote() {
    setNoteSaving(true);
    setNoteError(false);
    const supabase = createSupabase();
    const { error } = await supabase.from('clients').update({ private_notes: note }).eq('id', id);
    setNoteSaving(false);
    if (error) { setNoteError(true); return; }
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  }

  async function handleArchive() {
    setArchiving(true);
    const supabase = createSupabase();
    const { error } = await supabase.from('clients').update({ archived_at: new Date().toISOString() }).eq('id', id);
    setArchiving(false);
    if (!error) router.push('/clients');
  }

  async function confirmArchive() {
    setShowArchiveModal(false);
    await handleArchive();
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError('');
    const res = await fetch(`/api/coach/clients/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Erreur inconnue' }));
      setDeleteError(error);
      setDeleting(false);
      return;
    }
    router.push('/clients');
  }

  return (
    <div className="page-content">
      {taskActionError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--red-soft, rgba(205,91,63,0.14))', color: 'var(--red)', borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
          <Icon name="alert" size={14} style={{ flexShrink: 0 }} />
          {taskActionError}
        </div>
      )}
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar initials={client.initials || getInitials(client.name)} avatarUrl={client.avatar_url} size={48} seed={client.id} />
          <div>
            <h1 className="page-title" style={{ marginBottom: 4 }}>{client.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{client.niche || 'Niche non définie'}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>· Semaine {getClientWeek(client.onboarding_completed_at)}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/clients/${id}/analytics`} className="btn-primary-brand">
            <Icon name="bar-chart" size={14} /> Stats Clients
          </Link>
        </div>
      </div>

      {showArchiveModal && (
        <ModalShell onClose={() => !archiving && setShowArchiveModal(false)} width={440}>
          <div style={{ padding: '28px 28px 24px' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>
              Archiver {client.name} ?
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>
              Cet élève ne sera plus visible dans ta liste d'élèves à suivre. Rien n'est supprimé :
              son historique (appels, tâches, rapports, ressources, statistiques) reste intact, et il
              garde un accès normal à son propre espace. Tu pourras le désarchiver à tout moment
              depuis « Voir les archivés ».
            </p>
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
              padding: '12px 14px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)',
              marginBottom: 18,
            }}>
              <input
                type="checkbox"
                checked={archiveConfirmed}
                onChange={e => setArchiveConfirmed(e.target.checked)}
                style={{ marginTop: 1, width: 15, height: 15, cursor: 'pointer', flexShrink: 0, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 13, color: 'var(--accent)', lineHeight: 1.4 }}>
                Je comprends que cet élève sortira de ma liste active tant que je ne le désarchive pas.
              </span>
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setShowArchiveModal(false)} disabled={archiving} className="btn-ghost" style={{ fontSize: 13 }}>
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmArchive}
                disabled={!archiveConfirmed || archiving}
                className="btn-primary-brand"
                style={{ fontSize: 13, opacity: archiveConfirmed ? 1 : 0.5, cursor: archiveConfirmed ? 'pointer' : 'not-allowed' }}
              >
                {archiving ? 'Archivage…' : 'Archiver'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {showDeleteModal && (
        <ModalShell onClose={() => !deleting && setShowDeleteModal(false)} width={460}>
          <div style={{ padding: '28px 28px 24px' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>
              Supprimer {client.name} ?
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>
              Cette action est <strong>irréversible</strong>. Seront supprimés définitivement :
              tous les appels, messages, tâches, rapports de session, fichiers déposés, statistiques
              hebdomadaires, accès aux ressources — et le compte de connexion de l'élève s'il en a un.
              Rien de tout cela ne pourra être récupéré.
            </p>
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
              padding: '12px 14px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)',
              marginBottom: 18,
            }}>
              <input
                type="checkbox"
                checked={deleteConfirmed}
                onChange={e => setDeleteConfirmed(e.target.checked)}
                style={{ marginTop: 1, width: 15, height: 15, cursor: 'pointer', flexShrink: 0, accentColor: 'var(--red)' }}
              />
              <span style={{ fontSize: 13, color: 'var(--accent)', lineHeight: 1.4 }}>
                Je comprends que cette suppression est définitive et que tout l'historique de cet élève sera perdu.
              </span>
            </label>
            {deleteError && (
              <div style={{ fontSize: 12, color: 'var(--red)', padding: '7px 10px', background: 'var(--red-soft)', borderRadius: 6, marginBottom: 14 }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setShowDeleteModal(false)} disabled={deleting} className="btn-ghost" style={{ fontSize: 13 }}>
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!deleteConfirmed || deleting}
                style={{
                  fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: 'var(--red)', color: '#fff', cursor: deleteConfirmed ? 'pointer' : 'not-allowed',
                  opacity: deleteConfirmed ? 1 : 0.5,
                }}
              >
                {deleting ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* 8 KPI all-time — funnel de vente de l'élève, résumé global (le détail par
          plateforme/contenu reste dans la page Analytics complète, cf. bouton
          "Analytics" ci-dessus). Zéro divergence de calcul visée avec cette page :
          mêmes filtres call_type, même isCallHonored, même dénominateur revenu/call.
          Regroupés en 3 sections (Audience / Funnel de vente / Revenu) plutôt qu'une
          grille plate de 8 cards identiques — même ordre qu'avant, juste segmenté. */}
      <div style={{ marginBottom: 24 }}>
        <div className="kpi-group">
          <div className="kpi-group-title">Audience</div>
          <div className="grid-2">
            <div className="card kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label">Abonnés</div>
              {kpiLoading ? <KpiSkeleton /> : (
                <>
                  <div className="kpi-value">{followersTotal.toLocaleString('fr-FR')}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>IG {(igRaw?.followers ?? 0).toLocaleString('fr-FR')} · YT {(ytRaw?.subscribers ?? 0).toLocaleString('fr-FR')}</div>
                </>
              )}
            </div>
            <div className="card kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label">Publications</div>
              {kpiLoading ? <KpiSkeleton /> : (
                <>
                  <div className="kpi-value">{publicationsTotal}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>IG {postsIg ?? 0} · YT {postsYt ?? 0} · Stories {storiesCount ?? 0}</div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="kpi-group">
          <div className="kpi-group-title">Funnel de vente</div>
          <div className="grid-4">
            <div className="card kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label">Leads totaux</div>
              {kpiLoading ? <KpiSkeleton /> : (
                <>
                  <div className="kpi-value">{leadsTotal}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>depuis inscription</div>
                </>
              )}
            </div>
            <div className="card kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label">Calls bookés</div>
              {kpiLoading ? <KpiSkeleton /> : (
                <>
                  <div className="kpi-value">{callsBookedCount}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>depuis inscription</div>
                </>
              )}
            </div>
            <div className="card kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label">Taux de show-up</div>
              {kpiLoading ? <KpiSkeleton /> : (
                <>
                  <div className="kpi-value">{showUpRate}%</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{callsHonoredCount}/{callsBookedCount} calls</div>
                </>
              )}
            </div>
            <div className="card kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label">Taux de closing</div>
              {kpiLoading ? <KpiSkeleton /> : (
                <>
                  <div className="kpi-value">{closingRate}%</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{dealsClosedCount}/{callsHonoredCount} calls honorés</div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="kpi-group" style={{ marginBottom: 0 }}>
          <div className="kpi-group-title">Revenu</div>
          <div className="grid-2">
            <div className="card kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label">Cash contracté</div>
              {kpiLoading ? <KpiSkeleton /> : (
                <>
                  <div className="kpi-value">{cashContracted.toLocaleString('fr-FR')} €</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{cashCollected != null ? `${cashCollected.toLocaleString('fr-FR')} € collecté` : 'collecté : —'}</div>
                </>
              )}
            </div>
            <div className="card kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label">Revenu par call</div>
              {kpiLoading ? <KpiSkeleton /> : (
                <>
                  <div className="kpi-value">{revenuePerCall.toLocaleString('fr-FR')} €</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>par call booké</div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {modalOpen && (
          <TaskModal clientId={id} onClose={() => setModalOpen(false)} onCreated={refetchClient} />
        )}
      </AnimatePresence>
      {sessionRapportCallId && (
        <SessionRapportModal
          callId={sessionRapportCallId}
          studentName={client.name}
          scheduledAt={sessionRapportCall?.scheduled_at ?? null}
          onClose={closeSessionRapportModal}
          editInitial={editingReport ? {
            topic: editingReport.topic as any,
            topicCustom: editingReport.topic_custom ?? '',
            notes: editingReport.notes ?? '',
          } : undefined}
        />
      )}

      {infosModalReport && (() => {
        const call = calls.find(c => c.id === infosModalReport.call_id);
        return (
          <CallInfosModal
            counterpartName={client.name}
            scheduledAt={call?.scheduled_at ?? null}
            attended={infosModalReport.attended}
            topic={infosModalReport.topic as any}
            topicCustom={infosModalReport.topic_custom}
            notes={infosModalReport.notes}
            studentNotes={infosModalReport.student_notes}
            fathomData={{
              shareUrl: call?.fathom_share_url ?? null,
              summary: call?.fathom_summary ?? null,
              actionItems: call?.fathom_action_items ?? null,
              // Transcript chargé à la demande au clic — voir CALL_COLUMNS.
              transcript: null,
              callId: call?.id ?? null,
              hasTranscript: (call as { has_fathom_transcript?: boolean } | undefined)?.has_fathom_transcript === true,
            }}
            onClose={() => setInfosModalReport(null)}
          />
        );
      })()}

      {infosModalCall && (
        <CallInfosModal
          counterpartName={client.name}
          scheduledAt={infosModalCall.scheduled_at}
          fathomData={{
            shareUrl: infosModalCall.fathom_share_url ?? null,
            summary: infosModalCall.fathom_summary ?? null,
            actionItems: infosModalCall.fathom_action_items ?? null,
            // Transcript chargé à la demande au clic — voir CALL_COLUMNS.
            transcript: null,
            callId: infosModalCall.id,
            hasTranscript: (infosModalCall as { has_fathom_transcript?: boolean }).has_fathom_transcript === true,
          }}
          onClose={() => setInfosModalCall(null)}
        />
      )}

      {taskHistoryOpen && (
        <ModalShell onClose={() => setTaskHistoryOpen(false)} width={480}>
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', margin: 0 }}>Historique des tâches terminées</h2>
              <button type="button" onClick={() => setTaskHistoryOpen(false)} className="icon-btn">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '60vh', overflowY: 'auto' }}>
              {tasks.filter(t => t.done).map(task => (
                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
                  <div className="task-check checked" style={{ flexShrink: 0 }}>
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--muted)', textDecoration: 'line-through' }}>{task.label}</span>
                </div>
              ))}
            </div>
          </div>
        </ModalShell>
      )}

      {pendingSessionRapports.length > 0 && (
        <div className="card" style={{ marginBottom: 24, borderColor: 'var(--amber)', background: 'var(--amber-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="phone-call" size={16} style={{ color: 'var(--amber)' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                {pendingSessionRapports.length} rapport{pendingSessionRapports.length > 1 ? 's' : ''} de session en attente
              </span>
            </div>
            <button
              type="button"
              className="btn-primary-brand"
              onClick={() => setSessionRapportCallId(pendingSessionRapports[0].id)}
            >
              Remplir le rapport
            </button>
          </div>
        </div>
      )}

      <div className="grid-2">
        {/* Tâches à effectuer */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Tâches à effectuer</div>
              <div className="card-sub">{doneCount}/{tasks.length} tâches complétées</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Ring value={progress} size={44} stroke={4} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', minWidth: 32 }}>{progress}%</span>
              <button className="btn-primary-brand" type="button" onClick={() => setModalOpen(true)} style={{ fontSize: 12, padding: '6px 12px', gap: 5 }}>
                <Icon name="plus" size={12} /> Ajouter
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
            {activeTasksVisible.map(task => {
              const prio = task.priority ? PRIORITY_CONFIG[task.priority] : null;
              const overdue = isTaskOverdue(task);
              return (
                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 10, border: `1px solid ${overdue ? 'var(--red)' : 'var(--border)'}` }}>
                  <div
                    className="task-check"
                    onClick={() => toggleTask(task.id, true)}
                    role="checkbox" aria-checked={false} tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(task.id, true); } }}
                    style={{ flexShrink: 0 }}
                  />
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--accent)' }}>{task.label}</span>
                  {task.meta && <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{task.meta}</span>}
                  <DeadlineBadge deadline={task.deadline} done={false} />
                  {prio && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: prio.bg, color: prio.color, flexShrink: 0 }}>
                      {prio.label}
                    </span>
                  )}
                  {overdue && (
                    <button type="button" onClick={() => resolveTask(task.id)} className="btn-ghost" style={{ fontSize: 11, flexShrink: 0 }}>
                      Résoudre
                    </button>
                  )}
                </div>
              );
            })}
            {activeTasksSorted.length > 3 && (
              <button
                type="button"
                onClick={() => setActiveTasksExpanded(v => !v)}
                style={{ fontSize: 11, color: 'var(--accent-brand)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0', textAlign: 'left' }}
              >
                {activeTasksExpanded ? 'Voir moins' : `Voir plus (${activeTasksSorted.length - 3})`}
              </button>
            )}
            {activeTasksSorted.length === 0 && tasks.length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--green)', padding: '8px 0' }}>✓ Toutes les tâches sont terminées !</div>
            )}
            {tasks.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucune tâche · cliquez sur "Ajouter"</div>
            )}
            {doneTasksAll.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>TERMINÉES ({doneTasksAll.length})</span>
                  {doneTasksAll.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setTaskHistoryOpen(true)}
                      style={{ fontSize: 11, color: 'var(--accent-brand)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                    >
                      Voir tout l&apos;historique
                    </button>
                  )}
                </div>
                {doneTasksVisible.map(task => (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', opacity: 0.55 }}>
                    <div
                      className="task-check checked"
                      onClick={() => toggleTask(task.id, false)}
                      role="checkbox" aria-checked={true} tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(task.id, false); } }}
                      style={{ flexShrink: 0 }}
                    >
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)', textDecoration: 'line-through' }}>{task.label}</span>
                  </div>
                ))}
              </div>
            )}
            {resolvedTasks.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setResolvedExpanded(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}
                >
                  <Icon name={resolvedExpanded ? 'chevron-up' : 'chevron-down'} size={11} />
                  TÂCHES ANNULÉES ({resolvedTasks.length})
                </button>
                {resolvedExpanded && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {resolvedTasks.map(task => (
                      <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', opacity: 0.55 }}>
                        <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>{task.label}</span>
                        {task.resolved_at && (
                          <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
                            Annulée le {new Date(task.resolved_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Suivi de l'accompagnement — coaching (distinct du funnel de vente des
            8 KPI ci-dessus). client_since/next_call/iclosed_rate/calendly_monthly/
            momentum_score retirés : colonnes DB jamais recalculées par aucun code
            (données mortes), iclosed_rate faisait doublon non synchronisé avec le
            Taux de closing, momentum_score n'a aucune formule de calcul définie. */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Suivi de l'accompagnement</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="calendar" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Client depuis</span>
              <strong>{sinceAccountCreated ? `${Math.floor((now.getTime() - new Date(sinceAccountCreated).getTime()) / 86400000)}j` : '—'}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="phone-call" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Prochain call</span>
              <strong>{nextCoachingCall?.scheduled_at ? new Date(nextCoachingCall.scheduled_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'Non planifié'}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="phone-call" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Calls coaching</span>
              <strong>{coachingCallsCount}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="target" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>No-show coaching</span>
              <strong style={{ color: coachingNoShowCount > 0 ? 'var(--amber)' : 'var(--green)' }}>{coachingNoShowCount}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="calendar" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Tâches à temps / en retard</span>
              <strong><span style={{ color: 'var(--green)' }}>{tasksOnTimeCount}</span> / <span style={{ color: 'var(--red)' }}>{tasksLateCount}</span></strong>
            </div>
          </div>
        </div>
      </div>

      {/* Ressources débloquées */}
      {client.profile_id && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-head">
            <div>
              <div className="card-title">Ressources</div>
              <div className="card-sub">Gérer les accès de cet élève</div>
            </div>
            <Link href="/ressources" className="btn-ghost" style={{ fontSize: 12 }}>
              <Icon name="folder" size={13} /> Toutes les ressources
            </Link>
          </div>
          <div style={{ marginTop: 16 }}>
            <ClientResourcesPanel clientProfileId={client.profile_id} coachId={client.coach_id} />
          </div>
        </div>
      )}

      {/* Notes privées */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div className="card-title">Notes privées</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)' }}>
            <Icon name="lock" size={12} /> Visible coach uniquement
          </div>
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Notes confidentielles sur cet élève…"
          style={{ width: '100%', minHeight: 120, marginTop: 16, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--accent)', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
        />
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: noteError ? 'var(--red)' : 'var(--muted)' }}>
            {noteError ? 'Erreur — non sauvegardé' : `${note.length} car.`}
          </span>
          <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={saveNote} disabled={noteSaving}>
            {noteSaved ? '✓ Sauvegardé' : noteSaving ? 'Enregistrement…' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      {/* Rapports de fin d'appel de Coaching (calls Google Meet coach-élève) — rapports
          remplis et calls en attente fusionnés dans une seule timeline triée par date
          réelle (scheduled_at pour un call en attente, created_at pour un rapport rempli),
          plutôt que deux blocs empilés qui reléguaient les calls récents sans rapport
          tout en bas, hors de l'ordre chronologique attendu. Style visuel de chaque
          entrée inchangé (ambre pour "en attente", neutre pour rempli). */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div className="card-title">Rapports de fin d'appel de Coaching</div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sessionReports.length === 0 && pendingSessionRapports.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucune session rapportée pour l'instant.</div>
          )}
          {[
            ...sessionReports.map(report => ({ type: 'report' as const, date: report.created_at, report })),
            ...pendingSessionRapports.map(call => ({ type: 'pending' as const, date: call.scheduled_at || call.created_at, call })),
          ]
            .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
            .map(entry => entry.type === 'pending' ? (
            <div key={entry.call.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--amber-soft)', borderRadius: 10, border: '1px solid var(--amber)' }}>
              <Icon name="phone-call" size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: 'var(--accent)' }}>
                Call du {entry.call.scheduled_at ? new Date(entry.call.scheduled_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—'} — en attente de rapport
              </span>
              {entry.call.fathom_status === 'matched' && (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 11, border: '1px solid var(--ink)', borderRadius: 8, color: 'var(--ink)' }}
                  onClick={() => setInfosModalCall(entry.call)}
                >
                  Infos
                </button>
              )}
              <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => setSessionRapportCallId(entry.call.id)}>
                Remplir
              </button>
            </div>
          ) : (() => {
            const report = entry.report;
            const topicLabel = report.topic === 'autre'
              ? report.topic_custom
              : SESSION_TOPICS.find(t => t.value === report.topic)?.label;
            const isNoShow = report.attended === false;
            const acknowledged = !!report.acknowledged_at;
            return (
              <div key={report.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', opacity: isNoShow && acknowledged ? 0.55 : 1 }}>
                <Icon name={isNoShow ? 'x' : 'check'} size={14} style={{ color: isNoShow ? 'var(--red)' : 'var(--green)', marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                      {new Date(report.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                      background: isNoShow ? 'var(--red-soft)' : 'var(--green-soft)',
                      color: isNoShow ? 'var(--red)' : 'var(--green)',
                    }}>
                      {isNoShow ? 'No-show' : 'Présent'}
                    </span>
                    {topicLabel && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{topicLabel}</span>}
                    <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                      {calls.find(c => c.id === report.call_id)?.fathom_status === 'matched' && (
                        <button
                          type="button"
                          onClick={() => setInfosModalReport(report)}
                          className="btn-ghost"
                          style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--ink)', borderRadius: 8, color: 'var(--ink)' }}
                        >
                          Infos
                        </button>
                      )}
                      {!isNoShow && (
                        <button
                          type="button"
                          onClick={() => { setEditingReport(report); setSessionRapportCallId(report.call_id); }}
                          className="btn-ghost"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                        >
                          Éditer
                        </button>
                      )}
                    </div>
                  </div>
                  {report.notes && (
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{report.notes}</div>
                  )}
                  {isNoShow && (
                    acknowledged ? (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                        Pris en compte le {new Date(report.acknowledged_at!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </div>
                    ) : (
                      <button type="button" onClick={() => acknowledgeNoShow(report.id)} className="btn-ghost" style={{ fontSize: 11, marginTop: 6, padding: '4px 10px' }}>
                        Compris
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })())}
        </div>
      </div>

      {/* Boîte de dépôt */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">Dépôt de contenus</div>
            <div className="card-sub">Scripts, vidéos, posts — déposez et commentez directement</div>
          </div>
          <button className="btn-primary-brand" type="button" disabled={depotUploading} style={{ fontSize: 12, padding: '6px 12px', gap: 5, opacity: depotUploading ? 0.6 : 1 }} onClick={() => fileInputRef.current?.click()}>
            <Icon name="upload" size={12} /> {depotUploading ? 'Envoi…' : 'Déposer un fichier'}
          </button>
          <input
            ref={fileInputRef} type="file" accept="video/*,image/*,.pdf,.doc,.docx,.txt" multiple
            style={{ display: 'none' }}
            onChange={e => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) uploadDepotFiles(files);
              e.target.value = '';
            }}
          />
        </div>
        {depotError && (
          <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 12 }}>{depotError}</div>
        )}
        {depotLoading ? (
          <div style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)' }}>Chargement des fichiers…</div>
        ) : depotFiles.length === 0 ? (
          <div style={{ marginTop: 16, padding: '32px 20px', border: '2px dashed var(--border)', borderRadius: 10, textAlign: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }} onClick={() => fileInputRef.current?.click()}>
            <div style={{ marginBottom: 6 }}><Icon name="upload" size={20} color="var(--faint)" /></div>
            Glisse tes scripts, vidéos ou posts ici, ou clique pour parcourir
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {depotFiles.map(file => {
              const isUploader = file.uploader_id === user?.id;
              const uploaderLabel = file.uploader?.role === 'coach' ? 'Coach' : (file.uploader?.full_name || 'Élève');
              const draft = depotCommentDrafts[file.id] || '';
              const sending = depotCommentSending[file.id];
              const confirming = depotConfirmDelete === file.id;
              return (
                <div key={file.id} style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--accent-soft)', color: 'var(--accent)' }}>{uploaderLabel}</span>
                    {file.signed_url ? (
                      <a href={file.signed_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-brand)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {file.file_name}
                      </a>
                    ) : (
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{file.file_name}</span>
                    )}
                    {isUploader && (
                      confirming ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Supprimer aussi les commentaires ?</span>
                          <button type="button" onClick={() => deleteDepotFile(file.id, true)} className="btn-ghost" style={{ fontSize: 11, color: 'var(--red)' }}>Oui</button>
                          <button type="button" onClick={() => setDepotConfirmDelete(null)} className="btn-ghost" style={{ fontSize: 11 }}>Annuler</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => deleteDepotFile(file.id, false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, display: 'flex' }}>
                          <Icon name="x" size={14} />
                        </button>
                      )
                    )}
                  </div>
                  {file.comments.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                      {file.comments.map(c => (
                        <div key={c.id} style={{ padding: '8px 10px', background: 'var(--accent-brand-soft)', borderRadius: 8, borderLeft: '3px solid var(--accent-brand)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 10, color: 'var(--accent-brand)', fontWeight: 700, marginBottom: 3 }}>
                              {c.author?.role === 'coach' ? 'Coach' : (c.author?.full_name || 'Élève')} · {new Date(c.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{c.text}</div>
                          </div>
                          {c.author_id === user?.id && (
                            <button type="button" onClick={() => deleteDepotComment(file.id, c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2, display: 'flex', flexShrink: 0 }}>
                              <Icon name="x" size={11} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea placeholder="Laisser un commentaire sur ce contenu…" value={draft} onChange={e => setDepotCommentDrafts(d => ({ ...d, [file.id]: e.target.value }))} rows={2}
                      style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', fontSize: 12, color: 'var(--ink)', resize: 'none', fontFamily: 'inherit', outline: 'none', lineHeight: 1.5 }} />
                    <button type="button" className="btn-primary-brand" disabled={!draft.trim() || sending} style={{ fontSize: 12, padding: '6px 12px', alignSelf: 'flex-end', opacity: draft.trim() && !sending ? 1 : 0.4 }}
                      onClick={() => sendDepotComment(file.id)}>
                      <Icon name="send" size={12} /> {sending ? 'Envoi…' : 'Envoyer'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Intégrations requises — les 7 sont obligatoires sans exception (plus de
          waiver possible). Lecture seule : le coach voit l'état pour comprendre
          pourquoi un élève est bloqué (gate) ou doit se reconnecter, sans pouvoir
          le contourner. */}
      {client.profile_id && (
        <div className="card" style={{ marginTop: 24, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>Intégrations requises</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            Les 7 intégrations sont obligatoires pour débloquer la plateforme de cet élève.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {[
              { provider: 'instagram', label: 'Instagram' },
              { provider: 'calendly', label: 'Calendly' },
              { provider: 'youtube', label: 'YouTube' },
              { provider: 'stripe', label: 'Stripe' },
              { provider: 'shortio', label: 'Short.io' },
              { provider: 'google', label: 'Google' },
              { provider: 'fathom', label: 'Fathom' },
            ].map(({ provider, label }) => {
              const row = (clientIntegrations ?? []).find((i: any) => i.provider === provider);
              const state: 'connected' | 'failed' | 'missing' = !row ? 'missing' : row.status === 'failed' ? 'failed' : 'connected';
              const dotColor = state === 'connected' ? 'var(--green)' : state === 'failed' ? 'var(--red)' : 'var(--faint)';
              const textColor = state === 'missing' ? 'var(--muted)' : 'var(--accent)';
              return (
                <div key={provider} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)',
                  fontSize: 13, color: textColor,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  {label}
                  {state === 'failed' && <span style={{ fontSize: 11, color: 'var(--red)' }}>(reconnexion requise)</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions client — en bas de fiche, volontairement éloignées du contenu
          courant pour éviter les clics accidentels sur des actions à conséquence
          lourde (archivage, suppression définitive). */}
      <div style={{ display: 'flex', gap: 12, marginTop: 32, marginBottom: 24 }}>
        <button
          type="button"
          onClick={() => { setArchiveConfirmed(false); setShowArchiveModal(true); }}
          disabled={archiving}
          className="btn-client-archive"
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 13, fontWeight: 600, padding: '12px', borderRadius: 10,
            cursor: archiving ? 'default' : 'pointer', opacity: archiving ? 0.6 : 1,
            transition: 'background 150ms, border-color 150ms',
          }}
        >
          <Icon name="archive" size={14} /> {archiving ? 'Archivage…' : 'Archiver cet élève'}
        </button>
        <button
          type="button"
          onClick={() => { setDeleteError(''); setDeleteConfirmed(false); setShowDeleteModal(true); }}
          className="btn-client-delete"
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 13, fontWeight: 600, padding: '12px', borderRadius: 10,
            cursor: 'pointer',
            transition: 'background 150ms, border-color 150ms',
          }}
        >
          <Icon name="trash" size={14} /> Supprimer cet élève
        </button>
      </div>
    </div>
  );
}
