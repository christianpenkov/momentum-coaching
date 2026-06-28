'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

type Tab = 'upcoming' | 'history';

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

export default function PageCalls() {
  const [tab, setTab] = useState<Tab>('upcoming');
  const { calls, clients, loading, refetch } = useSupabaseClients();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Modal création
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<CreateCallForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  // Annulation / suppression (2 étapes)
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  async function syncCalls() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/calendly/sync', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        await refetch();
        setSyncMsg(data.synced > 0
          ? `${data.synced} call${data.synced > 1 ? 's' : ''} Calendly synchronisé${data.synced > 1 ? 's' : ''}`
          : 'Calls à jour');
      } else {
        setSyncMsg(data.error || 'Erreur');
      }
    } catch {
      setSyncMsg('Erreur réseau');
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(null), 4000);
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
        await refetch();
        setShowModal(false);
        setForm(EMPTY_FORM);
        setSyncMsg('✓ Call créé — invitation envoyée à l\'élève');
        setTimeout(() => setSyncMsg(null), 5000);
      } else {
        setCreateMsg(data.error || 'Erreur lors de la création');
      }
    } catch {
      setCreateMsg('Erreur réseau');
    }
    setCreating(false);
  }

  async function handleCancelCall(callId: string) {
    setCancelingId(callId);
    try {
      const res = await fetch(`/api/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'canceled' }),
      });
      const data = await res.json();
      if (data.ok) {
        await refetch();
        setSyncMsg('Call annulé — visible rayé pour l\'élève');
        setTimeout(() => setSyncMsg(null), 4000);
      } else {
        setSyncMsg(data.error || 'Erreur annulation');
        setTimeout(() => setSyncMsg(null), 4000);
      }
    } catch {
      setSyncMsg('Erreur réseau');
      setTimeout(() => setSyncMsg(null), 4000);
    }
    setCancelingId(null);
  }

  async function handleDeleteCall(callId: string) {
    setDeletingId(callId);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/calls/${callId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        await refetch();
        setSyncMsg('Call retiré de l\'interface');
        setTimeout(() => setSyncMsg(null), 4000);
      } else {
        setSyncMsg(data.error || 'Erreur suppression');
        setTimeout(() => setSyncMsg(null), 4000);
      }
    } catch {
      setSyncMsg('Erreur réseau');
      setTimeout(() => setSyncMsg(null), 4000);
    }
    setDeletingId(null);
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const upcoming = calls
    .filter(c => c.scheduled_at && new Date(c.scheduled_at) >= todayStart)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const history = calls
    .filter(c => c.scheduled_at && new Date(c.scheduled_at) < todayStart)
    .sort((a, b) => new Date(b.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime());
  const pending = calls.filter(c => c.status === 'pending_acceptance');

  function getClient(clientId: string) {
    return clients.find(c => c.id === clientId);
  }

  if (loading) return (
    <div className="page-content">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
        <span className="loading-dots"><span /><span /><span /></span>
      </div>
    </div>
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Calls</h1>
          <p className="page-sub">
            {pending.length > 0 && <span style={{ color: 'var(--amber, #f59e0b)', fontWeight: 600 }}>{pending.length} en attente · </span>}
            {upcoming.filter(c => c.status === 'active').length} à venir · {history.length} dans l'historique
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {syncMsg && (
            <span style={{ fontSize: 12, color: syncMsg.includes('Erreur') ? 'var(--red)' : 'var(--green)' }}>
              {syncMsg}
            </span>
          )}
          <button className="btn-ghost" type="button" onClick={syncCalls} disabled={syncing}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="refresh-cw" size={13} />
            {syncing ? 'Sync…' : 'Sync calls'}
          </button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => { setShowModal(true); setCreateMsg(null); }}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="plus" size={13} />
            Créer un call
          </button>
        </div>
      </div>

      {/* Section calls en attente d'acceptation */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            En attente d'acceptation ({pending.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map(call => {
              const cl = getClient(call.client_id || '');
              const displayName = cl?.name || call.invitee_name || '—';
              const initials = cl?.initials || '?';
              const d = new Date(call.scheduled_at!);
              return (
                <div key={call.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderLeft: '3px solid #f59e0b' }}>
                  <div style={{ minWidth: 70, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
                      {d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                      {displayName}
                      {call.topic && <span style={{ fontWeight: 400, color: 'var(--ink)', marginLeft: 6 }}>· {call.topic}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, padding: '3px 8px', background: '#fef3c7', color: '#92400e', borderRadius: 20, fontWeight: 700, border: '1px solid #fde68a', whiteSpace: 'nowrap' }}>
                    Réponse en attente
                  </span>
                  {confirmDeleteId === call.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Retirer ?</span>
                      <button className="btn-ghost" type="button" onClick={() => handleDeleteCall(call.id)} disabled={deletingId === call.id}
                        style={{ fontSize: 11, color: 'var(--red)' }}>
                        {deletingId === call.id ? '…' : 'Oui'}
                      </button>
                      <button className="btn-ghost" type="button" onClick={() => setConfirmDeleteId(null)} style={{ fontSize: 11 }}>Non</button>
                    </div>
                  ) : (
                    <button className="btn-ghost" type="button"
                      onClick={() => call.status === 'canceled' ? setConfirmDeleteId(call.id) : handleCancelCall(call.id)}
                      disabled={cancelingId === call.id}
                      style={{ fontSize: 11, color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon name={call.status === 'canceled' ? 'trash' : 'x'} size={12} />
                      {cancelingId === call.id ? '…' : call.status === 'canceled' ? 'Retirer' : 'Annuler'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        <button className={`chip${tab === 'upcoming' ? ' chip-active' : ''}`} onClick={() => setTab('upcoming')} type="button">
          À venir ({upcoming.filter(c => c.status === 'active').length})
        </button>
        <button className={`chip${tab === 'history' ? ' chip-active' : ''}`} onClick={() => setTab('history')} type="button">
          Historique ({history.length})
        </button>
      </div>

      {tab === 'upcoming' && (
        upcoming.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
            Aucun call planifié pour le moment.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {upcoming.map(call => {
              const cl = getClient(call.client_id || '');
              const displayName = cl?.name || call.invitee_name || call.invitee_email || '—';
              const initials = cl?.initials || (call.invitee_name ? call.invitee_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() : '?');
              const d = new Date(call.scheduled_at!);
              const isGoogle = (call as { call_type?: string }).call_type === 'google';
              return (
                <div key={call.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
                  <div style={{ minWidth: 80, textAlign: 'center', opacity: ['canceled','declined'].includes(call.status || '') ? 0.55 : 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono)', textDecoration: ['canceled','declined'].includes(call.status || '') ? 'line-through' : 'none' }}>
                      {d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                  <div style={{ width: 1, height: 40, background: 'var(--border)', opacity: ['canceled','declined'].includes(call.status || '') ? 0.55 : 1 }} />
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0, opacity: ['canceled','declined'].includes(call.status || '') ? 0.55 : 1 }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, opacity: ['canceled','declined'].includes(call.status || '') ? 0.55 : 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>
                      {displayName}
                      {call.topic && <span style={{ fontWeight: 400, color: 'var(--ink)', marginLeft: 6 }}>· {call.topic}</span>}
                    </div>
                    {isGoogle && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Google Meet</div>}
                  </div>
                  {call.join_url && call.status !== 'canceled' && (
                    <a href={call.join_url} target="_blank" rel="noopener noreferrer" className="btn-ghost"
                      style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px' }}>
                      <Icon name="video" size={13} /> Rejoindre
                    </a>
                  )}
                  {isGoogle && (
                    confirmDeleteId === call.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Retirer ?</span>
                        <button className="btn-ghost" type="button" onClick={() => handleDeleteCall(call.id)} disabled={deletingId === call.id}
                          style={{ fontSize: 11, color: 'var(--red)', border: '1px solid #fca5a5', borderRadius: 8, padding: '4px 10px' }}>{deletingId === call.id ? '…' : 'Oui'}</button>
                        <button className="btn-ghost" type="button" onClick={() => setConfirmDeleteId(null)} style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px' }}>Non</button>
                      </div>
                    ) : (
                      <button className="btn-ghost" type="button"
                        onClick={() => ['canceled','declined'].includes(call.status || '') ? setConfirmDeleteId(call.id) : setConfirmCancelId(call.id)}
                        disabled={cancelingId === call.id}
                        style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--red)', border: '1px solid #fca5a5', borderRadius: 8, padding: '4px 10px' }}>
                        <Icon name={['canceled','declined'].includes(call.status || '') ? 'trash' : 'x'} size={13} />
                        {cancelingId === call.id ? '…' : ['canceled','declined'].includes(call.status || '') ? 'Retirer' : 'Annuler'}
                      </button>
                    )
                  )}
                  {call.status === 'canceled' ? (
                    <span className="pill" style={{ fontSize: 11, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>Annulé</span>
                  ) : call.status === 'declined' ? (
                    <span className="pill" style={{ fontSize: 11, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>Refusé</span>
                  ) : isGoogle ? (
                    call.status === 'active' && <span className="pill pill-green" style={{ fontSize: 11 }}>Accepté</span>
                  ) : (
                    <span className={`pill pill-${call.ready === 'ready' ? 'green' : 'amber'}`} style={{ fontSize: 11 }}>
                      {call.ready === 'ready' ? 'Prêt' : 'En attente'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === 'history' && (
        history.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
            Aucun call dans l'historique.
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Sujet</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {history.map(call => {
                  const cl = getClient(call.client_id || '');
                  const displayName = cl?.name || call.invitee_name || call.invitee_email || '—';
                  const initials = cl?.initials || (call.invitee_name ? call.invitee_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() : '?');
                  const d = new Date(call.scheduled_at!);
                  return (
                    <tr key={call.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                            {initials}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{displayName}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{call.topic || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 200 }}>{call.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Modal création de call — portal sur document.body pour éviter le stacking context de la sidebar */}
      {showModal && createPortal(
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 440, padding: 28, margin: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
                Créer un call Google Meet
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
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
                  onClick={() => setShowModal(false)}
                  style={{ flex: 1 }}
                  disabled={creating}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn-primary"
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
      )}

      {/* Modal confirmation annulation */}
      {confirmCancelId && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmCancelId(null); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 380, padding: 24, margin: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>Annuler ce call ?</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.5 }}>
              L'élève sera notifié et l'événement Google Calendar sera supprimé.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-ghost" type="button" style={{ flex: 1 }} onClick={() => setConfirmCancelId(null)}>
                Retour
              </button>
              <button
                className="btn-primary"
                type="button"
                style={{ flex: 1, background: '#ef4444', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                disabled={cancelingId === confirmCancelId}
                onClick={async () => {
                  const id = confirmCancelId;
                  setConfirmCancelId(null);
                  await handleCancelCall(id);
                }}
              >
                {cancelingId === confirmCancelId ? '…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
