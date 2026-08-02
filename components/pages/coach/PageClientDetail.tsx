'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Avatar from '@/components/ui/Avatar';
import InlineLoader from '@/components/ui/InlineLoader';
import Ring from '@/components/ui/Ring';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon, { type IconName } from '@/components/ui/Icon';
import TaskModal from '@/components/ui/TaskModal';
import SessionRapportModal from '@/components/ui/SessionRapportModal';
import ModalShell from '@/components/ui/ModalShell';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { useUser } from '@/lib/UserContext';
import { createClient as createSupabase } from '@/lib/supabase/client';
import { getPendingSessionRapports, SESSION_TOPICS } from '@/lib/sessionRapport';
import { isTaskOverdue } from '@/lib/clientSignals';
import DeadlineBadge from '@/components/ui/DeadlineBadge';
import type { Task, SessionReport } from '@/lib/supabase/types';

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
  const { getClient, toggleTask: ctxToggle, calls, refetch, archiveClient, loading: clientsLoading } = useSupabaseClients();
  const client = getClient(id);
  const allTasks = client?.tasks || [];
  const tasks = allTasks.filter(t => !t.resolved_by_coach);
  const resolvedTasks = allTasks.filter(t => t.resolved_by_coach);
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [note, setNote] = useState(client?.private_notes || '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
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
  const [sessionReports, setSessionReports] = useState<SessionReport[]>([]);
  const deepLinkHandled = useRef(false);

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
    const url = new URL(window.location.href);
    url.searchParams.delete('session-rapport');
    router.replace(url.pathname + url.search, { scroll: false });
    loadSessionReports();
  }

  const sessionRapportCall = pendingSessionRapports.find(c => c.id === sessionRapportCallId)
    || clientCalls.find(c => c.id === sessionRapportCallId)
    || null;

  // KPIs live depuis les vraies sources (IG/YT API + Supabase instagram_leads + Stripe)
  const [liveKpis, setLiveKpis] = useState<{ posts30: number | null; leads30: number | null; mrr: number | null } | null>(null);

  useEffect(() => {
    if (!client?.profile_id) return;
    const pid = client.profile_id;
    const supabase = createSupabase();
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    Promise.all([
      fetch(`/api/instagram/stats?profileId=${pid}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/youtube/stats?profileId=${pid}`).then(r => r.ok ? r.json() : null).catch(() => null),
      supabase.from('instagram_leads')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', pid)
        .is('archived_at', null)
        .eq('not_a_lead', false)
        .gte('detected_at', since30),
      fetch(`/api/stripe/client-data?profileId=${pid}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([ig, yt, leadsRes, stripe]) => {
      const igPosts = (ig?.posts?.length ?? 0);
      const ytPosts = (yt?.videos?.length ?? 0);
      setLiveKpis({
        posts30: igPosts + ytPosts,
        leads30: leadsRes?.count ?? null,
        mrr: stripe?.monthlyRevenue ?? null,
      });
    });
  }, [client?.profile_id]);

  if (!client && clientsLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>
  );

  if (!client) return (
    <div className="page-content">
      <div className="page-header"><h1 className="page-title">Client introuvable</h1></div>
    </div>
  );

  const metrics = client.weeklyMetrics || [];
  const last = metrics[metrics.length - 1] || null;
  const prev = metrics[metrics.length - 2] || null;

  // Calls 30j depuis le contexte global (source de vérité)
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const calls30 = calls.filter(c =>
    c.client_id === id &&
    !['cancelled', 'canceled', 'declined'].includes(c.status ?? '') &&
    c.scheduled_at != null &&
    new Date(c.scheduled_at) >= cutoff30
  ).length;

  const doneCount = tasks.filter(t => t.done).length;
  const progress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  function toggleTask(taskId: string, done: boolean) {
    ctxToggle(id, taskId, done);
  }

  async function resolveTask(taskId: string) {
    setTaskActionError(null);
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved_by_coach: true }),
    });
    if (!res.ok) { setTaskActionError('Erreur — la tâche n\'a pas pu être résolue'); return; }
    refetch();
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
    const ok = await archiveClient(id);
    setArchiving(false);
    if (ok) router.push('/clients');
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
          <Avatar initials={client.initials || client.name.slice(0, 2).toUpperCase()} avatarUrl={client.avatar_url} size={48} />
          <div>
            <h1 className="page-title" style={{ marginBottom: 4 }}>{client.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{client.niche || 'Niche non définie'}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>· Semaine {client.week}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/clients/${id}/analytics`} className="btn-primary-brand">
            <Icon name="bar-chart" size={14} /> Analytics
          </Link>
        </div>
      </div>

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

      {/* KPIs rapides 30j */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Posts (30j)</div>
          <div className="kpi-value">{liveKpis ? (liveKpis.posts30 ?? '—') : '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>IG + YouTube</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Leads générés (30j)</div>
          <div className="kpi-value">{liveKpis ? (liveKpis.leads30 ?? '—') : '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>commentaires détectés</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Calls (30j)</div>
          <div className="kpi-value">{calls30}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>sur la plateforme</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Cash contracté</div>
          <div className="kpi-value">{liveKpis?.mrr != null ? `${liveKpis.mrr.toLocaleString('fr-FR')} €` : '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>MRR Stripe</div>
        </div>
      </div>

      <AnimatePresence>
        {modalOpen && (
          <TaskModal clientId={id} onClose={() => setModalOpen(false)} onCreated={refetch} />
        )}
      </AnimatePresence>
      {sessionRapportCallId && (
        <SessionRapportModal
          callId={sessionRapportCallId}
          studentName={client.name}
          scheduledAt={sessionRapportCall?.scheduled_at ?? null}
          onClose={closeSessionRapportModal}
        />
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
        {/* Plan de la semaine */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Plan de la semaine</div>
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
            {tasks.filter(t => !t.done).map(task => {
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
            {tasks.filter(t => !t.done).length === 0 && tasks.length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--green)', padding: '8px 0' }}>✓ Toutes les tâches sont terminées !</div>
            )}
            {tasks.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucune tâche · cliquez sur "Ajouter"</div>
            )}
            {tasks.filter(t => t.done).length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>TERMINÉES ({tasks.filter(t => t.done).length})</div>
                {tasks.filter(t => t.done).map(task => (
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

        {/* Profil détaillé */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Profil & Funnel</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="calendar" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Client depuis</span>
              <strong>{client.client_since ? `${client.client_since}j` : '—'}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="phone-call" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Prochain call</span>
              <strong>{client.next_call || 'Non planifié'}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="target" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Taux iClosed</span>
              <strong style={{ color: 'var(--green)' }}>{client.iclosed_rate || 0}%</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="calendar" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Calls Calendly/mois</span>
              <strong>{client.calendly_monthly || 0}</strong>
            </div>
            {liveKpis?.mrr != null && (
              <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <Icon name="dollar-sign" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>MRR actuel</span>
                <strong>{liveKpis.mrr.toLocaleString('fr-FR')} €</strong>
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Score momentum</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${client.momentum_score || 0}%`,
                    background: (client.momentum_score || 0) >= 70 ? 'var(--green)' : (client.momentum_score || 0) >= 40 ? 'var(--amber)' : 'var(--red)',
                    borderRadius: 4,
                    transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
                  }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', minWidth: 32 }}>{client.momentum_score || 0}</span>
              </div>
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

      {/* Historique des sessions de coaching (calls Google Meet coach-élève) */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div className="card-title">Historique des sessions</div>
          <div className="card-sub">Rapports de fin d'appel — calls coach-élève</div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sessionReports.length === 0 && pendingSessionRapports.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucune session rapportée pour l'instant.</div>
          )}
          {sessionReports.map(report => {
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
          })}
          {pendingSessionRapports.map(call => (
            <div key={call.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--amber-soft)', borderRadius: 10, border: '1px solid var(--amber)' }}>
              <Icon name="phone-call" size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: 'var(--accent)' }}>
                Call du {call.scheduled_at ? new Date(call.scheduled_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—'} — en attente de rapport
              </span>
              <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => setSessionRapportCallId(call.id)}>
                Remplir
              </button>
            </div>
          ))}
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
                        <div key={c.id} style={{ padding: '8px 10px', background: '#EEF2FF', borderRadius: 8, borderLeft: '3px solid var(--accent)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, marginBottom: 3 }}>
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

      {/* Stats & tendances */}
      {metrics.length > 1 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-head">
            <div>
              <div className="card-title">Statistiques — {metrics.length} semaines</div>
              <div className="card-sub">Évolution semaine par semaine</div>
            </div>
            <Link href={`/clients/${id}/analytics`} className="btn-primary-brand" style={{ fontSize: 12 }}>
              <Icon name="bar-chart" size={13} /> Analytics complet
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 20 }}>
            {[
              { label: 'Followers Instagram', data: metrics.map(w => w.followers_ig), color: '#E1306C', format: (n: number) => n.toLocaleString('fr-FR') },
              { label: 'Posts / semaine',     data: metrics.map(w => w.posts_count),  color: 'var(--accent)', format: (n: number) => `${n} posts` },
              { label: 'Taux de closing',     data: metrics.map(w => w.closing_rate * 10), color: 'var(--green)', format: (_n: number, i: number) => `${metrics[i]?.closing_rate ?? 0}%` },
              { label: 'Taux no-show',        data: metrics.map(w => w.no_show_rate * 10), color: 'var(--amber)', format: (_n: number, i: number) => `${metrics[i]?.no_show_rate ?? 0}%` },
              { label: 'Rétention vidéo',     data: metrics.map(w => w.video_retention * 10), color: 'var(--accent)', format: (_n: number, i: number) => `${metrics[i]?.video_retention ?? 0}%` },
              { label: 'CTR lien en bio',     data: metrics.map(w => w.ctr_bio_link * 10), color: '#8B5CF6', format: (_n: number, i: number) => `${metrics[i]?.ctr_bio_link ?? 0}%` },
              { label: 'MRR Stripe',          data: metrics.map(w => w.stripe_mrr), color: 'var(--green)', format: (n: number) => `${n.toLocaleString('fr-FR')} €` },
              { label: 'DM envoyés',          data: metrics.map(w => w.dms_sent), color: 'var(--muted)', format: (n: number) => `${n} DM` },
            ].map(({ label, data, color, format }) => {
              const lastVal = data[data.length - 1] ?? 0;
              const prevVal = data[data.length - 2] ?? 0;
              const delta = lastVal - prevVal;
              const pct = prevVal > 0 ? Math.round((delta / prevVal) * 100) : 0;
              return (
                <div key={label} style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 500 }}>{label}</div>
                  <div style={{ marginBottom: 10 }}>
                    <Sparkbars data={data} height={30} width={100} color={color} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    {format(lastVal, data.length - 1)}
                  </div>
                  <div style={{ fontSize: 11, color: pct >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 3, fontWeight: 600 }}>
                    {pct >= 0 ? '+' : ''}{pct}% vs sem. préc.
                  </div>
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
          onClick={handleArchive}
          disabled={archiving}
          className="btn-client-archive"
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 13, fontWeight: 600, padding: '12px', borderRadius: 10,
            background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--accent)',
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
            background: 'var(--red-soft)', border: '1px solid rgba(205,91,63,0.3)', color: 'var(--red)',
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
