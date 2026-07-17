'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AddClientModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AddClientModal({ open, onClose }: AddClientModalProps) {
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
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaveError('Non connecté'); setSaving(false); return; }

    const { error } = await supabase.from('clients').insert({
      coach_id: user.id,
      name: newName.trim(),
      email: newEmail.trim() || null,
      niche: newNiche.trim() || null,
      status: 'green',
      week: 1,
    });

    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }

    setNewName('');
    setNewEmail('');
    setNewNiche('');
    setSaving(false);
    window.location.reload();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '32px 28px', width: 420, boxShadow: 'var(--shadow-elev)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>Ajouter un client</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18 }}>×</button>
        </div>
        <form onSubmit={handleAddClient} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Nom *</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} required placeholder="Prénom Nom"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Email</label>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="client@email.fr"
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
            <button type="submit" disabled={saving} className="btn-primary" style={{ fontSize: 13, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Enregistrement…' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
