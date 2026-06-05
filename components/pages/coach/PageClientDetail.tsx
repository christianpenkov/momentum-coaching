'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Ring from '@/components/ui/Ring';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import TaskModal from '@/components/ui/TaskModal';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { createClient as createSupabase } from '@/lib/supabase/client';
import type { Task } from '@/lib/supabase/types';

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
  const { getClient, addTask, toggleTask: ctxToggle, calls } = useSupabaseClients();
  const client = getClient(id);
  const tasks = client?.tasks || [];
  const [note, setNote] = useState(client?.private_notes || '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [depotComment, setDepotComment] = useState('');
  const [depotFiles, setDepotFiles] = useState<{ name: string; type: string; comment: string }[]>([]);
  const [depotComments, setDepotComments] = useState<{ file: string; text: string; by: 'coach'; time: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!client) return (
    <div className="page-content">
      <div className="page-header"><h1 className="page-title">Client introuvable</h1></div>
    </div>
  );

  const metrics = client.weeklyMetrics || [];
  const last = metrics[metrics.length - 1] || null;
  const prev = metrics[metrics.length - 2] || null;

  // Stats 30j
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent4Metrics = metrics.slice(-4); // ~4 semaines = ~30j
  const posts30 = recent4Metrics.reduce((sum, m) => sum + (m.posts_count || 0), 0);
  const leads30 = recent4Metrics.reduce((sum, m) => sum + (m.iclosed_deals || 0), 0);
  const calls30 = calls.filter(c =>
    c.client_id === id &&
    c.status !== 'cancelled' && c.status !== 'declined' &&
    c.scheduled_at != null &&
    new Date(c.scheduled_at) >= cutoff30
  ).length;
  const cash30 = last ? last.stripe_mrr : null;

  const doneCount = tasks.filter(t => t.done).length;
  const progress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  function toggleTask(taskId: string, done: boolean) {
    ctxToggle(id, taskId, done);
  }

  async function saveNote() {
    setNoteSaving(true);
    const supabase = createSupabase();
    await supabase.from('clients').update({ private_notes: note }).eq('id', id);
    setNoteSaving(false);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar initials={client.initials || client.name.slice(0, 2).toUpperCase()} size={48} />
          <div>
            <h1 className="page-title" style={{ marginBottom: 4 }}>{client.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{client.niche || 'Niche non définie'}</span>
              <Pill status={client.status} label={(client.status_text || client.status).slice(0, 30)} size="sm" />
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

      {/* KPIs rapides 30j */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Posts (30j)</div>
          <div className="kpi-value">{metrics.length > 0 ? posts30 : '—'}</div>
          {last && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{last.avg_views.toLocaleString('fr-FR')} vues moy.</div>}
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Leads générés (30j)</div>
          <div className="kpi-value">{metrics.length > 0 ? leads30 : '—'}</div>
          {last && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{last.closing_rate}% closing</div>}
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Calls (30j)</div>
          <div className="kpi-value">{calls30}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>sur la plateforme</div>
        </div>
        <div className="card kpi-card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Cash contracté</div>
          <div className="kpi-value">{cash30 !== null ? `${cash30.toLocaleString('fr-FR')} €` : '—'}</div>
          {last && prev && (() => {
            const g = prev.stripe_mrr > 0 ? Math.round(((last.stripe_mrr - prev.stripe_mrr) / prev.stripe_mrr) * 100) : 0;
            return <div className={`kpi-delta${g >= 0 ? ' kpi-delta-up' : ' kpi-delta-down'}`}>{g >= 0 ? '+' : ''}{g}% vs sem. préc.</div>;
          })()}
        </div>
      </div>

      <TaskModal open={modalOpen} onClose={() => setModalOpen(false)} onAdd={(t: any) => addTask(id, t)} />

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
              <button className="btn-primary" type="button" onClick={() => setModalOpen(true)} style={{ fontSize: 12, padding: '6px 12px', gap: 5 }}>
                <Icon name="plus" size={12} /> Ajouter
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
            {tasks.filter(t => !t.done).map(task => {
              const prio = task.priority ? PRIORITY_CONFIG[task.priority] : null;
              return (
                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div
                    className="task-check"
                    onClick={() => toggleTask(task.id, true)}
                    role="checkbox" aria-checked={false} tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(task.id, true); } }}
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
                  {task.added_by === 'coach' && (
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
                {tasks.filter(t => t.done).map(task => (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', opacity: 0.55 }}>
                    <div
                      className="task-check checked"
                      onClick={() => toggleTask(task.id, false)}
                      role="checkbox" aria-checked={true} tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(task.id, false); } }}
                      style={{ flexShrink: 0 }}
                    >
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)', textDecoration: 'line-through' }}>{task.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Profil détaillé */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Profil & Funnel</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="calendar" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Client depuis</span>
              <strong>{client.client_since ? `${client.client_since}j` : '—'}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="phone-call" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Prochain call</span>
              <strong>{client.next_call || 'Non planifié'}</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="target" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Taux iClosed</span>
              <strong style={{ color: 'var(--green)' }}>{client.iclosed_rate || 0}%</strong>
            </div>
            <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Icon name="calendar" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>Calls Calendly/mois</span>
              <strong>{client.calendly_monthly || 0}</strong>
            </div>
            {last && (
              <div className="info-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <Icon name="dollar-sign" size={14} /><span style={{ color: 'var(--muted)', flex: 1 }}>MRR actuel</span>
                <strong>{last.stripe_mrr.toLocaleString('fr-FR')} €</strong>
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Score momentum</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${client.momentum_score || 0}%`,
                    background: (client.momentum_score || 0) >= 70 ? 'var(--green)' : (client.momentum_score || 0) >= 40 ? 'var(--amber)' : 'var(--red)',
                    borderRadius: 4,
                    transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
                  }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', minWidth: 32 }}>{client.momentum_score || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes privées */}
      <div className="card" style={{ marginTop: 24 }}>
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
          <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={saveNote} disabled={noteSaving}>
            {noteSaved ? '✓ Sauvegardé' : noteSaving ? 'Enregistrement…' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      {/* Boîte de dépôt */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">Dépôt de contenus</div>
            <div className="card-sub">Scripts, vidéos, posts — déposez et commentez directement</div>
          </div>
          <button className="btn-primary" type="button" style={{ fontSize: 12, padding: '6px 12px', gap: 5 }} onClick={() => fileInputRef.current?.click()}>
            <Icon name="upload" size={12} /> Déposer un fichier
          </button>
          <input
            ref={fileInputRef} type="file" accept="video/*,image/*,.pdf,.doc,.docx,.txt" multiple
            style={{ display: 'none' }}
            onChange={e => {
              const files = Array.from(e.target.files || []);
              setDepotFiles(prev => [...prev, ...files.map(f => ({ name: f.name, type: f.type.startsWith('video') ? 'Vidéo' : f.type.startsWith('image') ? 'Image' : 'Document', comment: '' }))]);
              e.target.value = '';
            }}
          />
        </div>
        {depotFiles.length === 0 ? (
          <div style={{ marginTop: 16, padding: '32px 20px', border: '2px dashed var(--border)', borderRadius: 10, textAlign: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }} onClick={() => fileInputRef.current?.click()}>
            <div style={{ marginBottom: 6 }}><Icon name="upload" size={20} color="var(--faint)" /></div>
            Glisse tes scripts, vidéos ou posts ici, ou clique pour parcourir
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {depotFiles.map((file, i) => {
              const fileComments = depotComments.filter(c => c.file === file.name);
              return (
                <div key={i} style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--accent-soft)', color: 'var(--accent)' }}>{file.type}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{file.name}</span>
                    <button type="button" onClick={() => setDepotFiles(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, display: 'flex' }}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  {fileComments.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                      {fileComments.map((c, ci) => (
                        <div key={ci} style={{ padding: '8px 10px', background: '#EEF2FF', borderRadius: 8, borderLeft: '3px solid var(--accent)' }}>
                          <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, marginBottom: 3 }}>Coach · {c.time}</div>
                          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{c.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea placeholder="Laisser un commentaire sur ce contenu…" value={file.comment} onChange={e => setDepotFiles(prev => prev.map((f, idx) => idx === i ? { ...f, comment: e.target.value } : f))} rows={2}
                      style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', fontSize: 12, color: 'var(--ink)', resize: 'none', fontFamily: 'inherit', outline: 'none', lineHeight: 1.5 }} />
                    <button type="button" className="btn-primary" disabled={!file.comment.trim()} style={{ fontSize: 12, padding: '6px 12px', alignSelf: 'flex-end', opacity: file.comment.trim() ? 1 : 0.4 }}
                      onClick={() => {
                        if (!file.comment.trim()) return;
                        const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                        setDepotComments(prev => [...prev, { file: file.name, text: file.comment.trim(), by: 'coach', time: now }]);
                        setDepotFiles(prev => prev.map((f, idx) => idx === i ? { ...f, comment: '' } : f));
                      }}>
                      <Icon name="send" size={12} /> Envoyer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats & tendances */}
      {metrics.length > 1 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-head">
            <div>
              <div className="card-title">Statistiques — {metrics.length} semaines</div>
              <div className="card-sub">Évolution semaine par semaine</div>
            </div>
            <Link href={`/clients/${id}/analytics`} className="btn-primary" style={{ fontSize: 12 }}>
              <Icon name="bar-chart" size={13} /> Analytics complet
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 20 }}>
            {[
              { label: 'Followers Instagram', data: metrics.map(w => w.followers_ig), color: '#E1306C', format: (n: number) => n.toLocaleString('fr-FR') },
              { label: 'Posts / semaine',     data: metrics.map(w => w.posts_count),  color: 'var(--accent)', format: (n: number) => `${n} posts` },
              { label: 'Taux de closing',     data: metrics.map(w => w.closing_rate * 10), color: 'var(--green)', format: (_n: number, i: number) => `${metrics[i]?.closing_rate ?? 0}%` },
              { label: 'Taux no-show',        data: metrics.map(w => w.no_show_rate * 10), color: 'var(--amber)', format: (_n: number, i: number) => `${metrics[i]?.no_show_rate ?? 0}%` },
              { label: 'Rétention vidéo',     data: metrics.map(w => w.video_retention * 10), color: 'var(--accent)', format: (_n: number, i: number) => `${metrics[i]?.video_retention ?? 0}%` },
              { label: 'CTR lien en bio',     data: metrics.map(w => w.ctr_bio_link * 10), color: '#8B5CF6', format: (_n: number, i: number) => `${metrics[i]?.ctr_bio_link ?? 0}%` },
              { label: 'MRR Stripe',          data: metrics.map(w => w.stripe_mrr), color: 'var(--green)', format: (n: number) => `${n.toLocaleString('fr-FR')} €` },
              { label: 'DM envoyés',          data: metrics.map(w => w.dms_sent), color: 'var(--muted)', format: (n: number) => `${n} DM` },
            ].map(({ label, data, color, format }) => {
              const lastVal = data[data.length - 1] ?? 0;
              const prevVal = data[data.length - 2] ?? 0;
              const delta = lastVal - prevVal;
              const pct = prevVal > 0 ? Math.round((delta / prevVal) * 100) : 0;
              return (
                <div key={label} style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 500 }}>{label}</div>
                  <div style={{ marginBottom: 10 }}>
                    <Sparkbars data={data} height={30} width={100} color={color} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    {format(lastVal, data.length - 1)}
                  </div>
                  <div style={{ fontSize: 11, color: pct >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 3, fontWeight: 600 }}>
                    {pct >= 0 ? '+' : ''}{pct}% vs sem. préc.
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
