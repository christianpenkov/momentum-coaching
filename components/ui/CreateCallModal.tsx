'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

interface CreateCallForm {
  clientId: string;
  topic: string;
  date: string;
  startHour: string;
  startMinute: string;
  durationMin: string;
}

const EMPTY_FORM: CreateCallForm = {
  clientId: '',
  topic: '',
  date: '',
  startHour: '',
  startMinute: '00',
  durationMin: '60',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateCallModal({ open, onClose, onCreated }: Props) {
  const { clients } = useSupabaseClients();
  const [form, setForm] = useState<CreateCallForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  if (!open) return null;

  function handleClose() {
    setForm(EMPTY_FORM);
    setCreateMsg(null);
    onClose();
  }

  async function handleCreateCall(e: React.FormEvent) {
    e.preventDefault();
    if (!form.clientId || !form.date || !form.startHour) return;

    setCreating(true);
    setCreateMsg(null);

    const startTime = new Date(`${form.date}T${form.startHour}:${form.startMinute}:00`);
    const endTime = new Date(startTime.getTime() + parseInt(form.durationMin) * 60 * 1000);
    const client = clients.find(c => c.id === form.clientId);

    try {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: form.clientId,
          clientName: client?.name || 'Client',
          topic: form.topic || 'Call coaching',
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onCreated();
        setForm(EMPTY_FORM);
        onClose();
      } else {
        setCreateMsg(data.error || 'Erreur lors de la création');
      }
    } catch {
      setCreateMsg('Erreur réseau');
    }
    setCreating(false);
  }

  return createPortal(
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 440, padding: 28, margin: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
            Créer un call Google Meet
          </h2>
          <button
            type="button"
            onClick={handleClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <form onSubmit={handleCreateCall} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              Client
            </label>
            <select
              className="input"
              value={form.clientId}
              onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
              required
              style={{ width: '100%' }}
            >
              <option value="">Sélectionner un client…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              Sujet
            </label>
            <input
              className="input"
              type="text"
              placeholder="Call coaching"
              value={form.topic}
              onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                Date
              </label>
              <input
                className="input"
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                required
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                Heure de début
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <select
                  className="input"
                  value={form.startHour}
                  onChange={e => setForm(f => ({ ...f, startHour: e.target.value }))}
                  required
                  style={{ width: '100%' }}
                >
                  <option value="">h</option>
                  {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <select
                  className="input"
                  value={form.startMinute}
                  onChange={e => setForm(f => ({ ...f, startMinute: e.target.value }))}
                  style={{ width: '100%' }}
                >
                  {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              Durée
            </label>
            <select
              className="input"
              value={form.durationMin}
              onChange={e => setForm(f => ({ ...f, durationMin: e.target.value }))}
              style={{ width: '100%' }}
            >
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">1h</option>
              <option value="90">1h30</option>
              <option value="120">2h</option>
            </select>
          </div>

          {createMsg && (
            <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6 }}>
              {createMsg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleClose}
              style={{ flex: 1 }}
              disabled={creating}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn-primary-brand"
              style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              disabled={creating}
            >
              {creating ? (
                <><Icon name="refresh-cw" size={13} /> Création…</>
              ) : (
                <><Icon name="video" size={13} /> Créer le call</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
