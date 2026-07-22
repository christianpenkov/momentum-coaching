'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import Avatar from '@/components/ui/Avatar';
import SessionRapportModal from '@/components/ui/SessionRapportModal';
import CreateCallModal from '@/components/ui/CreateCallModal';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { getPendingSessionRapports, isCallReallyOver } from '@/lib/sessionRapport';
import type { Call } from '@/lib/supabase/types';

type Tab = 'upcoming' | 'history';

export default function PageCalls() {
  const [tab, setTab] = useState<Tab>('upcoming');
  const { calls, clients, loading, refetch } = useSupabaseClients();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Modal création
  const [showModal, setShowModal] = useState(false);

  // Annulation / suppression (2 étapes)
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  // Rapports de session Google Meet en attente — même condition que le badge élève
  const [openSessionRapportCall, setOpenSessionRapportCall] = useState<{ callId: string; clientName: string | null; scheduledAt: string | null } | null>(null);
  const pendingSessionRapportIds = new Set(getPendingSessionRapports(calls as Call[]).map(c => c.id));

  // Force un recalcul du split upcoming/historique chaque minute, pour que la
  // bascule se fasse en temps réel sans dépendre uniquement des changements
  // de `calls` déclenchés par le realtime.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

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

  function handleCallCreated() {
    refetch();
    setSyncMsg('✓ Call créé — invitation envoyée à l\'élève');
    setTimeout(() => setSyncMsg(null), 5000);
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

  // Un call reste "à venir" jusqu'à son heure de fin réelle (scheduled_at + duration),
  // pas jusqu'à minuit — nowTick force ce recalcul chaque minute (voir useEffect ci-dessus).
  const upcoming = calls
    .filter(c => c.scheduled_at && !isCallReallyOver(c, nowTick))
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const history = calls
    .filter(c => c.scheduled_at && isCallReallyOver(c, nowTick))
    .sort((a, b) => new Date(b.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime());
  const upcomingActive = upcoming.filter(c => c.status === 'active');
  // "Prochain call" ignore aussi un call dont le rapport est déjà rempli (coach en
  // avance) même s'il n'est pas encore basculé en historique — c'est déjà le premier
  // filtre d'isCallReallyOver ci-dessus, donc upcomingActive[0] est toujours correct.
  const nextCall = upcomingActive[0] ?? null;
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
            {upcomingActive.length} à venir · {history.length} dans l'historique
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
            className="btn-primary-brand"
            type="button"
            onClick={() => setShowModal(true)}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="plus" size={13} />
            Créer un call
          </button>
        </div>
      </div>

      {/* Prochain call — même bandeau que côté élève, agrégé tous élèves */}
      {nextCall?.scheduled_at && (() => {
        const cl = getClient(nextCall.client_id || '');
        const displayName = cl?.name || nextCall.invitee_name || '—';
        const isGoogle = (nextCall as { call_type?: string }).call_type === 'google';
        return (
          <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid var(--accent-brand)', padding: '24px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>PROCHAIN CALL</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: isGoogle ? 'var(--surface-2)' : 'var(--accent-brand-soft)', color: isGoogle ? 'var(--accent)' : 'var(--accent-brand)' }}>
                    {isGoogle ? 'Coaching' : 'Prospect'}
                  </span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2, textTransform: 'capitalize' }}>
                  {new Date(nextCall.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)', marginTop: 2 }}>
                  {new Date(nextCall.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  {nextCall.duration && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>· {nextCall.duration}</span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                  {displayName}{nextCall.topic ? ` · ${nextCall.topic}` : ''}
                </div>
              </div>
              <div style={{ padding: '16px 20px', background: 'var(--surface-2)', borderRadius: 12, textAlign: 'center', minWidth: 110 }}>
                {(() => {
                  const diffMs = new Date(nextCall.scheduled_at).getTime() - nowTick;
                  const days = Math.ceil(diffMs / 86_400_000);
                  return (
                    <>
                      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                        {days <= 0 ? 'Auj.' : `J-${days}`}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {days <= 0 ? "aujourd'hui" : days === 1 ? 'demain' : `dans ${days}j`}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

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
                  <Avatar initials={initials} avatarUrl={cl?.avatar_url} size={34} />
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
          À venir ({upcomingActive.length})
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
                  <div style={{ flexShrink: 0, opacity: ['canceled','declined'].includes(call.status || '') ? 0.55 : 1 }}>
                    <Avatar initials={initials} avatarUrl={cl?.avatar_url} size={40} />
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
                  {isGoogle && pendingSessionRapportIds.has(call.id) && (
                    <button
                      type="button"
                      className="btn-primary-brand"
                      style={{ fontSize: 11, background: 'var(--accent-brand)', flexShrink: 0 }}
                      onClick={() => setOpenSessionRapportCall({ callId: call.id, clientName: cl?.name ?? null, scheduledAt: call.scheduled_at })}
                    >
                      Rapport
                    </button>
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
                          <Avatar initials={initials} avatarUrl={cl?.avatar_url} size={28} />
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{displayName}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{call.topic || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 200 }}>
                        {pendingSessionRapportIds.has(call.id) ? (
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ fontSize: 11, color: 'var(--accent-brand)', border: '1px solid var(--accent-brand)' }}
                            onClick={() => setOpenSessionRapportCall({ callId: call.id, clientName: cl?.name ?? null, scheduledAt: call.scheduled_at })}
                          >
                            Rapport
                          </button>
                        ) : (call.notes || '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      <CreateCallModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={handleCallCreated}
      />

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
                className="btn-primary-brand"
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

      {openSessionRapportCall && (
        <SessionRapportModal
          callId={openSessionRapportCall.callId}
          studentName={openSessionRapportCall.clientName}
          scheduledAt={openSessionRapportCall.scheduledAt}
          onClose={() => { setOpenSessionRapportCall(null); refetch(); }}
        />
      )}
    </div>
  );
}
