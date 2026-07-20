'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '@/components/ui/Icon';
import InlineLoader from '@/components/ui/InlineLoader';
import type { Task, TaskAttachment, TaskAttachmentItem } from '@/lib/supabase/types';
import { formatFileSize, formatRelativeDate } from '@/lib/formatFileSize';

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

// Carte de dépôt d'un fichier — utilisée par item structuré ou en fallback legacy.
// Redesign : icône illustrative, miniature si disponible, taille + date, feedback
// d'upload visible (spinner), au lieu du rendu minimal d'origine.
function AttachmentDropzone({ label, attachments, onUpload, onRemove, uploading }: {
  label?: string;
  attachments: TaskAttachment[];
  onUpload: (file: File) => void;
  onRemove: (attachmentId: string) => void;
  uploading: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasFile = attachments.length > 0;

  return (
    <div style={{ border: `1px solid ${hasFile ? 'var(--green)' : 'var(--border)'}`, borderRadius: 10, padding: 10, background: 'var(--surface)' }}>
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', flex: 1 }}>{label}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            background: hasFile ? 'var(--green-soft)' : 'var(--amber-soft)',
            color: hasFile ? 'var(--green)' : 'var(--amber)',
          }}>
            {hasFile ? 'Déposé' : 'En attente'}
          </span>
        </div>
      )}

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onUpload(file);
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: '14px', borderRadius: 8, textAlign: 'center', cursor: 'pointer',
          border: `1.5px dashed ${dragOver ? 'var(--accent-brand)' : 'var(--border)'}`,
          background: dragOver ? 'var(--accent-brand-soft)' : 'var(--surface-2)',
          transition: 'all 0.15s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
        />
        <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name={uploading ? 'refresh-cw' : 'upload'} size={13} style={uploading ? { animation: 'spin 0.9s linear infinite' } : undefined} />
          {uploading ? 'Envoi en cours…' : 'Glisse un document ou clique pour en ajouter un'}
        </div>
      </div>

      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {attachments.map(att => (
            <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              {att.thumbnail_url ? (
                <img src={att.thumbnail_url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="file" size={14} style={{ color: 'var(--muted)' }} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <a href={att.file_url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 12, color: 'var(--accent-brand)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {att.file_name}
                </a>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {[formatFileSize(att.file_size_bytes), formatRelativeDate(att.created_at)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button type="button" onClick={() => onRemove(att.id)} className="icon-btn" style={{ flexShrink: 0 }}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Panneau de dépôt d'une tâche : une carte par item structuré (chacune avec son propre
// statut/dropzone), ou fallback dropzone globale pour les tâches créées avant ce chantier
// (attachment_instructions texte libre, pas d'items).
function AttachmentItemsPanel({ taskId, legacyInstructions, onAllFilledChange }: {
  taskId: string;
  legacyInstructions: string | null;
  onAllFilledChange?: (allFilled: boolean) => void;
}) {
  const [items, setItems] = useState<TaskAttachmentItem[] | null>(null);
  const [legacyAttachments, setLegacyAttachments] = useState<TaskAttachment[]>([]);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}/attachment-items`);
    if (!res.ok) return;
    const data = (await res.json()).items || [];
    setItems(data);
    if (data.length === 0) {
      const legacyRes = await fetch(`/api/tasks/${taskId}/attachments`);
      if (legacyRes.ok) setLegacyAttachments((await legacyRes.json()).attachments || []);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!onAllFilledChange) return;
    if (items && items.length > 0) {
      onAllFilledChange(items.every(i => (i.task_attachments?.length ?? 0) > 0));
    } else {
      onAllFilledChange(legacyAttachments.length > 0);
    }
  }, [items, legacyAttachments, onAllFilledChange]);

  async function uploadToItem(itemId: string | null, file: File) {
    setUploadingKey(itemId ?? 'legacy');
    const form = new FormData();
    form.append('file', file);
    if (itemId) form.append('item_id', itemId);
    await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: form });
    setUploadingKey(null);
    load();
  }

  async function removeAttachment(attachmentId: string) {
    setLegacyAttachments(prev => prev.filter(a => a.id !== attachmentId));
    setItems(prev => prev?.map(i => ({ ...i, task_attachments: i.task_attachments?.filter(a => a.id !== attachmentId) })) ?? null);
    await fetch(`/api/tasks/attachments/${attachmentId}`, { method: 'DELETE' });
    load();
  }

  if (items === null) return null;

  if (items.length > 0) {
    return (
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(item => (
          <AttachmentDropzone
            key={item.id}
            label={item.label}
            attachments={item.task_attachments || []}
            onUpload={file => uploadToItem(item.id, file)}
            onRemove={removeAttachment}
            uploading={uploadingKey === item.id}
          />
        ))}
      </div>
    );
  }

  // Fallback tâches legacy (avant ce chantier) : dropzone globale, texte libre affiché tel quel.
  return (
    <div style={{ marginTop: 10 }}>
      {legacyInstructions && (
        <div style={{ marginBottom: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--ink-2)' }}>
          {legacyInstructions}
        </div>
      )}
      <AttachmentDropzone
        attachments={legacyAttachments}
        onUpload={file => uploadToItem(null, file)}
        onRemove={removeAttachment}
        uploading={uploadingKey === 'legacy'}
      />
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
  const [allFilled, setAllFilled] = useState<boolean | null>(null);
  const [confirmNoAttachment, setConfirmNoAttachment] = useState(false);

  useEffect(() => {
    if (!task.requires_attachment || task.done) return;
    fetch(`/api/tasks/${task.id}/attachment-items`)
      .then(r => r.ok ? r.json() : null)
      .then(async data => {
        const items = data?.items || [];
        if (items.length > 0) {
          setAllFilled(items.every((i: { task_attachments?: unknown[] }) => (i.task_attachments?.length ?? 0) > 0));
        } else {
          const legacyRes = await fetch(`/api/tasks/${task.id}/attachments`);
          const legacy = legacyRes.ok ? (await legacyRes.json()).attachments || [] : [];
          setAllFilled(legacy.length > 0);
        }
      });
  }, [task.requires_attachment, task.done, task.id]);

  function handleToggleClick() {
    if (!task.done && task.requires_attachment && allFilled === false) {
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
          <span title="Document exigé" style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: allFilled ? 'var(--green-soft)' : 'var(--amber-soft)', color: allFilled ? 'var(--green)' : 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <Icon name="upload" size={10} />
            {allFilled ? 'Document déposé' : 'Document exigé'}
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
          {/* Tâches assignées par le coach : l'élève ne peut que cocher et déposer des documents,
              jamais modifier deadline/priorité ni supprimer (cf. règle produit + garde côté API). */}
          {task.added_by !== 'coach' && <EditFields task={task} onSave={onSave} onDelete={onDelete} />}
          {task.requires_attachment && (
            <AttachmentItemsPanel taskId={task.id} legacyInstructions={task.attachment_instructions ?? null} onAllFilledChange={setAllFilled} />
          )}
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
  const [tab, setTab] = useState<'coach' | 'mine'>('coach');

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

  const coachTasks = tasks.filter(t => t.added_by === 'coach');
  const myTasks = tasks.filter(t => t.added_by === 'client');
  const visibleTasks = tab === 'coach' ? coachTasks : myTasks;
  const todo = visibleTasks.filter(t => !t.done);
  const done = visibleTasks.filter(t => t.done);

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Tâches</h1>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setTab('coach')}
          className={`chip${tab === 'coach' ? ' chip-active' : ''}`}
          style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px' }}
        >
          Tâches du coach ({coachTasks.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('mine')}
          className={`chip${tab === 'mine' ? ' chip-active' : ''}`}
          style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px' }}
        >
          Mes tâches ({myTasks.length})
        </button>
      </div>

      {tab === 'mine' && (
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
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {todo.length === 0 && done.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 0' }}>
            {tab === 'coach' ? 'Aucune tâche assignée par ton coach pour l\'instant.' : 'Aucune tâche personnelle pour l\'instant.'}
          </div>
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
