'use client';

import Link from 'next/link';
import KpiRibbon from '@/components/ui/KpiRibbon';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import { StaggerGrid, StaggerItem } from '@/components/ui/StaggerGrid';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

export default function PageToday() {
  const { clients, calls, loading } = useSupabaseClients();

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

  const kpis = [
    { label: 'MRR total', sub: 'tous clients', value: totalMRR, formatter: (n: number) => `${n.toLocaleString('fr-FR')} €` },
    { label: 'Clients actifs', sub: 'en cours de coaching', value: activeCount },
    { label: 'En vert', value: greenCount },
    { label: 'Calls aujourd\'hui', value: callsToday.length },
  ];

  const today = new Date();
  const dayLabel = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayCapitalized = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);

  if (loading) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1 className="page-title">Dashboard</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 13, paddingTop: 40, justifyContent: 'center' }}>
          <Icon name="refresh-cw" size={16} /> Chargement…
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bonjour 👋</h1>
          <p className="page-sub">{dayCapitalized} · {callsToday.length} call{callsToday.length !== 1 ? 's' : ''} aujourd'hui</p>
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
                  <div key={call.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                <div key={client.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
              ))}
            </div>
          </div>
        </StaggerItem>
      </StaggerGrid>

      {/* Aperçu clients */}
      {clients.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-head">
            <div className="card-title">Tous tes clients</div>
            <Link href="/clients" className="btn-ghost" style={{ fontSize: 12 }}>
              Voir tout <Icon name="chevR" size={12} />
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 16 }}>
            {clients.slice(0, 5).map((client, i) => (
              <div key={client.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < Math.min(clients.length, 5) - 1 ? '1px solid var(--border)' : 'none' }}>
                <Avatar initials={client.initials || '??'} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent)' }}>{client.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}> · {client.niche || 'Infopreneur'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Pill status={client.status} label={client.status === 'green' ? 'Vert' : client.status === 'amber' ? 'Vigilance' : 'Alerte'} size="sm" />
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>S{client.week}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    {(client.latestMetrics?.stripe_mrr || 0).toLocaleString('fr-FR')} €
                  </div>
                </div>
                <Link href={`/clients/${client.id}`} className="btn-ghost" style={{ fontSize: 11 }}>
                  <Icon name="chevR" size={12} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {clients.length === 0 && !loading && (
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🎯</div>
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
