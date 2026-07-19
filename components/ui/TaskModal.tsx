'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import type { Task } from '@/lib/supabase/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (task: Omit<Task, 'id' | 'client_id' | 'created_at'>) => void;
}

const PRIORITIES = [
  { value: 'high',   label: 'Haute',   color: 'var(--red)' },
  { value: 'medium', label: 'Moyenne', color: 'var(--amber)' },
  { value: 'low',    label: 'Basse',   color: 'var(--green)' },
] as const;

export default function TaskModal({ open, onClose, onAdd }: Props) {
  const [label, setLabel] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [error, setError] = useState('');

  // Reset à chaque ouverture
  useEffect(() => {
    if (open) { setLabel(''); setDeadline(''); setPriority('medium'); setError(''); }
  }, [open]);

  // Fermer avec Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  function handleSubmit() {
    if (!label.trim()) { setError('Le titre est obligatoire.'); return; }
    onAdd({
      label: label.trim(),
      done: false,
      meta: null,
      deadline: deadline || null,
      priority,
      added_by: 'coach',
    });
    onClose();
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
          width: 460, background: 'var(--surface)', borderRadius: 16,
          border: '1px solid var(--border)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="plus" size={16} />
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>Nouvelle tâche</span>
          </div>
          <button onClick={onClose} type="button" className="icon-btn"><Icon name="x" size={15} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {/* Titre */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Titre de la tâche *
            </label>
            <input
              autoFocus
              value={label}
              onChange={e => { setLabel(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="Ex: Publier 3 Reels cette semaine"
              style={{
                width: '100%', padding: '10px 14px',
                border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`,
                borderRadius: 10, fontSize: 13, background: 'var(--surface-2)',
                color: 'var(--accent)', outline: 'none', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{error}</div>}
          </div>

          {/* Deadline + Priorité côte à côte */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Deadline
              </label>
              <div style={{ position: 'relative' }}>
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

          {/* Preview */}
          {label.trim() && (
            <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Aperçu</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid var(--border)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--accent)', flex: 1 }}>{label}</span>
                {deadline && (
                  <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Icon name="calendar" size={11} />
                    {new Date(deadline).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </span>
                )}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                  background: `${PRIORITIES.find(p => p.value === priority)?.color}20`,
                  color: PRIORITIES.find(p => p.value === priority)?.color,
                }}>
                  {PRIORITIES.find(p => p.value === priority)?.label}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn-ghost" type="button">Annuler</button>
          <button
            onClick={handleSubmit}
            className="btn-primary-brand"
            type="button"
            style={{ gap: 6 }}
          >
            <Icon name="plus" size={13} /> Ajouter la tâche
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
