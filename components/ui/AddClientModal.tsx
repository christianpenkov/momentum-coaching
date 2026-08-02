'use client';

import { useState } from 'react';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import ModalShell from '@/components/ui/ModalShell';

interface AddClientModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AddClientModal({ open, onClose }: AddClientModalProps) {
  const { refetch } = useSupabaseClients();
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newNiche, setNewNiche] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (!open) return null;

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');

    const res = await fetch('/api/coach/clients/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName.trim(),
        email: newEmail.trim(),
        niche: newNiche.trim() || null,
      }),
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Erreur inconnue' }));
      setSaveError(error);
      setSaving(false);
      return;
    }

    setNewName('');
    setNewEmail('');
    setNewNiche('');
    setSaving(false);
    refetch();
    onClose();
  }

  return (
    <ModalShell onClose={onClose} width={420}>
      <div style={{ padding: '32px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>Ajouter un client</div>
          <button onClick={onClose} aria-label="Fermer" className="icon-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18 }}>×</button>
        </div>
        <form onSubmit={handleAddClient} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Nom *</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} required placeholder="Prénom Nom"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Email *</label>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required placeholder="client@email.fr"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Niche</label>
            <input value={newNiche} onChange={e => setNewNiche(e.target.value)} placeholder="Ex : Fitness, Marketing…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {saveError && (
            <div style={{ fontSize: 12, color: 'var(--red)', padding: '7px 10px', background: 'var(--red-soft)', borderRadius: 6 }}>{saveError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: 13 }}>Annuler</button>
            <button type="submit" disabled={saving} className="btn-primary-brand" style={{ fontSize: 13, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Enregistrement…' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}
