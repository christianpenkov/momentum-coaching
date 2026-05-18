'use client';

import { useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import type { Call, Client } from '@/lib/supabase/types';

type Tab = 'upcoming' | 'history';

export default function PageCalls() {
  const [tab, setTab] = useState<Tab>('upcoming');
  const { calls, clients, loading } = useSupabaseClients();

  const now = new Date();
  const upcoming = calls.filter(c => c.scheduled_at && new Date(c.scheduled_at) >= now)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const history = calls.filter(c => c.scheduled_at && new Date(c.scheduled_at) < now)
    .sort((a, b) => new Date(b.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime());

  function getClient(clientId: string) {
    return clients.find(c => c.id === clientId);
  }

  if (loading) {
    return (
      <div className="page-content">
        <div className="page-header"><h1 className="page-title">Calls</h1></div>
        <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          <Icon name="refresh-cw" size={16} /> Chargement…
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Calls</h1>
          <p className="page-sub">{upcoming.length} à venir · {history.length} dans l'historique</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        <button className={`chip${tab === 'upcoming' ? ' chip-active' : ''}`} onClick={() => setTab('upcoming')} type="button">
          À venir ({upcoming.length})
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
              const cl = getClient(call.client_id);
              const d = new Date(call.scheduled_at!);
              return (
                <div key={call.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
                  <div style={{ minWidth: 80, textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
                      {d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                  <div style={{ width: 1, height: 40, background: 'var(--border)' }} />
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {cl?.initials || '??'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{cl?.name || '—'}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{call.topic || 'Call coaching'}</div>
                  </div>
                  <span className={`pill pill-${call.ready === 'ready' ? 'green' : 'amber'}`} style={{ fontSize: 11 }}>
                    {call.ready === 'ready' ? 'Prêt' : 'En attente'}
                  </span>
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
                  const cl = getClient(call.client_id);
                  const d = new Date(call.scheduled_at!);
                  return (
                    <tr key={call.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                            {cl?.initials || '??'}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{cl?.name || '—'}</span>
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
    </div>
  );
}
