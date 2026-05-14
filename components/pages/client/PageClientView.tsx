'use client';

import Link from 'next/link';
import Ring from '@/components/ui/Ring';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import { useClients } from '@/lib/ClientsContext';

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

const THOMAS_ID = 'thomas';

export default function PageClientView() {
  const { getClient, toggleTask: ctxToggle } = useClients();
  const client = getClient(THOMAS_ID);
  const tasks = client?.plan || [];

  if (!client) return <div className="page-content"><div className="page-title">Client introuvable</div></div>;

  const last = client.weeklyHistory[11];
  const doneCount = tasks.filter(t => t.done).length;
  const progress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  function toggleTask(idx: number, checked: boolean) {
    ctxToggle(THOMAS_ID, idx, checked);
  }

  const unlockedResources = 8;
  const totalResources = 15;

  return (
    <div className="page-content">
      {/* Header élève */}
      <div style={{ background: 'linear-gradient(135deg, var(--surface-2) 0%, var(--surface) 100%)', borderRadius: 16, padding: '28px 32px', marginBottom: 24, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          {/* Ring */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Ring value={progress} size={96} stroke={8} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>{progress}%</span>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>progression</span>
            </div>
          </div>
          {/* Texte principal */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 15, color: 'var(--muted)', marginBottom: 2, fontWeight: 400 }}>Bonjour,</div>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--accent)', marginBottom: 6, lineHeight: 1.05 }}>{client.name}</h1>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
              {client.niche} · Semaine <strong style={{ color: 'var(--accent)' }}>{client.week}</strong> sur votre parcours
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '5px 12px', borderRadius: 20, fontWeight: 600 }}>
                🎯 {doneCount}/{tasks.length} tâches
              </span>
              <span style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '5px 12px', borderRadius: 20, fontWeight: 600 }}>
                📈 {last.followersIG.toLocaleString('fr-FR')} abonnés
              </span>
              <span style={{ fontSize: 12, color: 'var(--green)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '5px 12px', borderRadius: 20, fontWeight: 700 }}>
                💰 {last.stripeMRR.toLocaleString('fr-FR')} € MRR
              </span>
            </div>
          </div>
          {/* Prochain call */}
          <div style={{ textAlign: 'center', padding: '18px 28px', background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Prochain call</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', marginBottom: 10 }}>{client.nextCall || 'Jeudi 14h'}</div>
            <Link href="/espace/calls" className="btn-ghost" style={{ fontSize: 12, display: 'inline-flex', gap: 5 }}>
              Détails <Icon name="chevR" size={12} />
            </Link>
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
            {tasks.filter(t => !t.done).map((task, i) => {
              const idx = tasks.indexOf(task);
              const prio = task.priority ? PRIORITY_CONFIG[task.priority] : null;
              const d = task.deadline ? new Date(task.deadline) : null;
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const diff = d ? Math.ceil((d.getTime() - today.getTime()) / 86400000) : null;
              const overdue = diff !== null && diff < 0;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 12,
                    background: overdue ? '#ef444408' : 'var(--surface-2)',
                    border: `1px solid ${overdue ? '#ef444440' : 'var(--border)'}`,
                  }}
                >
                  <div
                    className="task-check"
                    onClick={() => toggleTask(idx, true)}
                    role="checkbox" aria-checked={false} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(idx, true); } }}
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
                  {task.addedBy === 'coach' && (
                    <span title="Tâche assignée par votre coach" style={{ fontSize: 11, flexShrink: 0 }}>⭐</span>
                  )}
                </div>
              );
            })}
            {tasks.filter(t => !t.done).length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--green)', padding: '8px 0' }}>✓ Toutes vos tâches sont terminées !</div>
            )}
            {tasks.filter(t => t.done).length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>TERMINÉES ({tasks.filter(t => t.done).length})</div>
                {tasks.filter(t => t.done).map((task, i) => {
                  const idx = tasks.indexOf(task);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', opacity: 0.5 }}>
                      <div className="task-check checked" onClick={() => toggleTask(idx, false)} role="checkbox" aria-checked={true} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTask(idx, false); }} style={{ flexShrink: 0 }}>
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'line-through', flex: 1 }}>{task.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Mot du coach + ressources débloquées */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
            <div className="card-head">
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="sparkle" size={14} /> Message de votre coach
              </div>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--accent)', marginTop: 12, fontStyle: 'italic' }}>
              "Excellente semaine Thomas ! Ta régularité de publication commence à porter ses fruits. Continue sur cette lancée et n'oublie pas de DM les profils qui ont liké tes 3 derniers posts — c'est là que se cachent tes meilleurs prospects."
            </p>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>— Marc Laurent · il y a 2h</div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">Ressources débloquées</div>
              <Link href="/espace/resources" className="btn-ghost" style={{ fontSize: 12 }}>
                Voir tout <Icon name="chevR" size={12} />
              </Link>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(unlockedResources / totalResources) * 100}%`, background: 'var(--green)', borderRadius: 4, transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', minWidth: 40 }}>{unlockedResources}/{totalResources}</span>
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { title: 'Script de prospection DM', type: 'template', new: true },
                { title: 'Masterclass : Closing en DM', type: 'video' },
                { title: 'Checklist contenu semaine', type: 'pdf' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name={r.type === 'video' ? 'play' : r.type === 'pdf' ? 'folder' : 'list'} size={14} />
                  </div>
                  <div style={{ flex: 1, fontSize: 12, color: 'var(--accent)' }}>{r.title}</div>
                  {r.new && <span className="pill pill-green" style={{ fontSize: 10 }}>Nouveau</span>}
                  <Link href="/espace/resources" className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>
                    <Icon name="external" size={11} />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stats rapides */}
      <div className="grid-4" style={{ marginTop: 24 }}>
        {[
          { label: 'Followers IG', value: last.followersIG.toLocaleString('fr-FR'), sub: `+${last.followersIG - client.weeklyHistory[10].followersIG} cette semaine`, color: '#E1306C' },
          { label: 'Posts publiés', value: last.postsCount.toString(), sub: `${last.avgViews.toLocaleString('fr-FR')} vues moy.` },
          { label: 'DM envoyés', value: last.dmsSent.toString(), sub: `${last.dmsReplyRate}% réponse` },
          { label: 'MRR', value: `${last.stripeMRR.toLocaleString('fr-FR')} €`, sub: 'revenus mensuels', color: 'var(--green)' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="card kpi-card" style={{ padding: '16px 20px' }}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" style={color ? { color } : undefined}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>
            <div style={{ marginTop: 10 }}>
              <Sparkbars data={client.weeklyHistory.slice(-8).map(w => w.followersIG)} height={20} width={60} color={color || 'var(--accent)'} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
