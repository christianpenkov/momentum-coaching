'use client';

import { useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Ring from '@/components/ui/Ring';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import TaskModal from '@/components/ui/TaskModal';
import { useClients } from '@/lib/ClientsContext';
import type { Task } from '@/lib/data';

const PRIORITY_CONFIG = {
  high:   { label: 'Haute',   color: 'var(--red)',   bg: '#ef444420' },
  medium: { label: 'Moyenne', color: 'var(--amber)', bg: '#f5a62320' },
  low:    { label: 'Basse',   color: 'var(--green)', bg: '#22c55e20' },
};

function DeadlineBadge({ deadline, done }: { deadline?: string; done: boolean }) {
  if (!deadline || done) return null;
  const d = new Date(deadline);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  const overdue = diff < 0;
  const urgent  = diff <= 2 && diff >= 0;
  const color = overdue ? 'var(--red)' : urgent ? 'var(--amber)' : 'var(--muted)';
  const label = overdue
    ? `En retard (${Math.abs(diff)}j)`
    : diff === 0 ? "Aujourd'hui"
    : diff === 1 ? 'Demain'
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return (
    <span style={{ fontSize: 10, color, display: 'flex', alignItems: 'center', gap: 3, fontWeight: overdue || urgent ? 700 : 400, flexShrink: 0 }}>
      <Icon name="calendar" size={10} />{label}
    </span>
  );
}

interface Props { id: string }

export default function PageClientDetail({ id }: Props) {
  const { getClient, addTask, toggleTask: ctxToggle } = useClients();
  const client = getClient(id);
  const tasks = client?.plan || [];
  const [note, setNote] = useState(client?.privateNotes || '');
  const [modalOpen, setModalOpen] = useState(false);

  if (!client) return (
    <div className="page-content">
      <div className="page-header"><h1 className="page-title">Client introuvable</h1></div>
    </div>
  );

  const last = client.weeklyHistory[11];
  const prev = client.weeklyHistory[10];
  const mrrGrowth = prev.stripeMRR > 0 ? Math.round(((last.stripeMRR - prev.stripeMRR) / prev.stripeMRR) * 100) : 0;

  const doneCount = tasks.filter(t => t.done).length;
  const progress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  function toggleTask(idx: number, checked: boolean) {
    ctxToggle(id, idx, checked);
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar initials={client.initials} size={48} />
          <div>
            <h1 className="page-title" style={{ marginBottom: 4 }}>{client.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{client.niche}</span>
              <Pill status={client.status} label={client.statusText.slice(0, 30)} size="sm" />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>· Semaine {client.week}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/clients/${id}/brief`} className="btn-primary">
            <Icon name="brain" size={14} /> Brief IA
          </Link>
          <Link href={`/clients/${id}/analytics`} className="btn-ghost">
            <Icon name="bar-chart" size={14} /> Analytics
          </Link>
        </div>
      </div>

      {/* KPIs rapides */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">MRR Stripe</div>
          <div className="kpi-value">{last.stripeMRR.toLocaleString('fr-FR')} €</div>
          <div className={`kpi-delta${mrrGrowth >= 0 ? ' kpi-delta-up' : ' kpi-delta-down'}`}>{mrrGrowth >= 0 ? '+' : ''}{mrrGrowth}% vs sem. préc.</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Followers IG</div>
          <div className="kpi-value">{last.followersIG.toLocaleString('fr-FR')}</div>
          <div className="kpi-delta kpi-delta-up">+{last.followersIG - prev.followersIG} cette semaine</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Posts cette sem.</div>
          <div className="kpi-value">{last.postsCount}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{last.avgViews.toLocaleString('fr-FR')} vues moy.</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">DM envoyés</div>
          <div className="kpi-value">{last.dmsSent}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{last.dmsReplyRate}% réponse</div>
        </div>
      </div>

      <TaskModal open={modalOpen} onClose={() => setModalOpen(false)} onAdd={t => addTask(id, t)} />

      <div className="grid-2">
        {/* Plan de la semaine */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Plan de la semaine</div>
              <div className="card-sub">{doneCount}/{tasks.length} tâches complétées</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Ring value={progress} size={44} stroke={4} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', minWidth: 32 }}>{progress}%</span>
              <button
                className="btn-primary"
                type="button"
                onClick={() => setModalOpen(true)}
                style={{ fontSize: 12, padding: '6px 12px', gap: 5 }}
              >
                <Icon name="plus" size={12} /> Ajouter
              </button>
            </div>
          </div>

          {/* Tâches groupées : à faire / terminées */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
            {tasks.filter(t => !t.done).map((task, i) => {
              const idx = tasks.indexOf(task);
              const prio = task.priority ? PRIORITY_CONFIG[task.priority] : null;
              return (
                <div
                  key={i}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}
                >
                  <div
                    className="task-check"
                    onClick={() => toggleTask(idx, true)}
                    role="checkbox"
                    aria-checked={false}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(idx, true); } }}
                    style={{ flexShrink: 0 }}
                  />
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--accent)' }}>{task.label}</span>
                  {task.meta && <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{task.meta}</span>}
                  <DeadlineBadge deadline={task.deadline} done={false} />
                  {prio && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: prio.bg, color: prio.color, flexShrink: 0 }}>
                      {prio.label}
                    </span>
                  )}
                  {task.addedBy === 'coach' && (
                    <span title="Ajoutée par le coach" style={{ fontSize: 10, color: 'var(--muted)' }}>👤</span>
                  )}
                </div>
              );
            })}
            {tasks.filter(t => !t.done).length === 0 && tasks.length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--green)', padding: '8px 0' }}>✓ Toutes les tâches sont terminées !</div>
            )}
            {tasks.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucune tâche · cliquez sur "Ajouter"</div>
            )}
            {tasks.filter(t => t.done).length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>TERMINÉES ({tasks.filter(t => t.done).length})</div>
                {tasks.filter(t => t.done).map((task, i) => {
                  const idx = tasks.indexOf(task);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', opacity: 0.55 }}>
                      <div
                        className="task-check checked"
                        onClick={() => toggleTask(idx, false)}
                        role="checkbox"
                        aria-checked={true}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(idx, false); } }}
                        style={{ flexShrink: 0 }}
                      >
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)', textDecoration: 'line-through' }}>{task.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Messages récents */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Messages récents</div>
            <Link href="/messages" className="btn-ghost" style={{ fontSize: 12 }}>
              Voir tout <Icon name="chevR" size={12} />
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {(client.messages || []).slice(0, 4).map((msg, i) => {
              const isCoach = msg.who === 'Marc' || msg.side === 'me';
              return (
                <div key={i} className={`message-bubble${isCoach ? ' outgoing' : ''}`}>
                  <div style={{ fontSize: 11, color: isCoach ? 'rgba(255,255,255,0.7)' : 'var(--muted)', marginBottom: 3 }}>{msg.who}</div>
                  <div style={{ fontSize: 12 }}>{msg.text}</div>
                </div>
              );
            })}
            {(!client.messages || client.messages.length === 0) && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucun message récent</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 24 }}>
        {/* Profil détaillé */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Profil & Funnel</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="calendar" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Client depuis</span>
              <strong>{client.clientSince ? `${client.clientSince}j` : 'Jan 2024'}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="phone-call" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Prochain call</span>
              <strong>{client.nextCall || 'Non planifié'}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="target" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Taux iClosed</span>
              <strong style={{ color: 'var(--green)' }}>{client.iClosedRate || 0}%</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="calendar" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Calls Calendly/mois</span>
              <strong>{client.calendlyMonthly || 0}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="dollar-sign" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>MRR actuel</span>
              <strong>{last.stripeMRR.toLocaleString('fr-FR')} €</strong>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Score momentum</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${client.momentumScore || 0}%`,
                    background: (client.momentumScore || 0) >= 70 ? 'var(--green)' : (client.momentumScore || 0) >= 40 ? 'var(--amber)' : 'var(--red)',
                    borderRadius: 4,
                    transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
                  }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', minWidth: 32 }}>{client.momentumScore || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes privées */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Notes privées</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)' }}>
              <Icon name="lock" size={12} /> Visible coach uniquement
            </div>
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Notes confidentielles sur cet élève…"
            style={{ width: '100%', minHeight: 120, marginTop: 16, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--accent)', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{note.length} car.</span>
            <button className="btn-ghost" style={{ fontSize: 12 }} type="button">Sauvegarder</button>
          </div>
          {client.suspens && client.suspens.length > 0 && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, borderLeft: '3px solid var(--amber)' }}>
              <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600, marginBottom: 6 }}>Points en suspens</div>
              {client.suspens.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`pill pill-${s.status}`} style={{ fontSize: 10 }}>{s.status}</span>
                  {s.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stats & tendances sur 12 semaines */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">Statistiques — 12 dernières semaines</div>
            <div className="card-sub">Évolution semaine par semaine</div>
          </div>
          <Link href={`/clients/${id}/analytics`} className="btn-primary" style={{ fontSize: 12 }}>
            <Icon name="bar-chart" size={13} /> Analytics complet
          </Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 20 }}>
          {[
            { label: 'Followers Instagram', data: client.weeklyHistory.map(w => w.followersIG), color: '#E1306C', format: (n: number) => n.toLocaleString('fr-FR') },
            { label: 'Posts / semaine', data: client.weeklyHistory.map(w => w.postsCount), color: 'var(--accent)', format: (n: number) => `${n} posts` },
            { label: 'DM envoyés', data: client.weeklyHistory.map(w => w.dmsSent), color: 'var(--amber)', format: (n: number) => `${n} DM` },
            { label: 'MRR Stripe', data: client.weeklyHistory.map(w => w.stripeMRR), color: 'var(--green)', format: (n: number) => `${n.toLocaleString('fr-FR')} €` },
            { label: 'Vues moyennes', data: client.weeklyHistory.map(w => w.avgViews), color: 'var(--accent)', format: (n: number) => n.toLocaleString('fr-FR') },
            { label: 'Engagement %', data: client.weeklyHistory.map(w => w.engagementRate * 10), color: '#8B5CF6', format: (_n: number, i: number) => `${client.weeklyHistory[i]?.engagementRate ?? 0}%` },
            { label: 'Calls Calendly', data: client.weeklyHistory.map(w => w.calendlyCalls), color: '#0A66C2', format: (n: number) => `${n} calls` },
            { label: 'Deals iClosed', data: client.weeklyHistory.map(w => w.iClosedDeals), color: 'var(--green)', format: (n: number) => `${n} deals` },
          ].map(({ label, data, color, format }) => {
            const last12 = data[11];
            const prev12 = data[10];
            const delta = last12 - prev12;
            const pct = prev12 > 0 ? Math.round((delta / prev12) * 100) : 0;
            return (
              <div key={label} style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 500 }}>{label}</div>
                <div style={{ marginBottom: 10 }}>
                  <Sparkbars data={data} height={30} width={100} color={color} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                  {format(last12, 11)}
                </div>
                <div style={{ fontSize: 11, color: pct >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 3, fontWeight: 600 }}>
                  {pct >= 0 ? '+' : ''}{pct}% vs sem. préc.
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
