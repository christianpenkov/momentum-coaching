'use client';

import { useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import Icon from '@/components/ui/Icon';
import { callsToday, callsHistory, clients } from '@/lib/data';

type Tab = 'upcoming' | 'history';

function getClient(id: string) {
  return clients.find(c => c.id === id);
}

export default function PageCalls() {
  const [tab, setTab] = useState<Tab>('upcoming');

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Calls</h1>
          <p className="page-sub">{callsToday.length} aujourd'hui · {callsHistory.length} dans l'historique</p>
        </div>
        <button className="btn-primary" type="button">
          <Icon name="plus" size={14} /> Planifier un call
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        <button className={`chip${tab === 'upcoming' ? ' chip-active' : ''}`} onClick={() => setTab('upcoming')} type="button">
          À venir ({callsToday.length})
        </button>
        <button className={`chip${tab === 'history' ? ' chip-active' : ''}`} onClick={() => setTab('history')} type="button">
          Historique ({callsHistory.length})
        </button>
      </div>

      {tab === 'upcoming' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {callsToday.map(call => {
            const cl = getClient(call.clientId);
            const isReady = call.ready === 'ready';
            return (
              <div key={call.clientId} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
                <div style={{ minWidth: 64, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{call.time}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Aujourd'hui</div>
                </div>
                <div style={{ width: 1, height: 40, background: 'var(--border)' }} />
                <Avatar initials={cl?.initials || '??'} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent)' }}>{cl?.name || call.clientId}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{call.topic}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    {call.duration} · <span style={{ color: 'var(--accent)' }}>Zoom</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={`pill pill-${isReady ? 'green' : 'amber'}`} style={{ fontSize: 11 }}>
                    {isReady ? 'Prêt' : 'Partiel'}
                  </span>
                  <Link href={`/clients/${call.clientId}/brief`} className="btn-ghost" style={{ fontSize: 12 }}>
                    Brief IA
                  </Link>
                  <button className="btn-primary" style={{ fontSize: 12 }} type="button">
                    <Icon name="video" size={13} /> Rejoindre
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'history' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Durée</th>
                <th>Sujet</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {callsHistory.map((call, i) => {
                const cl = getClient(call.clientId);
                return (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{call.date}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar initials={cl?.initials || '??'} size={28} />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{cl?.name || call.clientId}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{call.duration}</td>
                    <td style={{ fontSize: 12 }}>{call.topic}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 200 }}>
                      {call.notes || '—'}
                    </td>
                    <td>
                      <Link href={`/clients/${call.clientId}`} className="btn-ghost" style={{ fontSize: 12 }}>
                        Fiche
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
