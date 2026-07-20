'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import AttachmentItemsEditor from './AttachmentItemsEditor';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const PRIORITIES = [
  { value: 'high',   label: 'Haute',   color: 'var(--red)' },
  { value: 'medium', label: 'Moyenne', color: 'var(--amber)' },
  { value: 'low',    label: 'Basse',   color: 'var(--green)' },
] as const;

// Création groupée : le coach assigne la même tâche à plusieurs élèves à la fois.
// Une ligne `tasks` indépendante est créée par élève sélectionné (voir POST /api/tasks).
export default function TaskModalMulti({ open, onClose, onCreated }: Props) {
  const { clients } = useSupabaseClients();
  const [label, setLabel] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [requiresAttachment, setRequiresAttachment] = useState(false);
  const [attachmentItems, setAttachmentItems] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLabel(''); setDeadline(''); setPriority('medium');
      setRequiresAttachment(false); setAttachmentItems([]);
      setSelectedIds(new Set()); setFilter('');
      setError(''); setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const filteredClients = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c => c.name.toLowerCase().includes(q));
  }, [clients, filter]);

  if (!open) return null;

  function toggleClient(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!label.trim()) { setError('Le titre est obligatoire.'); return; }
    if (selectedIds.size === 0) { setError('Sélectionne au moins un élève.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_ids: [...selectedIds],
          label: label.trim(),
          deadline: deadline || null,
          priority,
          requires_attachment: requiresAttachment,
          attachment_items: requiresAttachment ? attachmentItems : [],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors de la création');
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Erreur lors de la création');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 720, maxWidth: '92vw', maxHeight: '86vh', background: 'var(--surface)', borderRadius: 16,
          border: '1px solid var(--border)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="users" size={16} />
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>Nouvelle tâche pour plusieurs élèves</span>
          </div>
          <button onClick={onClose} type="button" className="icon-btn"><Icon name="x" size={15} /></button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Titre de la tâche *
            </label>
            <input
              autoFocus
              value={label}
              onChange={e => { setLabel(e.target.value); setError(''); }}
              placeholder="Ex: Publier 3 Reels cette semaine"
              style={{
                width: '100%', padding: '10px 14px',
                border: `1px solid ${error && !label.trim() ? 'var(--red)' : 'var(--border)'}`,
                borderRadius: 10, fontSize: 13, background: 'var(--surface-2)',
                color: 'var(--accent)', outline: 'none', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Deadline
              </label>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                style={{
                  width: '100%', padding: '9px 12px',
                  border: '1px solid var(--border)', borderRadius: 10,
                  fontSize: 13, background: 'var(--surface-2)',
                  color: deadline ? 'var(--accent)' : 'var(--muted)',
                  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', cursor: 'pointer',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Priorité
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {PRIORITIES.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.12s',
                      border: `1.5px solid ${priority === p.value ? p.color : 'var(--border)'}`,
                      background: priority === p.value ? `${p.color}18` : 'var(--surface-2)',
                      color: priority === p.value ? p.color : 'var(--muted)',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={requiresAttachment}
                onChange={e => setRequiresAttachment(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
                Exiger un dépôt de document
              </span>
            </label>
            {requiresAttachment && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Documents attendus
                </label>
                <AttachmentItemsEditor items={attachmentItems} onChange={setAttachmentItems} />
              </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Élèves concernés * ({selectedIds.size} sélectionné{selectedIds.size > 1 ? 's' : ''})
            </label>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Rechercher un élève…"
              style={{
                width: '100%', padding: '8px 12px', marginBottom: 8,
                border: '1px solid var(--border)', borderRadius: 8,
                fontSize: 13, background: 'var(--surface-2)', color: 'var(--accent)',
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 6 }}>
              {filteredClients.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 6px' }}>Aucun élève trouvé.</div>
              )}
              {filteredClients.map(c => (
                <label
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    borderRadius: 8, cursor: 'pointer',
                    background: selectedIds.has(c.id) ? 'var(--accent-brand-soft)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleClient(c.id)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--accent)' }}>{c.name}</span>
                </label>
              ))}
            </div>
          </div>

          {error && <div role="alert" style={{ fontSize: 12, color: 'var(--red)', marginTop: 14 }}>{error}</div>}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} className="btn-ghost" type="button" disabled={saving}>Annuler</button>
          <button onClick={handleSubmit} className="btn-primary-brand" type="button" style={{ gap: 6 }} disabled={saving}>
            <Icon name="plus" size={13} /> {saving ? 'Création…' : `Créer pour ${selectedIds.size || ''} élève${selectedIds.size > 1 ? 's' : ''}`.trim()}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
