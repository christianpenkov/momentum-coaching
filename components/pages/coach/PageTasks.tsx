'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import InlineLoader from '@/components/ui/InlineLoader';
import TaskModal from '@/components/ui/TaskModal';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import type { Task, TaskAttachment } from '@/lib/supabase/types';
import { formatFileSize, formatRelativeDate } from '@/lib/formatFileSize';
import { isTaskOverdue, getTaskBucket } from '@/lib/clientSignals';

function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function combineDeadline(dateStr: string, timeStr: string): string | null {
  if (!dateStr) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, m] = (timeStr || '23:59').split(':').map(Number);
  return new Date(y, mo - 1, d, h, m).toISOString();
}

function AttachmentList({ attachments }: { attachments: TaskAttachment[] }) {
  if (attachments.length === 0) {
    return <div style={{ fontSize: 11, color: 'var(--muted)' }}>Aucun document déposé pour l'instant.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {attachments.map(att => (
        <a key={att.id} href={att.file_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, color: 'var(--accent-brand)' }}>
          {att.thumbnail_url ? (
            <img src={att.thumbnail_url} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <Icon name="file" size={13} style={{ flexShrink: 0 }} />
          )}
          <span style={{ flex: 1, minWidth: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{att.file_name}</span>
          <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
            {[formatFileSize(att.file_size_bytes), formatRelativeDate(att.created_at)].filter(Boolean).join(' · ')}
          </span>
        </a>
      ))}
    </div>
  );
}

// Lecture seule côté coach : liste plate de tous les documents déposés sur la tâche.
// Compte aussi remonté au parent pour piloter la couleur du pill Documents (ambre/vert).
function TaskAttachmentsReadOnly({ taskId, onCountChange }: { taskId: string; onCountChange?: (n: number) => void }) {
  const [attachments, setAttachments] = useState<TaskAttachment[] | null>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/attachments`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const list = data?.attachments || [];
        setAttachments(list);
        onCountChange?.(list.length);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  if (attachments === null) return null;
  return <div style={{ width: '100%' }}><AttachmentList attachments={attachments} /></div>;
}

type ClientProfileRef = { avatar_url?: string | null } | { avatar_url?: string | null }[] | null;
type TaskClientRow = { id: string; name: string; coach_id: string; initials?: string | null; profiles?: ClientProfileRef };

interface TaskWithClient extends Task {
  clients: TaskClientRow | TaskClientRow[];
}

function getClientAvatarUrl(c: TaskClientRow): string | null {
  const p = c.profiles;
  if (!p) return null;
  const profile = Array.isArray(p) ? p[0] : p;
  return profile?.avatar_url ?? null;
}

const PRIORITY_CONFIG = {
  high: { label: 'Haute', color: 'var(--red)' },
  medium: { label: 'Moyenne', color: 'var(--amber)' },
  low: { label: 'Basse', color: 'var(--green)' },
} as const;

const BUCKET_PILL: Record<string, { label: string; color: string } | null> = {
  over: { label: 'En retard', color: 'var(--red)' },
  today: { label: "Aujourd'hui", color: 'var(--amber)' },
  week: { label: 'Cette semaine', color: 'var(--accent-brand)' },
  later: { label: 'Plus tard', color: 'var(--muted)' },
  done: null, // remplacé par le pill "Fait" vert dédié
};

function getClient(t: TaskWithClient) {
  return Array.isArray(t.clients) ? t.clients[0] : t.clients;
}

function DeadlinePill({ task }: { task: Task }) {
  if (task.done) {
    return (
      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--green-soft)', color: 'var(--green)', flexShrink: 0 }}>
        Fait
      </span>
    );
  }
  const bucket = getTaskBucket(task);
  const pill = BUCKET_PILL[bucket];
  if (!pill || !task.deadline) return null;
  const target = new Date(task.deadline);
  const label = bucket === 'over' || bucket === 'today'
    ? (target.getHours() === 23 && target.getMinutes() >= 55
        ? pill.label
        : `${pill.label} · ${target.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`)
    : target.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return (
    <span style={{ fontSize: 11, color: pill.color, fontWeight: bucket === 'over' ? 700 : 500, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon name="calendar" size={10} />
      {label}
    </span>
  );
}

function DocumentsPill({ task, attachmentCount }: { task: Task; attachmentCount: number | null }) {
  if (!task.requires_attachment) return null;
  const deposited = (attachmentCount ?? 0) > 0;
  return (
    <span
      title={deposited ? 'Documents déposés' : 'Documents exigés'}
      style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
        background: deposited ? 'var(--green-soft)' : 'var(--amber-soft)',
        color: deposited ? 'var(--green)' : 'var(--amber)',
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
      }}
    >
      <Icon name="upload" size={10} />
      {deposited ? 'Déposé' : 'Documents'}
    </span>
  );
}

interface StudentGroup {
  client: { id: string; name: string; coach_id: string; avatar_url: string | null; initials?: string | null };
  tasks: TaskWithClient[];
}

export default function PageTasks() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>}>
      <PageTasksInner />
    </Suspense>
  );
}

function PageTasksInner() {
  const searchParams = useSearchParams();
  const initialOverdueOnly = searchParams.get('filter') === 'overdue';
  const reducedMotion = useReducedMotion();
  // Liste complète des élèves (même à 0 tâche) — /api/tasks ne renvoie que des lignes
  // de tasks, un élève sans aucune tâche n'y apparaîtrait jamais.
  const { clients: allClients } = useSupabaseClients();
  const [tasks, setTasks] = useState<TaskWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [overdueOnly, setOverdueOnly] = useState(initialOverdueOnly);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; clientId?: string; task?: Task } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/tasks');
    if (res.ok) setTasks((await res.json()).tasks || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(taskId: string, done: boolean) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, done } : t));
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    });
  }

  async function updateDeadline(taskId: string, deadline: string | null) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, deadline } : t));
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deadline }),
    });
  }

  async function deleteTask(taskId: string) {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setConfirmDeleteId(null);
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  }

  const groups: StudentGroup[] = useMemo(() => {
    // Toujours partir de la liste complète des élèves — même ceux à 0 tâche restent
    // affichés, pas seulement ceux ayant au moins une ligne dans `tasks`.
    const byClient = new Map<string, StudentGroup>();
    for (const c of allClients) {
      byClient.set(c.id, {
        client: { id: c.id, name: c.name, coach_id: c.coach_id, avatar_url: c.avatar_url, initials: c.initials },
        tasks: [],
      });
    }
    for (const t of tasks) {
      const c = getClient(t);
      if (!c) continue;
      if (!byClient.has(c.id)) byClient.set(c.id, { client: { ...c, avatar_url: getClientAvatarUrl(c) }, tasks: [] });
      byClient.get(c.id)!.tasks.push(t);
    }
    const list = Array.from(byClient.values());
    for (const g of list) {
      g.tasks.sort((a, b) => {
        const aOver = isTaskOverdue(a), bOver = isTaskOverdue(b);
        if (aOver !== bOver) return aOver ? -1 : 1;
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });
    }
    list.sort((a, b) => {
      const aOver = a.tasks.filter(t => isTaskOverdue(t)).length;
      const bOver = b.tasks.filter(t => isTaskOverdue(t)).length;
      if (aOver !== bOver) return bOver - aOver;
      return a.client.name.localeCompare(b.client.name);
    });
    return overdueOnly ? list.filter(g => g.tasks.some(t => isTaskOverdue(t))) : list;
  }, [tasks, overdueOnly, allClients]);

  // Déplié par défaut : au premier chargement de chaque élève rencontré.
  useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev };
      let changed = false;
      for (const g of groups) {
        if (!(g.client.id in next)) { next[g.client.id] = true; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [groups]);

  const totalActive = tasks.filter(t => !t.done).length;
  const studentCount = groups.length;

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tâches</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            {studentCount} élève{studentCount !== 1 ? 's' : ''} · {totalActive} tâche{totalActive !== 1 ? 's' : ''} en cours
          </div>
        </div>
        <button type="button" className="btn-primary-brand" onClick={() => setModalState({ mode: 'create' })} style={{ fontSize: 13 }}>
          <Icon name="plus" size={13} /> Assigner une tâche
        </button>
      </div>

      <AnimatePresence>
        {modalState && (
          <TaskModal
            key={modalState.task?.id ?? 'new'}
            clientId={modalState.clientId}
            task={modalState.task}
            onClose={() => setModalState(null)}
            onCreated={load}
          />
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setOverdueOnly(v => !v)}
          className={`pill pill-sm${overdueOnly ? ' pill-red' : ''}`}
          style={{ cursor: 'pointer', border: overdueOnly ? 'none' : '1px solid var(--border)', background: overdueOnly ? undefined : 'var(--surface-2)' }}
        >
          En retard uniquement
        </button>
      </div>

      {groups.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', padding: '32px 0', textAlign: 'center' }}>
          {overdueOnly ? 'Aucun élève en retard.' : 'Aucun élève actif.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map((g, i) => {
          const overdueCount = g.tasks.filter(t => isTaskOverdue(t)).length;
          const doneCount = g.tasks.filter(t => t.done).length;
          const total = g.tasks.length;
          const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
          const isOpen = !!expanded[g.client.id];
          return (
            <motion.div
              key={g.client.id}
              initial={reducedMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.28, delay: reducedMotion ? 0 : Math.min(i * 0.04, 0.3), ease: [0.16, 1, 0.3, 1] }}
              style={{
                background: 'var(--surface)', borderRadius: 'var(--r-card)',
                border: `1px solid ${overdueCount > 0 ? 'var(--red)' : 'var(--border)'}`,
                overflow: 'hidden',
              }}
            >
              <div
                onClick={() => setExpanded(prev => ({ ...prev, [g.client.id]: !prev[g.client.id] }))}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, cursor: 'pointer' }}
              >
                <Avatar initials={g.client.initials || getInitials(g.client.name)} avatarUrl={g.client.avatar_url} size={36} seed={g.client.id} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Link href={`/clients/${g.client.id}`} onClick={e => e.stopPropagation()} style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                      {g.client.name}
                    </Link>
                    {overdueCount > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--red-soft)', color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)', animation: reducedMotion ? 'none' : 'pulse 1.6s ease-in-out infinite' }} />
                        {overdueCount} en retard
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{doneCount}/{total} tâches faites</div>
                </div>

                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 120 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%', borderRadius: 999,
                        width: `${pct}%`,
                        background: pct === 100 ? 'var(--green)' : 'var(--accent-brand)',
                        transition: reducedMotion ? 'none' : 'width .9s cubic-bezier(.16,1,.3,1)',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{doneCount}/{total}</span>
                </div>

                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setModalState({ mode: 'create', clientId: g.client.id }); }}
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: '6px 12px', borderColor: 'var(--accent-brand)', color: 'var(--accent-brand)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <Icon name="plus" size={11} /> Assigner
                </button>

                <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} style={{ color: 'var(--muted)', transition: 'transform .2s', flexShrink: 0 }} />
              </div>

              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {(() => {
                    const pending = g.tasks.filter(t => !t.done);
                    const done = g.tasks.filter(t => t.done);
                    const pendingKey = `${g.client.id}-pending`;
                    const doneKey = `${g.client.id}-done`;
                    const pendingCollapsed = !!collapsedSections[pendingKey];
                    const doneCollapsed = collapsedSections[doneKey] !== false; // repliée par défaut

                    function renderTask(task: TaskWithClient) {
                      const expandedRow = expandedTaskId === task.id;
                      const priority = task.priority ? PRIORITY_CONFIG[task.priority] : null;
                      return (
                        <div key={task.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: '#fbfbf7' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button
                              type="button"
                              onClick={() => toggle(task.id, !task.done)}
                              className={`task-check${task.done ? ' checked' : ''}`}
                              style={{ transition: reducedMotion ? 'none' : 'transform .18s cubic-bezier(.34,1.56,.64,1), border-color 120ms, background 120ms' }}
                            >
                              {task.done && <Icon name="check" size={11} style={{ color: '#fff' }} />}
                            </button>

                            <span
                              onClick={() => setExpandedTaskId(id => id === task.id ? null : task.id)}
                              style={{ flex: 1, fontSize: 13, cursor: 'pointer', color: task.done ? 'var(--muted)' : 'var(--accent)', textDecoration: task.done ? 'line-through' : 'none' }}
                            >
                              {task.label}
                            </span>

                            <DocumentsPill task={task} attachmentCount={attachmentCounts[task.id] ?? null} />
                            <DeadlinePill task={task} />
                            {priority && !task.done && (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: `${priority.color}20`, color: priority.color, flexShrink: 0 }}>
                                {priority.label}
                              </span>
                            )}
                            {task.added_by === 'client' && (
                              <span title="Ajoutée par l'élève" style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
                                <Icon name="users" size={11} />
                              </span>
                            )}
                            <button type="button" onClick={() => setModalState({ mode: 'edit', task })} className="icon-btn" title="Modifier">
                              <Icon name="edit" size={12} />
                            </button>
                            <button type="button" onClick={() => setExpandedTaskId(id => id === task.id ? null : task.id)} className="icon-btn">
                              <Icon name={expandedRow ? 'chevron-up' : 'chevron-down'} size={12} style={{ transition: 'transform .2s' }} />
                            </button>
                          </div>

                          {expandedRow && (
                            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                              <div>
                                <label className="eyebrow-sm" style={{ color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Deadline</label>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <input
                                    type="date"
                                    value={task.deadline ? toDateInput(task.deadline) : ''}
                                    onChange={e => updateDeadline(task.id, combineDeadline(e.target.value, task.deadline ? toTimeInput(task.deadline) : '23:59'))}
                                    style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit' }}
                                  />
                                  <input
                                    type="time"
                                    value={task.deadline ? toTimeInput(task.deadline) : '23:59'}
                                    onChange={e => task.deadline && updateDeadline(task.id, combineDeadline(toDateInput(task.deadline), e.target.value))}
                                    disabled={!task.deadline}
                                    style={{ width: 90, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit' }}
                                  />
                                </div>
                              </div>
                              <div style={{ flex: 1 }} />
                              {confirmDeleteId === task.id ? (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Supprimer ?</span>
                                  <button type="button" onClick={() => deleteTask(task.id)} style={{ fontSize: 11, color: 'var(--red)', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>Oui</button>
                                  <button type="button" onClick={() => setConfirmDeleteId(null)} style={{ fontSize: 11, color: 'var(--muted)', border: 'none', background: 'none', cursor: 'pointer' }}>Non</button>
                                </div>
                              ) : (
                                <button type="button" onClick={() => setConfirmDeleteId(task.id)} className="icon-btn" title="Supprimer la tâche">
                                  <Icon name="trash" size={13} style={{ color: 'var(--red)' }} />
                                </button>
                              )}
                            </div>
                          )}
                          {expandedRow && task.requires_attachment && (
                            <div style={{ marginTop: 10 }}>
                              <TaskAttachmentsReadOnly taskId={task.id} onCountChange={n => setAttachmentCounts(prev => ({ ...prev, [task.id]: n }))} />
                            </div>
                          )}
                        </div>
                      );
                    }

                    function SectionHeader({ sectionKey, label, count, collapsed }: { sectionKey: string; label: string; count: number; collapsed: boolean }) {
                      return (
                        <button
                          type="button"
                          onClick={() => setCollapsedSections(prev => ({ ...prev, [sectionKey]: !collapsed }))}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'var(--surface-2)', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} style={{ color: 'var(--muted)', transition: 'transform .2s', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{label}</span>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>({count})</span>
                        </button>
                      );
                    }

                    return (
                      <>
                        {pending.length === 0 && done.length === 0 && (
                          <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                            Aucune tâche assignée à cet élève.
                          </div>
                        )}
                        {pending.length > 0 && (
                          <div>
                            <SectionHeader sectionKey={pendingKey} label="EN COURS" count={pending.length} collapsed={pendingCollapsed} />
                            {!pendingCollapsed && pending.map(renderTask)}
                          </div>
                        )}
                        {done.length > 0 && (
                          <div>
                            <SectionHeader sectionKey={doneKey} label="TERMINÉES" count={done.length} collapsed={doneCollapsed} />
                            {!doneCollapsed && done.map(renderTask)}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
