'use client';

import { useState } from 'react';
import ModalShell from './ModalShell';
import Icon from './Icon';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import type { Task } from '@/lib/supabase/types';

interface Props {
  clientId?: string;
  task?: Task | null;
  onClose: () => void;
  onCreated: () => void;
}

const PRIORITIES = [
  { value: 'high',   label: 'Haute',   color: 'var(--red)' },
  { value: 'medium', label: 'Moyenne', color: 'var(--amber)' },
  { value: 'low',    label: 'Basse',   color: 'var(--green)' },
] as const;

function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TaskModal({ clientId: fixedClientId, task, onClose, onCreated }: Props) {
  const { clients } = useSupabaseClients();
  const isEdit = !!task;
  const [label, setLabel] = useState(task?.label || '');
  const [deadline, setDeadline] = useState(task?.deadline ? toDateInput(task.deadline) : '');
  const [deadlineTime, setDeadlineTime] = useState(task?.deadline ? toTimeInput(task.deadline) : '23:59');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>(task?.priority || 'medium');
  const [requiresAttachment, setRequiresAttachment] = useState(task?.requires_attachment || false);
  const [selectedClientId, setSelectedClientId] = useState(task?.client_id || '');
  const [errorField, setErrorField] = useState<'label' | 'deadline' | 'client' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!label.trim()) { setErrorField('label'); setErrorMessage('Le titre est obligatoire.'); return; }
    if (!deadline) { setErrorField('deadline'); setErrorMessage('La deadline est obligatoire.'); return; }
    const clientId = fixedClientId || selectedClientId;
    if (!clientId) { setErrorField('client'); setErrorMessage('Sélectionne un élève.'); return; }
    setSaving(true);
    setErrorField(null); setErrorMessage('');
    try {
      const [h, m] = (deadlineTime || '23:59').split(':').map(Number);
      const [y, mo, d] = deadline.split('-').map(Number);
      const deadlineIso = new Date(y, mo - 1, d, h, m).toISOString();
      const res = await fetch(isEdit ? `/api/tasks/${task!.id}` : '/api/tasks', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEdit ? {} : { client_id: clientId }),
          label: label.trim(),
          deadline: deadlineIso,
          priority,
          requires_attachment: requiresAttachment,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erreur lors de ${isEdit ? "l'édition" : 'la création'}`);
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setErrorField('label');
      setErrorMessage(e.message || `Erreur lors de ${isEdit ? "l'édition" : 'la création'}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} width={680}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name={isEdit ? 'edit' : 'plus'} size={16} />
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>{isEdit ? 'Modifier la tâche' : 'Assigner une tâche'}</span>
        </div>
        <button onClick={onClose} type="button" className="icon-btn"><Icon name="x" size={15} /></button>
      </div>

      {/* Body */}
      <div style={{ padding: '20px 24px', overflowY: 'auto' }}>
        {/* Titre */}
        <div style={{ marginBottom: 16 }}>
          <label className="eyebrow-sm" style={{ color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
            Titre de la tâche *
          </label>
          <input
            autoFocus
            value={label}
            onChange={e => { setLabel(e.target.value); if (errorField === 'label') { setErrorField(null); setErrorMessage(''); } }}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder="Ex: Publier 3 Reels cette semaine"
            style={{
              width: '100%', padding: '10px 14px',
              border: `1px solid ${errorField === 'label' ? 'var(--red)' : 'var(--border)'}`,
              borderRadius: 10, fontSize: 13, background: 'var(--surface-2)',
              color: 'var(--accent)', outline: 'none', fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          {errorField === 'label' && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{errorMessage}</div>}
        </div>

        {/* Deadline + Priorité côte à côte */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
          <div>
            <label className="eyebrow-sm" style={{ color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              Deadline *
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="date"
                value={deadline}
                onChange={e => { setDeadline(e.target.value); if (errorField === 'deadline') { setErrorField(null); setErrorMessage(''); } }}
                style={{
                  flex: 1, padding: '9px 12px',
                  border: `1px solid ${errorField === 'deadline' ? 'var(--red)' : 'var(--border)'}`, borderRadius: 10,
                  fontSize: 13, background: 'var(--surface-2)',
                  color: deadline ? 'var(--accent)' : 'var(--muted)',
                  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', cursor: 'pointer',
                }}
              />
              <input
                type="time"
                value={deadlineTime}
                onChange={e => setDeadlineTime(e.target.value || '23:59')}
                title="Heure à laquelle la tâche devient en retard (23:59 par défaut)"
                style={{
                  width: 96, padding: '9px 10px',
                  border: '1px solid var(--border)', borderRadius: 10,
                  fontSize: 13, background: 'var(--surface-2)',
                  color: 'var(--accent)',
                  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', cursor: 'pointer',
                }}
              />
            </div>
            {errorField === 'deadline' && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{errorMessage}</div>}
          </div>
          <div>
            <label className="eyebrow-sm" style={{ color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
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
                    cursor: 'pointer', transition: 'all var(--dur-quick, 180ms)',
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

        {/* Dépôt de documents exigé */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requiresAttachment}
              onChange={e => setRequiresAttachment(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
              Exiger un dépôt de documents
            </span>
          </label>
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
                  {new Date(`${deadline}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  {deadlineTime !== '23:59' && ` · ${deadlineTime}`}
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

        {/* Élève (uniquement en création, si pas déjà fixé par le contexte d'appel) */}
        {!isEdit && !fixedClientId && (
          <div>
            <label className="eyebrow-sm" style={{ color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              Élève *
            </label>
            <select
              value={selectedClientId}
              onChange={e => { setSelectedClientId(e.target.value); if (errorField === 'client') { setErrorField(null); setErrorMessage(''); } }}
              style={{
                width: '100%', padding: '10px 14px',
                border: `1px solid ${errorField === 'client' ? 'var(--red)' : 'var(--border)'}`,
                borderRadius: 10, fontSize: 13, background: 'var(--surface-2)',
                color: selectedClientId ? 'var(--accent)' : 'var(--muted)',
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', cursor: 'pointer',
              }}
            >
              <option value="">Sélectionner un élève…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errorField === 'client' && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{errorMessage}</div>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onClose} className="btn-ghost" type="button" disabled={saving}>Annuler</button>
        <button
          onClick={handleSubmit}
          className="btn-primary-brand"
          type="button"
          style={{ gap: 6 }}
          disabled={saving}
        >
          <Icon name={isEdit ? 'check' : 'plus'} size={13} /> {saving ? 'Enregistrement…' : (isEdit ? 'Enregistrer' : 'Assigner la tâche')}
        </button>
      </div>
    </ModalShell>
  );
}
