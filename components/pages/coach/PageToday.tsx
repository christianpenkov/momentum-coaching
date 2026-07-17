'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useState } from 'react';
import Link from 'next/link';
import KpiRibbon from '@/components/ui/KpiRibbon';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import AddClientModal from '@/components/ui/AddClientModal';
import { StaggerGrid, StaggerItem } from '@/components/ui/StaggerGrid';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { useUser } from '@/lib/UserContext';

const STATUS_BAR_WIDTH: Record<string, number> = { green: 90, amber: 55, red: 25 };
const STATUS_BAR_COLOR: Record<string, string> = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };

export default function PageToday() {
  const { clients, calls, loading } = useSupabaseClients();
  const { user } = useUser();
  const [showAddModal, setShowAddModal] = useState(false);

  const totalMRR = clients.reduce((sum, c) => sum + (c.latestMetrics?.stripe_mrr || 0), 0);
  const activeCount = clients.length;
  const greenCount = clients.filter(c => c.status === 'green').length;
  const watchList = clients.filter(c => c.status === 'amber' || c.status === 'red').slice(0, 4);

  const callsToday = calls.filter(call => {
    if (!call.scheduled_at) return false;
    const d = new Date(call.scheduled_at);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });

  const mrrSeries = clients.length > 0
    ? clients[0].weeklyMetrics.slice(-8).map((_, i) =>
        clients.reduce((sum, c) => sum + (c.weeklyMetrics[c.weeklyMetrics.length - 8 + i]?.stripe_mrr || 0), 0))
    : [];

  const kpis = [
    {
      label: 'MRR total', sub: 'tous clients', value: totalMRR,
      formatter: (n: number) => `${n.toLocaleString('fr-FR')} €`,
      viz: mrrSeries.length > 1 ? <Sparkbars data={mrrSeries} height={26} width={110} color="var(--accent-brand)" /> : undefined,
    },
    {
      label: 'Clients actifs', sub: 'en cours de coaching', value: activeCount,
      viz: activeCount > 0 ? (
        <div style={{ display: 'flex', gap: 4 }}>
          {clients.slice(0, 5).map(c => (
            <span key={c.id} style={{ flex: 1, height: 6, borderRadius: 3, background: STATUS_BAR_COLOR[c.status] || 'var(--faint)' }} />
          ))}
        </div>
      ) : undefined,
    },
    {
      label: 'En vert', value: greenCount,
      sub: activeCount > 0 ? `${Math.round((greenCount / activeCount) * 100)}% du portefeuille` : undefined,
    },
    {
      label: 'Calls aujourd\'hui', value: callsToday.length,
      viz: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--accent-brand)', fontWeight: 500 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-brand)', animation: 'pulse 2s ease-in-out infinite' }} />
          live
        </span>
      ),
    },
  ];

  const today = new Date();
  const dayLabel = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayCapitalized = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
  const firstName = (user?.full_name || '').split(' ')[0];

  if (loading) return <InlineLoader fullPage />;

  return (
    <div className="page-content">
      <AddClientModal open={showAddModal} onClose={() => setShowAddModal(false)} />

      <div className="page-header">
        <div>
          <div className="mono" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>
            {dayCapitalized}
          </div>
          <h1 className="page-title">Bonjour{firstName ? ` ${firstName}` : ''}</h1>
          <p className="page-sub">{callsToday.length} call{callsToday.length !== 1 ? 's' : ''} aujourd'hui</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href="/calendar" className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Icon name="calendar" size={14} /> Planifier
          </Link>
          <button type="button" onClick={() => setShowAddModal(true)} className="btn-primary btn-primary-brand" style={{ fontSize: 13 }}>
            <Icon name="plus" size={13} /> Nouvel élève
          </button>
        </div>
      </div>

      <KpiRibbon items={kpis} />

      <StaggerGrid className="grid-2" style={{ marginTop: 24 }}>
        {/* Calls du jour */}
        <StaggerItem>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Calls du jour</div>
                <div className="card-sub">{callsToday.length} session{callsToday.length !== 1 ? 's' : ''} planifiée{callsToday.length !== 1 ? 's' : ''}</div>
              </div>
              <Link href="/calls" className="btn-ghost" style={{ fontSize: 12 }}>
                Voir tout <Icon name="chevR" size={12} />
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              {callsToday.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>Aucun call prévu aujourd'hui.</div>
              )}
              {callsToday.map((call) => {
                const client = clients.find(c => c.id === call.client_id);
                const isReady = call.ready === 'ready';
                const time = call.scheduled_at
                  ? new Date(call.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                  : '—';
                return (
                  <div key={call.id} className="dc-liftrow" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', margin: '0 -8px' }}>
                    <Avatar initials={client?.initials || '??'} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{client?.name || '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{call.topic || 'Call coaching'}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{time}</div>
                      <span className={`pill pill-${isReady ? 'green' : 'amber'}`} style={{ fontSize: 10, padding: '2px 6px' }}>
                        {isReady ? 'Prêt' : 'Partiel'}
                      </span>
                    </div>
                    {client && (
                      <Link href={`/clients/${client.id}/brief`} className="btn-ghost" style={{ fontSize: 11, marginLeft: 4 }}>
                        Brief
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </StaggerItem>

        {/* À surveiller */}
        <StaggerItem>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">À surveiller</div>
                <div className="card-sub">Clients en vigilance ou alerte</div>
              </div>
              <Link href="/clients" className="btn-ghost" style={{ fontSize: 12 }}>
                Voir tout <Icon name="chevR" size={12} />
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              {watchList.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--green)', padding: '8px 0' }}>Tous tes clients sont au vert ✓</div>
              )}
              {watchList.map((client) => (
                <div key={client.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar initials={client.initials || '??'} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{client.name}</span>
                        <Pill status={client.status} label={client.status === 'amber' ? 'Vigilance' : 'Alerte'} size="sm" />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{(client.status_text || '').slice(0, 45)}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>S{client.week}</div>
                      <Sparkbars
                        data={client.weeklyMetrics.slice(-6).map(w => w.posts_count)}
                        height={20} width={40}
                      />
                    </div>
                    <Link href={`/clients/${client.id}`} className="btn-ghost" style={{ fontSize: 11 }}>
                      <Icon name="chevR" size={12} />
                    </Link>
                  </div>
                  <div className="momentum-bar-track" style={{ marginTop: 8, marginLeft: 46 }}>
                    <div
                      className="momentum-bar-fill"
                      style={{
                        width: `${STATUS_BAR_WIDTH[client.status] ?? 0}%`,
                        background: STATUS_BAR_COLOR[client.status] || 'var(--faint)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </StaggerItem>
      </StaggerGrid>

      {/* Aperçu clients */}
      {clients.length > 0 && (
        <div className="card" style={{ marginTop: 24, padding: 0, overflow: 'hidden' }}>
          <div className="card-head" style={{ padding: '18px 18px 0' }}>
            <div className="card-title">Tous tes clients</div>
            <Link href="/clients" className="btn-ghost" style={{ fontSize: 12 }}>
              Voir tout <Icon name="chevR" size={12} />
            </Link>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>Élève</th>
                  <th>Statut</th>
                  <th>Semaine</th>
                  <th>Tendance</th>
                  <th style={{ textAlign: 'right' }}>MRR</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clients.slice(0, 5).map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link href={`/clients/${client.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
                        <Avatar initials={client.initials || '??'} size={30} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent)' }}>{client.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{client.niche || 'Infopreneur'}</div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <Pill status={client.status} label={client.status === 'green' ? 'Vert' : client.status === 'amber' ? 'Vigilance' : 'Alerte'} size="sm" />
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>S{client.week}</td>
                    <td>
                      <Sparkbars
                        data={client.weeklyMetrics.slice(-6).map(w => w.posts_count)}
                        height={20} width={48}
                      />
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                      {(client.latestMetrics?.stripe_mrr || 0).toLocaleString('fr-FR')} €
                    </td>
                    <td>
                      <Link href={`/clients/${client.id}`} className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>
                        <Icon name="chevR" size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {clients.length === 0 && !loading && (
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: '40px 20px' }}>
          <Icon name="target" size={32} color="var(--faint)" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Prêt à démarrer</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
            Ton premier client apparaîtra ici dès qu'il aura créé son accès via le lien d'invitation.
          </div>
          <Link href="/clients" className="btn-primary" style={{ fontSize: 13 }}>
            <Icon name="plus" size={13} /> Ajouter un client manuellement
          </Link>
        </div>
      )}
    </div>
  );
}
