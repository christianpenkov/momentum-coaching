'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '@/components/ui/Icon';
import InlineLoader from '@/components/ui/InlineLoader';
import type { Task, TaskAttachment } from '@/lib/supabase/types';

const PRIORITY_CONFIG = {
  high: { label: 'Haute', color: 'var(--red)' },
  medium: { label: 'Moyenne', color: 'var(--amber)' },
  low: { label: 'Basse', color: 'var(--green)' },
} as const;

function DeadlineBadge({ deadline, done }: { deadline?: string | null; done: boolean }) {
  if (!deadline || done) return null;
  const d = new Date(deadline);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  const overdue = diff < 0;
  const urgent = diff <= 2 && diff >= 0;
  const color = overdue ? 'var(--red)' : urgent ? 'var(--amber)' : 'var(--muted)';
  const label = overdue
    ? `En retard · ${Math.abs(diff)}j`
    : diff === 0 ? "Aujourd'hui"
    : diff === 1 ? 'Demain'
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return (
    <span style={{ fontSize: 10, color, display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: overdue || urgent ? 700 : 400, flexShrink: 0 }}>
      <Icon name="calendar" size={10} />{label}
    </span>
  );
}

function AttachmentsPanel({ taskId, onCountChange }: { taskId: string; onCountChange?: (count: number) => void }) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}/attachments`);
    if (res.ok) {
      const list = (await res.json()).attachments || [];
      setAttachments(list);
      onCountChange?.(list.length);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  async function upload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: form });
    setUploading(false);
    if (res.ok) load();
  }

  async function remove(attachmentId: string) {
    setAttachments(prev => {
      const next = prev.filter(a => a.id !== attachmentId);
      onCountChange?.(next.length);
      return next;
    });
    await fetch(`/api/tasks/attachments/${attachmentId}`, { method: 'DELETE' });
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: '12px', borderRadius: 8, textAlign: 'center', cursor: 'pointer',
          border: `1.5px dashed ${dragOver ? 'var(--accent-brand)' : 'var(--border)'}`,
          background: dragOver ? 'var(--accent-brand-soft)' : 'var(--surface-2)',
          transition: 'all 0.15s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
        />
        <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="upload" size={12} />
          {uploading ? 'Envoi en cours…' : 'Glisse un document ou clique pour en ajouter un'}
        </div>
      </div>

      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {attachments.map(att => (
            <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <Icon name="file" size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <a href={att.file_url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--accent-brand)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {att.file_name}
              </a>
              <button type="button" onClick={() => remove(att.id)} className="icon-btn" style={{ flexShrink: 0 }}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditFields({ task, onSave, onDelete }: { task: Task; onSave: (patch: { deadline: string | null; priority: 'high' | 'medium' | 'low' }) => void; onDelete: () => void }) {
  const [deadline, setDeadline] = useState(task.deadline || '');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>(task.priority || 'medium');
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div>
        <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deadline</label>
        <input
          type="date"
          value={deadline}
          onChange={e => { setDeadline(e.target.value); onSave({ deadline: e.target.value || null, priority }); }}
          style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['high', 'medium', 'low'] as const).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => { setPriority(p); onSave({ deadline: deadline || null, priority: p }); }}
            style={{
              padding: '7px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1.5px solid ${priority === p ? PRIORITY_CONFIG[p].color : 'var(--border)'}`,
              background: priority === p ? `${PRIORITY_CONFIG[p].color}18` : 'var(--surface)',
              color: priority === p ? PRIORITY_CONFIG[p].color : 'var(--muted)',
            }}
          >
            {PRIORITY_CONFIG[p].label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      {confirmDelete ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Supprimer ?</span>
          <button type="button" onClick={onDelete} style={{ fontSize: 11, color: 'var(--red)', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>Oui</button>
          <button type="button" onClick={() => setConfirmDelete(false)} style={{ fontSize: 11, color: 'var(--muted)', border: 'none', background: 'none', cursor: 'pointer' }}>Non</button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmDelete(true)} className="icon-btn" title="Supprimer la tâche">
          <Icon name="trash" size={13} style={{ color: 'var(--red)' }} />
        </button>
      )}
    </div>
  );
}

function TaskRow({ task, onToggle, onExpand, expanded, onSave, onDelete }: {
  task: Task;
  onToggle: (done: boolean) => void;
  onExpand: () => void;
  expanded: boolean;
  onSave: (patch: { deadline: string | null; priority: 'high' | 'medium' | 'low' }) => void;
  onDelete: () => void;
}) {
  const priority = task.priority ? PRIORITY_CONFIG[task.priority] : null;
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  const [confirmNoAttachment, setConfirmNoAttachment] = useState(false);

  useEffect(() => {
    if (!task.requires_attachment || task.done) return;
    fetch(`/api/tasks/${task.id}/attachments`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAttachmentCount((data.attachments || []).length); });
  }, [task.requires_attachment, task.done, task.id, expanded]);

  function handleToggleClick() {
    if (!task.done && task.requires_attachment && attachmentCount === 0) {
      setConfirmNoAttachment(true);
      return;
    }
    onToggle(!task.done);
  }

  return (
    <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={handleToggleClick}
          style={{
            width: 18, height: 18, borderRadius: 5, flexShrink: 0, cursor: 'pointer',
            border: `1.5px solid ${task.done ? 'var(--green)' : 'var(--border)'}`,
            background: task.done ? 'var(--green)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {task.done && <Icon name="check" size={11} style={{ color: '#fff' }} />}
        </button>
        <span style={{ flex: 1, fontSize: 13, color: task.done ? 'var(--muted)' : 'var(--accent)', textDecoration: task.done ? 'line-through' : 'none' }}>
          {task.label}
        </span>
        {task.requires_attachment && !task.done && (
          <span title={task.attachment_instructions || 'Document exigé'} style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: attachmentCount ? 'var(--green-soft)' : 'var(--amber-soft)', color: attachmentCount ? 'var(--green)' : 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <Icon name="upload" size={10} />
            {attachmentCount ? 'Document déposé' : 'Document exigé'}
          </span>
        )}
        <DeadlineBadge deadline={task.deadline} done={task.done} />
        {priority && !task.done && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${priority.color}20`, color: priority.color }}>
            {priority.label}
          </span>
        )}
        <button type="button" onClick={onExpand} className="icon-btn">
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={13} />
        </button>
      </div>

      {task.requires_attachment && task.attachment_instructions && !task.done && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--amber-soft)', borderRadius: 6, fontSize: 12, color: 'var(--ink-2)', borderLeft: '2px solid var(--amber)' }}>
          {task.attachment_instructions}
        </div>
      )}

      {confirmNoAttachment && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--amber)' }}>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 8 }}>
            Cette tâche demande un document et tu n'en as pas encore déposé. Terminer quand même ?
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirmNoAttachment(false)}>Ajouter le document</button>
            <button
              type="button"
              className="btn-primary-brand"
              style={{ fontSize: 12 }}
              onClick={() => { setConfirmNoAttachment(false); onToggle(true); }}
            >
              Terminer sans déposer
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <>
          <EditFields task={task} onSave={onSave} onDelete={onDelete} />
          <AttachmentsPanel taskId={task.id} onCountChange={setAttachmentCount} />
        </>
      )}
    </div>
  );
}

export default function PageClientTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);

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

  async function addTask() {
    if (!newLabel.trim()) return;
    setAdding(true);
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel.trim() }),
    });
    setAdding(false);
    if (res.ok) { setNewLabel(''); load(); }
  }

  async function saveTask(taskId: string, patch: { deadline: string | null; priority: 'high' | 'medium' | 'low' }) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t));
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  async function deleteTask(taskId: string) {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>;

  const todo = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Tâches</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
            placeholder="Ajouter une tâche personnelle…"
            style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, background: 'var(--surface-2)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit' }}
          />
          <button type="button" onClick={addTask} disabled={adding || !newLabel.trim()} className="btn-primary-brand">
            <Icon name="plus" size={13} /> Ajouter
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {todo.length === 0 && done.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 0' }}>Aucune tâche pour l'instant.</div>
        )}
        {todo.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            onToggle={(v) => toggle(task.id, v)}
            expanded={expandedId === task.id}
            onExpand={() => setExpandedId(id => id === task.id ? null : task.id)}
            onSave={(patch) => saveTask(task.id, patch)}
            onDelete={() => deleteTask(task.id)}
          />
        ))}
      </div>

      {done.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Terminées ({done.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {done.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={(v) => toggle(task.id, v)}
                expanded={expandedId === task.id}
                onExpand={() => setExpandedId(id => id === task.id ? null : task.id)}
                onSave={(patch) => saveTask(task.id, patch)}
                onDelete={() => deleteTask(task.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
