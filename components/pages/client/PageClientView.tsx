'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import Link from 'next/link';
import Ring from '@/components/ui/Ring';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import { useClientSelfData } from '@/lib/supabase/useCoachData';
import { createClient } from '@/lib/supabase/client';
import { useCallback, useRef, useState } from 'react';
import { useNotifications } from '@/lib/useNotifications';
import { useUser } from '@/lib/UserContext';
import RapportModal from '@/components/ui/RapportModal';

const PRIORITY_CONFIG = {
  high:   { label: 'Haute',   color: 'var(--red)',   bg: '#ef444420' },
  medium: { label: 'Moyenne', color: 'var(--amber)', bg: '#f5a62320' },
  low:    { label: 'Basse',   color: 'var(--green)', bg: '#22c55e20' },
};

function DeadlineBadge({ deadline, done }: { deadline?: string | null; done: boolean }) {
  if (!deadline || done) return null;
  const d = new Date(deadline);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  const overdue = diff < 0;
  const urgent  = diff <= 2 && diff >= 0;
  const color = overdue ? 'var(--red)' : urgent ? 'var(--amber)' : 'var(--muted)';
  const label = overdue
    ? `En retard · ${Math.abs(diff)}j`
    : diff === 0 ? "Aujourd'hui"
    : diff === 1 ? 'Demain'
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return (
    <span style={{
      fontSize: 10, color,
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontWeight: overdue || urgent ? 700 : 400,
      padding: overdue ? '2px 7px' : '0',
      background: overdue ? '#ef444418' : 'transparent',
      borderRadius: 20, flexShrink: 0,
    }}>
      <Icon name="calendar" size={10} />{label}
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
  const prev = client.prevMetrics;
  const doneCount = tasks.filter(t => t.done).length;
  const progress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;
  const igDelta = last && prev ? last.followers_ig - prev.followers_ig : 0;

  return (
    <div className="page-content">

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
                      className="btn-primary"
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
          {client.next_call && (
            <div style={{ padding: '12px 16px', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Prochain call</div>
              <div style={{ fontSize: 'clamp(13px, 3.5vw, 18px)', fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>{client.next_call}</div>
              <Link href="/client/calls" className="btn-ghost" style={{ fontSize: 11, display: 'inline-flex', gap: 4 }}>
                Détails <Icon name="chevR" size={11} />
              </Link>
            </div>
          )}
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
              const d = task.deadline ? new Date(task.deadline) : null;
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const diff = d ? Math.ceil((d.getTime() - today.getTime()) / 86400000) : null;
              const overdue = diff !== null && diff < 0;
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
                    <span title="Tâche assignée par ton coach" style={{ fontSize: 11, flexShrink: 0 }}>⭐</span>
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
          {client.lastCoachMessage && (
            <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
              <div className="card-head">
                <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="sparkle" size={14} /> Message de ton coach
                </div>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--accent)', marginTop: 12, fontStyle: 'italic' }}>
                "{client.lastCoachMessage}"
              </p>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <div className="card-title">Ressources</div>
              <Link href="/client/resources" className="btn-ghost" style={{ fontSize: 12 }}>
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

      {/* Stats rapides */}
      {last && (
        <div className="grid-4" style={{ marginTop: 24 }}>
          {[
            {
              label: 'Followers IG',
              value: last.followers_ig.toLocaleString('fr-FR'),
              sub: igDelta !== 0 ? `${igDelta > 0 ? '+' : ''}${igDelta} cette semaine` : 'Semaine 1',
              color: '#E1306C',
              spark: client.weeklyMetrics.slice(-8).map(w => w.followers_ig),
            },
            {
              label: 'Posts publiés',
              value: last.posts_count.toString(),
              sub: `${last.avg_views.toLocaleString('fr-FR')} vues moy.`,
              spark: client.weeklyMetrics.slice(-8).map(w => w.posts_count),
            },
            {
              label: 'DM envoyés',
              value: last.dms_sent.toString(),
              sub: `${last.dms_reply_rate}% réponse`,
              spark: client.weeklyMetrics.slice(-8).map(w => w.dms_sent),
            },
            {
              label: 'MRR',
              value: `${last.stripe_mrr.toLocaleString('fr-FR')} €`,
              sub: 'revenus mensuels',
              color: 'var(--green)',
              spark: client.weeklyMetrics.slice(-8).map(w => w.stripe_mrr),
            },
          ].map(({ label, value, sub, color, spark }) => (
            <div key={label} className="card kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label">{label}</div>
              <div className="kpi-value" style={color ? { color } : undefined}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>
              <div style={{ marginTop: 10 }}>
                <Sparkbars data={spark} height={20} width={60} color={color || 'var(--accent)'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
