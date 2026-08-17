'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import KpiRibbon from '@/components/ui/KpiRibbon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import Icon from '@/components/ui/Icon';
import CreateCallModal from '@/components/ui/CreateCallModal';
import CallStack from '@/components/ui/CallStack';
import SessionRapportModal from '@/components/ui/SessionRapportModal';
import RapportModal from '@/components/ui/RapportModal';
import { StaggerGrid, StaggerItem } from '@/components/ui/StaggerGrid';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { useUser } from '@/lib/UserContext';
import { useNotifications, type AppNotif } from '@/lib/useNotifications';
import { getClientSignals, getAggregatedSignals } from '@/lib/clientSignals';
import { getClientWeek } from '@/lib/clientWeek';
import { isNotCanceled } from '@/lib/salesCallStats';
import { isCallReallyOver, isCallJoinable } from '@/lib/sessionRapport';
import TrendBadge from '@/components/ui/TrendBadge';
import type { Call } from '@/lib/supabase/types';

const WIDGET_VISIBILITY_WINDOW_MS = 24 * 3600_000;

// Widget "Prochain call" accueil coach — un seul call, tous types confondus (coaching
// + vente), même bascule que la page Calls, mais n'affiche rien si à plus de 24h
// (l'accueil est une alerte "call bientôt", pas un calendrier complet).
function pickAccueilCall(calls: Call[], now: number): Call | null {
  const candidates = calls
    .filter(c => c.scheduled_at && c.status === 'active' && isCallJoinable(c, now))
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  if (candidates.length === 0) return null;
  const current = candidates[0];
  const next = candidates[1];
  const displayed = (next && isCallReallyOver(current, now)) ? next : current;
  const startsIn = new Date(displayed.scheduled_at!).getTime() - now;
  return startsIn <= WIDGET_VISIBILITY_WINDOW_MS ? displayed : null;
}

export default function PageToday() {
  const { clients, calls, business, loading, refetch } = useSupabaseClients();
  const { user } = useUser();
  const [showCreateCallModal, setShowCreateCallModal] = useState(false);
  const { notifs, refresh: refreshNotifs } = useNotifications(user?.id ?? null, false);
  // Fusionne rapports de session coaching (élèves) et rapports de call de vente (calls
  // du coach lui-même, cf. useNotifications.ts) dans un seul carrousel, triés par date.
  const rapportNotifs = notifs
    .filter(n => n.type === 'session_rapport' || n.type === 'rapport_call')
    .sort((a, b) => new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime());
  const [sessionRapportIdx, setSessionRapportIdx] = useState(0);
  const [openSessionRapport, setOpenSessionRapport] = useState<AppNotif | null>(null);
  const [openSalesRapport, setOpenSalesRapport] = useState<AppNotif | null>(null);

  // Recalcul local chaque minute (bascule du widget "Prochain call") — zéro requête
  // réseau, purement sur les données déjà en mémoire (même pattern que PageCalls.tsx).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const nextCall = pickAccueilCall(calls, nowTick);

  const activeCount = clients.length;
  const clientsWithSignals = clients.map(c => ({ client: c, signals: getClientSignals(c.tasks, c.sessionReports) }));
  const aggregatedSignals = getAggregatedSignals(clientsWithSignals.map(cs => cs.signals));
  const watchList = clientsWithSignals
    .filter(cs => cs.signals.total > 0)
    .sort((a, b) => b.signals.total - a.signals.total)
    .slice(0, 4);

  const callsToday = calls.filter(call => {
    if (!call.scheduled_at || !isNotCanceled(call)) return false;
    const d = new Date(call.scheduled_at);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });

  const coachingCallsToday = callsToday.filter(c => c.call_type === 'google').length;
  const leadCallsToday = callsToday.length - coachingCallsToday;

  const collectRate = business.cashContracted > 0 && business.cashCollected !== null
    ? Math.round((business.cashCollected / business.cashContracted) * 100)
    : null;

  const kpisTop = [
    {
      label: 'Total cash collecté', sub: 'Caisse collecté de tous tes élèves, All Time', value: business.studentsCashCollectedAllTime ?? 0,
      formatter: (n: number) => business.studentsCashCollectedAllTime === null ? '—' : `${n.toLocaleString('fr-FR')} €`,
      color: 'var(--green)',
      viz: business.studentsCashCollectedAllTime !== null && (
        <TrendBadge value={business.studentsCashCollectedThisMonth ?? 0} label="ce mois" format={(n) => `${n.toLocaleString('fr-FR')} €`} />
      ),
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
      headerRight: (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--surface-2)', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
            {coachingCallsToday} coaching{coachingCallsToday > 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--accent-brand-soft)', color: 'var(--accent-brand)', whiteSpace: 'nowrap' }}>
            {leadCallsToday} call{leadCallsToday > 1 ? 's' : ''} lead{leadCallsToday > 1 ? 's' : ''}
          </span>
        </div>
      ),
    },
  ];

  const kpisBottom = [
    {
      label: 'Leads générés', value: business.leadsAllTimeCount,
      href: '/pipeline',
      viz: <TrendBadge value={business.leadsThisMonthCount} label="ce mois" />,
    },
    {
      label: 'Calls bookés', value: business.prospectCallsBooked,
      href: '/pipeline',
      viz: <TrendBadge value={business.prospectCallsBookedThisMonth} label="ce mois" />,
    },
    {
      label: 'Taux de closing', value: business.closingRate,
      formatter: (n: number) => `${n}%`,
      viz: <TrendBadge value={business.closingRateThisMonth} label="ce mois" format={(n) => `${n}%`} />,
    },
    {
      label: 'Cash contracté / collecté',
      sub: business.cashCollected === null ? 'Stripe non connecté' : (collectRate !== null ? `${collectRate}% collecté` : undefined),
      value: business.cashContracted,
      formatter: (n: number) => `${n.toLocaleString('fr-FR')} € / ${business.cashCollected === null ? '—' : `${business.cashCollected.toLocaleString('fr-FR')} €`}`,
      color: 'var(--green)',
      viz: <TrendBadge value={business.cashContractedThisMonth} label="ce mois" format={(n) => `${n.toLocaleString('fr-FR')} €`} />,
    },
  ];

  const today = new Date();
  const dayLabel = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayCapitalized = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
  const firstName = (user?.full_name || '').split(' ')[0];

  if (loading) return <InlineLoader fullPage />;

  return (
    <div className="page-content">
      <CreateCallModal
        open={showCreateCallModal}
        onClose={() => setShowCreateCallModal(false)}
        onCreated={refetch}
      />

      <div className="page-header">
        <div>
          <div className="mono eyebrow-sm" style={{ color: 'var(--faint)', marginBottom: 6 }}>
            {dayCapitalized}
          </div>
          <h1 className="page-title">Bonjour{firstName ? ` ${firstName}` : ''}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={() => setShowCreateCallModal(true)} className="btn-primary btn-primary-brand" style={{ fontSize: 13 }}>
            <Icon name="plus" size={13} /> Créer un call
          </button>
        </div>
      </div>

      {/* Prochain call — un seul, tous types confondus (coaching + vente), même bascule
          que la page Calls mais masqué si à plus de 24h (alerte, pas un calendrier). */}
      {nextCall?.scheduled_at && (() => {
        const cl = clients.find(c => c.id === nextCall.client_id);
        const displayName = cl?.name || nextCall.invitee_name || '—';
        const isGoogle = nextCall.call_type === 'google';
        return (
          <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--accent-brand)', padding: '24px 24px' }}>
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
                {nextCall.join_url && isCallJoinable(nextCall, nowTick) && (
                  <a href={nextCall.join_url} target="_blank" rel="noopener noreferrer" className="btn-ghost call-action-join"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, textDecoration: 'none', marginTop: 12, padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <Icon name="video" size={14} /> Rejoindre
                  </a>
                )}
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

      {/* Rapports en attente — carrousel fusionné session coaching (élèves) + call de
          vente (calls du coach lui-même), badge Coaching/Prospect pour distinguer. */}
      {rapportNotifs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="eyebrow-lg" style={{ color: 'var(--accent-brand)', marginBottom: 10 }}>
            {rapportNotifs.length} rapport{rapportNotifs.length > 1 ? 's' : ''} en attente
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setSessionRapportIdx(i => Math.max(0, i - 1))}
              disabled={sessionRapportIdx === 0 || rapportNotifs.length <= 1}
              style={{ flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: sessionRapportIdx === 0 ? 'default' : 'pointer', opacity: sessionRapportIdx === 0 || rapportNotifs.length <= 1 ? 0.2 : 1 }}
            >‹</button>

            {(() => {
              const notif = rapportNotifs[sessionRapportIdx];
              if (!notif) return null;
              const isSession = notif.type === 'session_rapport';
              const call = calls.find(c => c.id === notif.callId);
              const client = call ? clients.find(c => c.id === call.client_id) : null;
              return (
                <div className="card" style={{ flex: 1, borderLeft: '3px solid var(--accent-brand)', padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-brand)' }}>
                          RAPPORT DE CALL{rapportNotifs.length > 1 && <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>{sessionRapportIdx + 1} / {rapportNotifs.length}</span>}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: isSession ? 'var(--surface-2)' : 'var(--accent-brand-soft)', color: isSession ? 'var(--accent)' : 'var(--accent-brand)' }}>
                          {isSession ? 'Coaching' : 'Prospect'}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                        {isSession
                          ? (client?.name ? `Session avec ${client.name}` : 'Session de coaching')
                          : (notif.inviteeName ? `Appel avec ${notif.inviteeName}` : 'Appel découverte')}
                      </div>
                      {call?.topic && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{call.topic}</div>
                      )}
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
                      onClick={() => isSession ? setOpenSessionRapport(notif) : setOpenSalesRapport(notif)}
                    >
                      Remplir le rapport
                    </button>
                  </div>
                </div>
              );
            })()}

            <button
              type="button"
              onClick={() => setSessionRapportIdx(i => Math.min(rapportNotifs.length - 1, i + 1))}
              disabled={sessionRapportIdx === rapportNotifs.length - 1 || rapportNotifs.length <= 1}
              style={{ flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: sessionRapportIdx === rapportNotifs.length - 1 ? 'default' : 'pointer', opacity: sessionRapportIdx === rapportNotifs.length - 1 || rapportNotifs.length <= 1 ? 0.2 : 1 }}
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
            topic={call?.topic ?? null}
            onClose={() => { setOpenSessionRapport(null); refreshNotifs(); }}
          />
        );
      })()}

      {openSalesRapport?.callId && (
        <RapportModal
          callId={openSalesRapport.callId}
          inviteeName={openSalesRapport.inviteeName ?? null}
          scheduledAt={openSalesRapport.scheduledAt ?? null}
          onClose={() => { setOpenSalesRapport(null); refreshNotifs(); }}
        />
      )}

      <KpiRibbon items={kpisTop} columns={4} />

      <div style={{ marginTop: 16 }}>
        <KpiRibbon items={kpisBottom} columns={4} />
      </div>

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
            <div style={{ marginTop: 16 }}>
              <CallStack calls={callsToday} getClient={(call) => {
                const matched = clients.find(c => c.id === call.client_id);
                if (matched) return matched;
                // Match manquant : soit un call de vente (call_type='calendly') dont le
                // prospect n'a pas encore de compte élève — client_id est alors null
                // (voir docs/calls-coach-id-piege.md) — soit un call coaching pointant
                // vers un élève archivé, exclu de `clients` (SupabaseClientsContext.tsx,
                // filtré archived_at is null) alors que ses calls ne le sont pas. Repli
                // sur invitee_name (vente) ou un libellé neutre (coaching), jamais "??".
                const name = call.invitee_name || (call.call_type === 'google' ? 'Élève archivé' : 'Prospect');
                return { id: call.id, name, initials: getInitials(name), avatar_url: null };
              }} />
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
                  <Avatar initials={client.initials || getInitials(client.name)} avatarUrl={client.avatar_url} size={36} seed={client.id} />
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
        <div className="card" style={{ marginTop: 24, marginBottom: 24, padding: 0, overflow: 'hidden' }}>
          <div className="card-head" style={{ padding: '18px 18px 0' }}>
            <div className="card-title">Tous tes clients</div>
            <Link href="/clients" className="btn-ghost" style={{ fontSize: 12 }}>
              Voir tout <Icon name="chevR" size={12} />
            </Link>
          </div>
          {/* Desktop : tableau. Mobile (≤767px) : cards empilées, voir .today-clients-cards en CSS */}
          <div className="today-clients-table" style={{ overflowX: 'auto' }}>
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
                        <Avatar initials={client.initials || getInitials(client.name)} avatarUrl={client.avatar_url} size={30} seed={client.id} />
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
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>S{getClientWeek(client.onboarding_completed_at)}</td>
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

          <div className="today-clients-cards">
            {clients.slice(0, 5).map((client) => {
              const s = getClientSignals(client.tasks, client.sessionReports);
              return (
                <Link key={client.id} href={`/clients/${client.id}`} className="today-client-card">
                  <Avatar initials={client.initials || getInitials(client.name)} avatarUrl={client.avatar_url} size={40} seed={client.id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{client.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                      {client.niche || 'Infopreneur'} · S{getClientWeek(client.onboarding_completed_at)}
                    </div>
                  </div>
                  {s.total > 0 ? (
                    <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, flexShrink: 0 }}>{s.total} signal{s.total > 1 ? 's' : ''}</span>
                  ) : (
                    <Icon name="chevR" size={14} color="var(--faint)" />
                  )}
                </Link>
              );
            })}
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
