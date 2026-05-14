'use client';

import Link from 'next/link';
import KpiRibbon from '@/components/ui/KpiRibbon';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import { callsToday, activity24h, getWatchList, getTotalMRR, getActiveClients, clients } from '@/lib/data';
import { StaggerGrid, StaggerItem } from '@/components/ui/StaggerGrid';

function getClientById(id: string) {
  return clients.find(c => c.id === id);
}

export default function PageToday() {
  const watchList = getWatchList().slice(0, 4);
  const totalMRR = getTotalMRR();
  const activeCount = getActiveClients();
  const greenCount = clients.filter(c => c.status === 'green').length;

  const kpis = [
    { label: 'MRR total', sub: 'tous clients', value: totalMRR, formatter: (n: number) => `${n.toLocaleString('fr-FR')} €` },
    { label: 'Clients actifs', sub: 'en cours de coaching', value: activeCount },
    { label: 'En vert', value: greenCount },
    { label: 'Calls aujourd\'hui', value: callsToday.length },
    { label: 'Taux rétention', value: 91, formatter: (n: number) => `${n}%`, color: 'var(--green)' },
  ];

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bonjour, Marc 👋</h1>
          <p className="page-sub">Jeudi 14 mai · {callsToday.length} calls aujourd'hui</p>
        </div>
      </div>

      <KpiRibbon items={kpis} />

      <StaggerGrid className="grid-2" style={{ marginTop: 24 }}>
        {/* Calls du jour */}
        <StaggerItem><div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Calls du jour</div>
              <div className="card-sub">{callsToday.length} sessions planifiées</div>
            </div>
            <Link href="/calls" className="btn-ghost" style={{ fontSize: 12 }}>
              Voir tout <Icon name="chevR" size={12} />
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {callsToday.map((call) => {
              const cl = getClientById(call.clientId);
              const isReady = call.ready === 'ready';
              return (
                <div key={call.clientId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar initials={cl?.initials || '??'} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{cl?.name || call.clientId}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{call.topic}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{call.time}</div>
                    <span className={`pill pill-${isReady ? 'green' : 'amber'}`} style={{ fontSize: 10, padding: '2px 6px' }}>
                      {isReady ? 'Prêt' : 'Partiel'}
                    </span>
                  </div>
                  <Link href={`/clients/${call.clientId}/brief`} className="btn-ghost" style={{ fontSize: 11, marginLeft: 4 }}>
                    Brief
                  </Link>
                </div>
              );
            })}
          </div>
        </div>

        {/* À surveiller */}
        </StaggerItem><StaggerItem><div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">À surveiller</div>
              <div className="card-sub">Clients en amber ou red</div>
            </div>
            <Link href="/clients" className="btn-ghost" style={{ fontSize: 12 }}>
              Voir tout <Icon name="chevR" size={12} />
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {watchList.map((client) => (
              <div key={client.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar initials={client.initials} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{client.name}</span>
                    <Pill status={client.status} label={client.status === 'amber' ? 'Vigilance' : 'Alerte'} size="sm" />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{client.statusText.slice(0, 45)}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>S{client.week}</div>
                  <Sparkbars data={client.weeklyHistory.slice(-6).map(w => w.postsCount)} height={20} width={40} />
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

      {/* Activité 24h */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div className="card-title">Activité des dernières 24h</div>
          <div className="card-sub">Mises à jour récentes de vos élèves</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 16 }}>
          {activity24h.map((item, i) => {
            const cl = getClientById(item.clientId);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: i < activity24h.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <Avatar initials={cl?.initials || '??'} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent)' }}>{cl?.name || item.clientId}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}> · {item.desc}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: item.status === 'green' ? 'var(--green)' : item.status === 'red' ? 'var(--red)' : 'var(--amber)', flexShrink: 0 }} />
                  <div style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{item.when}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
