'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import InlineLoader from '@/components/ui/InlineLoader';
import TaskModal from '@/components/ui/TaskModal';
import type { Task, TaskAttachment } from '@/lib/supabase/types';
import { formatFileSize, formatRelativeDate } from '@/lib/formatFileSize';
import { isTaskOverdue, getDeadlineStatus } from '@/lib/clientSignals';

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
function TaskAttachmentsReadOnly({ taskId }: { taskId: string }) {
  const [attachments, setAttachments] = useState<TaskAttachment[] | null>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/attachments`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setAttachments(data?.attachments || []));
  }, [taskId]);

  if (attachments === null) return null;
  return <div style={{ width: '100%' }}><AttachmentList attachments={attachments} /></div>;
}

interface TaskWithClient extends Task {
  clients: { id: string; name: string; coach_id: string } | { id: string; name: string; coach_id: string }[];
}

const PRIORITY_CONFIG = {
  high: { label: 'Haute', color: 'var(--red)' },
  medium: { label: 'Moyenne', color: 'var(--amber)' },
  low: { label: 'Basse', color: 'var(--green)' },
} as const;

type StatusFilter = 'all' | 'overdue' | 'todo' | 'done';

function getClient(t: TaskWithClient) {
  return Array.isArray(t.clients) ? t.clients[0] : t.clients;
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
  const initialFilter = searchParams.get('filter') === 'overdue' ? 'overdue' : 'all';
  const [tasks, setTasks] = useState<TaskWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialFilter);
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

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
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  }

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      const c = getClient(t);
      if (c) map.set(c.id, c.name);
    }
    return Array.from(map.entries());
  }, [tasks]);

  const filtered = tasks
    .filter(t => {
      if (clientFilter !== 'all' && getClient(t)?.id !== clientFilter) return false;
      if (statusFilter === 'overdue') return isTaskOverdue(t);
      if (statusFilter === 'todo') return !t.done;
      if (statusFilter === 'done') return t.done;
      return true;
    })
    .sort((a, b) => {
      const aOver = isTaskOverdue(a), bOver = isTaskOverdue(b);
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Tâches</h1>
        <button type="button" className="btn-primary-brand" onClick={() => setShowCreateModal(true)} style={{ fontSize: 13 }}>
          <Icon name="plus" size={13} /> Nouvelle tâche
        </button>
      </div>

      <TaskModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onCreated={load} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12, color: 'var(--accent)', outline: 'none' }}
        >
          <option value="all">Toutes</option>
          <option value="overdue">En retard</option>
          <option value="todo">À faire</option>
          <option value="done">Terminées</option>
        </select>
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12, color: 'var(--accent)', outline: 'none' }}
        >
          <option value="all">Tous les élèves</option>
          {clientOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 0' }}>Aucune tâche.</div>
        )}
        {filtered.map(task => {
          const client = getClient(task);
          const overdue = isTaskOverdue(task);
          const priority = task.priority ? PRIORITY_CONFIG[task.priority] : null;
          const expanded = expandedId === task.id;
          return (
            <div key={task.id} style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10, border: `1px solid ${overdue ? 'var(--red)' : 'var(--border)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => toggle(task.id, !task.done)}
                  style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0, cursor: 'pointer',
                    border: `1.5px solid ${task.done ? 'var(--green)' : 'var(--border)'}`,
                    background: task.done ? 'var(--green)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {task.done && <Icon name="check" size={11} style={{ color: '#fff' }} />}
                </button>

                {client && (
                  <Link href={`/clients/${client.id}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-brand)', flexShrink: 0, minWidth: 90 }}>
                    {client.name}
                  </Link>
                )}

                <span style={{ flex: 1, fontSize: 13, color: task.done ? 'var(--muted)' : 'var(--accent)', textDecoration: task.done ? 'line-through' : 'none' }}>
                  {task.label}
                </span>

                {task.requires_attachment && (
                  <span title="Documents exigés" style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'var(--amber-soft)', color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <Icon name="upload" size={10} />
                    Documents
                  </span>
                )}

                {(() => {
                  const status = getDeadlineStatus(task.deadline, task.done);
                  if (!status) return null;
                  return (
                    <span style={{ fontSize: 11, color: status.color, fontWeight: status.overdue ? 700 : 400, flexShrink: 0 }}>
                      {status.label}
                    </span>
                  );
                })()}

                {priority && !task.done && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${priority.color}20`, color: priority.color, flexShrink: 0 }}>
                    {priority.label}
                  </span>
                )}

                {task.added_by === 'client' && (
                  <span title="Ajoutée par l'élève" style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
                    <Icon name="users" size={11} />
                  </span>
                )}

                <button type="button" onClick={() => { setExpandedId(id => id === task.id ? null : task.id); setConfirmDeleteId(null); }} className="icon-btn">
                  <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={13} />
                </button>
              </div>

              {expanded && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deadline</label>
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
              {expanded && task.requires_attachment && (
                <div style={{ marginTop: 10 }}>
                  <TaskAttachmentsReadOnly taskId={task.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
