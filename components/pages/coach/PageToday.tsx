'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useState } from 'react';
import Link from 'next/link';
import KpiRibbon from '@/components/ui/KpiRibbon';
import Avatar from '@/components/ui/Avatar';
import Icon from '@/components/ui/Icon';
import AddClientModal from '@/components/ui/AddClientModal';
import SessionRapportModal from '@/components/ui/SessionRapportModal';
import { StaggerGrid, StaggerItem } from '@/components/ui/StaggerGrid';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { useUser } from '@/lib/UserContext';
import { useNotifications, type AppNotif } from '@/lib/useNotifications';
import { getClientSignals, getAggregatedSignals } from '@/lib/clientSignals';

export default function PageToday() {
  const { clients, calls, business, loading } = useSupabaseClients();
  const { user } = useUser();
  const [showAddModal, setShowAddModal] = useState(false);
  const { notifs, refresh: refreshNotifs } = useNotifications(user?.id ?? null, false);
  const sessionRapportNotifs = notifs.filter(n => n.type === 'session_rapport');
  const [sessionRapportIdx, setSessionRapportIdx] = useState(0);
  const [openSessionRapport, setOpenSessionRapport] = useState<AppNotif | null>(null);

  const activeCount = clients.length;
  const clientsWithSignals = clients.map(c => ({ client: c, signals: getClientSignals(c.tasks, c.sessionReports) }));
  const aggregatedSignals = getAggregatedSignals(clientsWithSignals.map(cs => cs.signals));
  const watchList = clientsWithSignals
    .filter(cs => cs.signals.total > 0)
    .sort((a, b) => b.signals.total - a.signals.total)
    .slice(0, 4);

  const callsToday = calls.filter(call => {
    if (!call.scheduled_at) return false;
    const d = new Date(call.scheduled_at);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });

  const coachingCallsToday = callsToday.filter(c => c.call_type === 'google').length;
  const leadCallsToday = callsToday.length - coachingCallsToday;

  const collectRate = business.cashContracted > 0 && business.cashCollected !== null
    ? Math.round((business.cashCollected / business.cashContracted) * 100)
    : null;

  const kpis = [
    {
      label: 'Argent généré', sub: 'total, all-time', value: business.cashCollectedAllTime ?? 0,
      formatter: (n: number) => business.cashCollectedAllTime === null ? '—' : `${n.toLocaleString('fr-FR')} €`,
      color: 'var(--green)',
    },
    {
      label: 'Élèves actifs', sub: 'en cours de coaching', value: activeCount,
    },
    {
      label: 'Alertes', sub: 'tâches en retard + no-shows', value: aggregatedSignals.total,
      href: '/tasks?filter=overdue',
    },
    {
      label: 'Calls aujourd\'hui', value: callsToday.length,
      viz: (
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--surface-2)', color: 'var(--accent)' }}>
            {coachingCallsToday} coaching{coachingCallsToday > 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#E1306C20', color: '#E1306C' }}>
            {leadCallsToday} call{leadCallsToday > 1 ? 's' : ''} lead{leadCallsToday > 1 ? 's' : ''}
          </span>
        </div>
      ),
    },
    {
      label: 'Leads générés', sub: 'ce mois', value: business.leadsThisMonthCount,
    },
    {
      label: 'Calls bookés', sub: 'ce mois', value: business.prospectCallsBookedThisMonth,
    },
    {
      label: 'Taux de closing', sub: 'ce mois', value: business.closingRate,
      formatter: (n: number) => `${n}%`,
    },
    {
      label: 'Cash contracté / collecté',
      sub: business.cashCollected === null
        ? 'Stripe non connecté'
        : (collectRate !== null ? `${collectRate}% collecté` : 'ce mois'),
      value: business.cashContracted,
      formatter: (n: number) => `${n.toLocaleString('fr-FR')} € / ${business.cashCollected === null ? '—' : `${business.cashCollected.toLocaleString('fr-FR')} €`}`,
      color: 'var(--green)',
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

      {/* Rapports de session en attente — carrousel avec flèches latérales (miroir du flux Calendly élève-prospect) */}
      {sessionRapportNotifs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-brand)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            {sessionRapportNotifs.length} rapport{sessionRapportNotifs.length > 1 ? 's' : ''} de session en attente
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setSessionRapportIdx(i => Math.max(0, i - 1))}
              disabled={sessionRapportIdx === 0 || sessionRapportNotifs.length <= 1}
              style={{ flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: sessionRapportIdx === 0 ? 'default' : 'pointer', opacity: sessionRapportIdx === 0 || sessionRapportNotifs.length <= 1 ? 0.2 : 1 }}
            >‹</button>

            {(() => {
              const notif = sessionRapportNotifs[sessionRapportIdx];
              if (!notif) return null;
              const call = calls.find(c => c.id === notif.callId);
              const client = call ? clients.find(c => c.id === call.client_id) : null;
              return (
                <div className="card" style={{ flex: 1, borderLeft: '4px solid var(--accent-brand)', padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-brand)', marginBottom: 4 }}>
                        RAPPORT DE SESSION{sessionRapportNotifs.length > 1 && <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>{sessionRapportIdx + 1} / {sessionRapportNotifs.length}</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                        {client?.name ? `Session avec ${client.name}` : 'Session de coaching'}
                      </div>
                      {notif.scheduledAt && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                          {new Date(notif.scheduledAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                          {' · '}
                          {new Date(notif.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          {notif.duration && <span style={{ marginLeft: 8 }}>· {notif.duration}</span>}
                        </div>
                      )}
                    </div>
                    <button
                      className="btn-primary-brand"
                      type="button"
                      style={{ fontSize: 13, background: 'var(--accent-brand)', flexShrink: 0 }}
                      onClick={() => setOpenSessionRapport(notif)}
                    >
                      Remplir le rapport
                    </button>
                  </div>
                </div>
              );
            })()}

            <button
              type="button"
              onClick={() => setSessionRapportIdx(i => Math.min(sessionRapportNotifs.length - 1, i + 1))}
              disabled={sessionRapportIdx === sessionRapportNotifs.length - 1 || sessionRapportNotifs.length <= 1}
              style={{ flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: sessionRapportIdx === sessionRapportNotifs.length - 1 ? 'default' : 'pointer', opacity: sessionRapportIdx === sessionRapportNotifs.length - 1 || sessionRapportNotifs.length <= 1 ? 0.2 : 1 }}
            >›</button>
          </div>
        </div>
      )}

      {openSessionRapport?.callId && (() => {
        const call = calls.find(c => c.id === openSessionRapport.callId);
        const client = call ? clients.find(c => c.id === call.client_id) : null;
        return (
          <SessionRapportModal
            callId={openSessionRapport.callId}
            studentName={client?.name ?? null}
            scheduledAt={openSessionRapport.scheduledAt ?? null}
            onClose={() => { setOpenSessionRapport(null); refreshNotifs(); }}
          />
        );
      })()}

      <KpiRibbon items={kpis} columns={4} />

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
                    <Avatar initials={client?.initials || '??'} avatarUrl={client?.avatar_url} size={36} />
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

        {/* Clients à surveiller */}
        <StaggerItem>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Clients à surveiller</div>
                <div className="card-sub">Tâches en retard ou no-show non traité</div>
              </div>
              <Link href="/clients" className="btn-ghost" style={{ fontSize: 12 }}>
                Voir tout <Icon name="chevR" size={12} />
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              {watchList.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--green)', padding: '8px 0' }}>Aucun signal actif ✓</div>
              )}
              {watchList.map(({ client, signals }) => (
                <div key={client.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar initials={client.initials || '??'} avatarUrl={client.avatar_url} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{client.name}</span>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {[
                        signals.overdueTasksCount > 0 ? `${signals.overdueTasksCount} tâche${signals.overdueTasksCount > 1 ? 's' : ''} en retard` : null,
                        signals.activeNoShowsCount > 0 ? `${signals.activeNoShowsCount} no-show${signals.activeNoShowsCount > 1 ? 's' : ''}` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clients.slice(0, 5).map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link href={`/clients/${client.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
                        <Avatar initials={client.initials || '??'} avatarUrl={client.avatar_url} size={30} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent)' }}>{client.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{client.niche || 'Infopreneur'}</div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      {(() => {
                        const s = getClientSignals(client.tasks, client.sessionReports);
                        return s.total > 0
                          ? <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>{s.total} signal{s.total > 1 ? 's' : ''}</span>
                          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>;
                      })()}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>S{client.week}</td>
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
          <Link href="/clients" className="btn-primary-brand" style={{ fontSize: 13 }}>
            <Icon name="plus" size={13} /> Ajouter un client manuellement
          </Link>
        </div>
      )}
    </div>
  );
}
