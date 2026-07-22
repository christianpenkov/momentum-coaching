'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import Link from 'next/link';
import Ring from '@/components/ui/Ring';
import Icon from '@/components/ui/Icon';
import { useClientSelfData } from '@/lib/supabase/useCoachData';
import { createClient } from '@/lib/supabase/client';
import { useCallback, useRef, useState } from 'react';
import { useNotifications } from '@/lib/useNotifications';
import { useUser } from '@/lib/UserContext';
import RapportModal from '@/components/ui/RapportModal';
import { getDeadlineStatus } from '@/lib/clientSignals';

const PRIORITY_CONFIG = {
  high:   { label: 'Haute',   color: 'var(--red)',   bg: '#ef444420' },
  medium: { label: 'Moyenne', color: 'var(--amber)', bg: '#f5a62320' },
  low:    { label: 'Basse',   color: 'var(--green)', bg: '#22c55e20' },
};

function CallRequestInlineButtons({ callId, onRefresh }: { callId: string; onRefresh: () => void }) {
  const [state, setState] = useState<'idle' | 'accepting' | 'declining' | 'done'>('idle');
  async function respond(response: 'accepted' | 'declined') {
    setState(response === 'accepted' ? 'accepting' : 'declining');
    await fetch(`/api/calls/${callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    });
    setState('done');
    onRefresh();
  }
  if (state === 'done') return <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Réponse envoyée</span>;
  return (
    <>
      <button type="button" onClick={() => respond('accepted')} disabled={state !== 'idle'}
        style={{ fontSize: 12, fontWeight: 700, background: 'var(--accent-brand)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>
        {state === 'accepting' ? '…' : 'Accepter'}
      </button>
      <button type="button" onClick={() => respond('declined')} disabled={state !== 'idle'}
        style={{ fontSize: 12, fontWeight: 700, background: 'none', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>
        {state === 'declining' ? '…' : 'Refuser'}
      </button>
    </>
  );
}

function daysUntil(dateStr: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

function isCoachingCall(call: { call_type?: string | null } | null | undefined) {
  return call?.call_type === 'google';
}

function DeadlineBadge({ deadline, done }: { deadline?: string | null; done: boolean }) {
  const status = getDeadlineStatus(deadline, done);
  if (!status) return null;
  return (
    <span style={{
      fontSize: 10, color: status.color,
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontWeight: status.overdue || status.urgent ? 700 : 400,
      padding: status.overdue ? '2px 7px' : '0',
      background: status.overdue ? '#ef444418' : 'transparent',
      borderRadius: 20, flexShrink: 0,
    }}>
      <Icon name="calendar" size={10} />{status.label}
    </span>
  );
}

export default function PageClientView() {
  const { data: client, loading } = useClientSelfData();
  const [taskOverrides, setTaskOverrides] = useState<Record<string, boolean>>({});
  const supabase = useRef(createClient()).current;
  const { user } = useUser();
  const { notifs, refresh } = useNotifications(user?.id ?? null, true);
  const rapportNotifs = notifs.filter(n => n.type === 'rapport_call');
  const callRequestNotifs = notifs.filter(n => n.type === 'call_request');
  const [openRapport, setOpenRapport] = useState<typeof rapportNotifs[0] | null>(null);
  const [rapportIdx, setRapportIdx] = useState(0);

  const toggleTask = useCallback(async (taskId: string, done: boolean) => {
    setTaskOverrides(prev => ({ ...prev, [taskId]: done }));
    await supabase.from('tasks').update({ done }).eq('id', taskId);
  }, [supabase]);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>;

  if (!client) {
    return (
      <div className="page-content">
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>👋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Bienvenue sur Momentum</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Ton espace sera disponible dès que ton coach t'aura configuré.</div>
        </div>
      </div>
    );
  }

  const tasks = client.tasks.map(t => ({ ...t, done: taskOverrides[t.id] ?? t.done }));
  const last = client.latestMetrics;
  const doneCount = tasks.filter(t => t.done).length;
  const progress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  const { nextCall, callsToday, callsBookedThisMonth, leadsThisMonthCount, cashContracted, cashCollected, closingRate } = client.business;
  const coachingCallsToday = callsToday.filter(isCoachingCall).length;
  const prospectCallsToday = callsToday.length - coachingCallsToday;
  const collectRate = cashContracted > 0 && cashCollected !== null ? Math.round((cashCollected / cashContracted) * 100) : null;

  return (
    <div className="page-content">

      {/* Prochain call */}
      {nextCall?.scheduled_at && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid var(--accent-brand)', padding: '24px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>PROCHAIN CALL</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: isCoachingCall(nextCall) ? 'var(--surface-2)' : '#E1306C20', color: isCoachingCall(nextCall) ? 'var(--accent)' : '#E1306C' }}>
                  {isCoachingCall(nextCall) ? 'Coaching' : 'Prospect'}
                </span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2, textTransform: 'capitalize' }}>
                {new Date(nextCall.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)', marginTop: 2 }}>
                {new Date(nextCall.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                {nextCall.duration && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>· {nextCall.duration}</span>}
              </div>
              {isCoachingCall(nextCall) && nextCall.topic && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{nextCall.topic}</div>
              )}
            </div>
            <div style={{ padding: '16px 20px', background: 'var(--surface-2)', borderRadius: 12, textAlign: 'center', minWidth: 110 }}>
              {(() => {
                const days = daysUntil(nextCall.scheduled_at!);
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
      )}

      {/* Demandes de call coaching en attente */}
      {callRequestNotifs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            {callRequestNotifs.length} demande{callRequestNotifs.length > 1 ? 's' : ''} de call en attente
          </div>
          {callRequestNotifs.map(notif => (
            <div key={notif.id} className="card" style={{ borderLeft: '4px solid var(--accent)', padding: '18px 20px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>DEMANDE DE CALL COACHING</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{notif.body}</div>
                  {notif.scheduledAt && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                      {new Date(notif.scheduledAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                      {' · '}
                      {new Date(notif.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      {notif.duration && <span style={{ marginLeft: 8 }}>· {notif.duration}</span>}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <CallRequestInlineButtons callId={notif.callId!} onRefresh={refresh} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rapports de call en attente — carrousel avec flèches latérales */}
      {rapportNotifs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            {rapportNotifs.length} rapport{rapportNotifs.length > 1 ? 's' : ''} en attente
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Flèche gauche */}
            <button
              type="button"
              onClick={() => setRapportIdx(i => Math.max(0, i - 1))}
              disabled={rapportIdx === 0 || rapportNotifs.length <= 1}
              style={{ flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: rapportIdx === 0 ? 'default' : 'pointer', opacity: rapportIdx === 0 || rapportNotifs.length <= 1 ? 0.2 : 1 }}
            >‹</button>

            {/* Carte */}
            {(() => {
              const notif = rapportNotifs[rapportIdx];
              if (!notif) return null;
              return (
                <div className="card" style={{ flex: 1, borderLeft: '4px solid #f59e0b', padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                        RAPPORT DE CALL{rapportNotifs.length > 1 && <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>{rapportIdx + 1} / {rapportNotifs.length}</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                        {notif.inviteeName ? `Appel avec ${notif.inviteeName}` : 'Appel découverte'}
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
                      style={{ fontSize: 13, background: '#f59e0b', flexShrink: 0 }}
                      onClick={() => setOpenRapport(notif)}
                    >
                      Remplir le rapport
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Flèche droite */}
            <button
              type="button"
              onClick={() => setRapportIdx(i => Math.min(rapportNotifs.length - 1, i + 1))}
              disabled={rapportIdx === rapportNotifs.length - 1 || rapportNotifs.length <= 1}
              style={{ flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: rapportIdx === rapportNotifs.length - 1 ? 'default' : 'pointer', opacity: rapportIdx === rapportNotifs.length - 1 || rapportNotifs.length <= 1 ? 0.2 : 1 }}
            >›</button>
          </div>
        </div>
      )}

      {openRapport?.callId && (
        <RapportModal
          callId={openRapport.callId}
          inviteeName={openRapport.inviteeName ?? null}
          scheduledAt={openRapport.scheduledAt ?? null}
          onClose={() => { setOpenRapport(null); refresh(); }}
        />
      )}

      {/* Header élève */}
      <div style={{ background: 'linear-gradient(135deg, var(--surface-2) 0%, var(--surface) 100%)', borderRadius: 16, padding: 'clamp(16px, 4vw, 28px) clamp(14px, 5vw, 32px)', marginBottom: 20, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(12px, 4vw, 24px)', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Ring value={progress} size={80} stroke={7} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>{progress}%</span>
              <span style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>prog.</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 1 }}>Bonjour,</div>
            <h1 style={{ fontSize: 'clamp(22px, 6vw, 32px)', fontWeight: 800, color: 'var(--accent)', marginBottom: 4, lineHeight: 1.05 }}>{client.name}</h1>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              {client.niche || 'Infopreneur'} · Sem. <strong style={{ color: 'var(--accent)' }}>{client.week}</strong>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '4px 10px', borderRadius: 20, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {doneCount}/{tasks.length} tâches
              </span>
              {last && (
                <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '4px 10px', borderRadius: 20, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {last.followers_ig.toLocaleString('fr-FR')} abonnés
                </span>
              )}
              {last && last.stripe_mrr > 0 && (
                <span style={{ fontSize: 11, color: 'var(--green)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '4px 10px', borderRadius: 20, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {last.stripe_mrr.toLocaleString('fr-FR')} € MRR
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Plan de la semaine */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Plan de la semaine</div>
              <div className="card-sub">{doneCount} sur {tasks.length} tâches complétées</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {tasks.filter(t => !t.done).map((task) => {
              const prio = task.priority ? PRIORITY_CONFIG[task.priority] : null;
              const overdue = getDeadlineStatus(task.deadline, task.done)?.overdue ?? false;
              return (
                <div
                  key={task.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 12,
                    background: overdue ? '#ef444408' : 'var(--surface-2)',
                    border: `1px solid ${overdue ? '#ef444440' : 'var(--border)'}`,
                  }}
                >
                  <div
                    className="task-check"
                    onClick={() => toggleTask(task.id, true)}
                    role="checkbox" aria-checked={false} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(task.id, true); } }}
                    style={{ flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: task.deadline ? 3 : 0 }}>{task.label}</div>
                    {task.meta && task.meta !== 'fait' && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{task.meta}</div>
                    )}
                  </div>
                  <DeadlineBadge deadline={task.deadline} done={false} />
                  {prio && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: prio.bg, color: prio.color, flexShrink: 0 }}>
                      {prio.label}
                    </span>
                  )}
                  {task.added_by === 'coach' && (
                    <span title={`Tâche assignée par ${client.coachName || 'ton coach'}`} style={{ fontSize: 11, flexShrink: 0 }}>⭐</span>
                  )}
                </div>
              );
            })}
            {tasks.filter(t => !t.done).length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--green)', padding: '8px 0' }}>✓ Toutes tes tâches sont terminées !</div>
            )}
            {tasks.filter(t => t.done).length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>TERMINÉES ({tasks.filter(t => t.done).length})</div>
                {tasks.filter(t => t.done).map((task) => (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', opacity: 0.5 }}>
                    <div className="task-check checked" onClick={() => toggleTask(task.id, false)} role="checkbox" aria-checked={true} tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTask(task.id, false); }} style={{ flexShrink: 0 }}>
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'line-through', flex: 1 }}>{task.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ressources */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Ressources</div>
              <Link href="/client/ressources" className="btn-ghost" style={{ fontSize: 12 }}>
                Voir tout <Icon name="chevR" size={12} />
              </Link>
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {client.resources.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>Aucune ressource publiée pour le moment.</div>
              ) : client.resources.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="folder" size={14} />
                  </div>
                  <div style={{ flex: 1, fontSize: 12, color: 'var(--accent)', minWidth: 0 }}>{r.title}</div>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>
                      <Icon name="external" size={11} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Business du mois */}
      <div className="grid-4" style={{ marginTop: 24 }}>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Appels aujourd'hui</div>
          <div className="kpi-value">{callsToday.length}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            {callsToday.length > 0 ? `${coachingCallsToday} coaching · ${prospectCallsToday} prospect` : 'Aucun call prévu'}
          </div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Calls bookés ce mois</div>
          <div className="kpi-value">{callsBookedThisMonth.length}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>calls prospects</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Leads ce mois</div>
          <div className="kpi-value">{leadsThisMonthCount}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>nouveaux leads détectés</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Taux de closing</div>
          <div className="kpi-value">{closingRate}%</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>depuis le 1er du mois</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Cash contracté</div>
          <div className="kpi-value" style={{ color: 'var(--green)' }}>{cashContracted.toLocaleString('fr-FR')} €</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>deals closés ce mois</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Cash collecté</div>
          {cashCollected === null ? (
            <>
              <div className="kpi-value" style={{ color: 'var(--muted)' }}>—</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>en attente de connexion Stripe</div>
            </>
          ) : (
            <>
              <div className="kpi-value" style={{ color: 'var(--green)' }}>{cashCollected.toLocaleString('fr-FR')} €</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                {collectRate !== null ? `${collectRate}% du cash contracté` : 'ce mois'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
