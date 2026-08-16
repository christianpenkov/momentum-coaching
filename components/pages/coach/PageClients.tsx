'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import Chip from '@/components/ui/Chip';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { getClientSignals, isTaskOverdue } from '@/lib/clientSignals';
import { getClientWeek } from '@/lib/clientWeek';
import AddClientModal from '@/components/ui/AddClientModal';
import { createClient as createSupabase } from '@/lib/supabase/client';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';

type Filter = 'all' | 'overdue' | 'noshow';

export default function PageClients() {
  const router = useRouter();
  const { clients, loading, unarchiveClient, refetch } = useSupabaseClients();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'cash' | 'followers' | 'week'>('cash');
  const [showModal, setShowModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedClients, setArchivedClients] = useState<ClientWithMetrics[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);

  async function loadArchived() {
    setArchivedLoading(true);
    const supabase = createSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setArchivedLoading(false); return; }
    const { data } = await supabase
      .from('clients').select('*').eq('coach_id', user.id).not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });
    setArchivedClients((data || []) as ClientWithMetrics[]);
    setArchivedLoading(false);
  }

  function toggleShowArchived() {
    const next = !showArchived;
    setShowArchived(next);
    if (next) loadArchived();
  }

  async function handleUnarchive(clientId: string) {
    const ok = await unarchiveClient(clientId);
    if (ok) setArchivedClients(prev => prev.filter(c => c.id !== clientId));
  }

  const signalsByClient = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getClientSignals>>();
    for (const c of clients) map.set(c.id, getClientSignals(c.tasks, c.sessionReports));
    return map;
  }, [clients]);

  const filtered = useMemo(() => {
    let list = [...clients];
    if (filter === 'overdue') list = list.filter(c => (signalsByClient.get(c.id)?.overdueTasksCount ?? 0) > 0);
    if (filter === 'noshow') list = list.filter(c => (signalsByClient.get(c.id)?.activeNoShowsCount ?? 0) > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.niche || '').toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sort === 'cash') return (b.currentStats?.cashContracted || 0) - (a.currentStats?.cashContracted || 0);
      if (sort === 'followers') return (b.currentStats?.followersIg || 0) - (a.currentStats?.followersIg || 0);
      if (sort === 'week') return getClientWeek(b.onboarding_completed_at) - getClientWeek(a.onboarding_completed_at);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [clients, filter, search, sort, signalsByClient]);

  const counts = {
    all: clients.length,
    overdue: clients.filter(c => (signalsByClient.get(c.id)?.overdueTasksCount ?? 0) > 0).length,
    noshow: clients.filter(c => (signalsByClient.get(c.id)?.activeNoShowsCount ?? 0) > 0).length,
  };

  if (loading) return <InlineLoader fullPage />;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-sub">{clients.length} élève{clients.length !== 1 ? 's' : ''} · {filtered.length} affiché{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" type="button" onClick={toggleShowArchived} style={{ fontSize: 13 }}>
            <Icon name="archive" size={14} /> {showArchived ? 'Masquer les archivés' : 'Voir les archivés'}
          </button>
          <button className="btn-primary-brand" type="button" onClick={() => setShowModal(true)}>
            <Icon name="plus" size={14} /> Nouveau client
          </button>
        </div>
      </div>

      {showArchived && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>
            Élèves archivés
          </div>
          {archivedLoading ? (
            <div style={{ padding: '20px', fontSize: 13, color: 'var(--muted)' }}>Chargement…</div>
          ) : archivedClients.length === 0 ? (
            <div style={{ padding: '20px', fontSize: 13, color: 'var(--muted)' }}>Aucun élève archivé.</div>
          ) : (
            archivedClients.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{c.name}</div>
                <button type="button" onClick={() => handleUnarchive(c.id)} className="btn-ghost" style={{ fontSize: 12 }}>
                  Désarchiver
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <AddClientModal open={showModal} onClose={() => setShowModal(false)} />

      {/* Filtres + recherche */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="chip-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {(['all', 'overdue', 'noshow'] as Filter[]).map(f => (
            <Chip
              key={f}
              label={`${f === 'all' ? 'Tous' : f === 'overdue' ? 'A des tâches en retard' : 'A un no-show non traité'} (${counts[f]})`}
              active={filter === f}
              onClick={() => setFilter(f)}
            />
          ))}
        </div>
        <div className="search-wrap" style={{ flex: 1, minWidth: 200 }}>
          <Icon name="search" size={14} />
          <input
            className="search-input"
            placeholder="Rechercher un élève…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as typeof sort)}
          style={{ fontSize: 12, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--accent)', cursor: 'pointer' }}
        >
          <option value="cash">Trier par cash</option>
          <option value="followers">Trier par audience</option>
          <option value="week">Trier par semaine</option>
          <option value="name">Trier par nom</option>
        </select>
      </div>

      {clients.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🎯</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Aucun client encore</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Quand un client paie sur Stripe, il apparaît ici automatiquement.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 800 }}>
              <thead>
                <tr>
                  <th>Élève</th>
                  <th>Onboarding</th>
                  <th>Signaux</th>
                  <th>Semaine</th>
                  <th>IG</th>
                  <th>YT</th>
                  <th>Cash</th>
                  <th>Closing</th>
                  <th>Tendance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const m = c.currentStats;
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/clients/${c.id}`)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar initials={c.initials || getInitials(c.name)} avatarUrl={c.avatar_url} size={32} seed={c.id} />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.niche || 'Infopreneur'}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <OnboardingBadge status={c.onboardingStatus} />
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <SignalsCell client={c} signals={signalsByClient.get(c.id)} onResolved={refetch} />
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>S{getClientWeek(c.onboarding_completed_at)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>
                        {(m?.followersIg || 0).toLocaleString('fr-FR')}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {(m?.followersYt || 0).toLocaleString('fr-FR')}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                        {(m?.cashContracted || 0).toLocaleString('fr-FR')} €
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {m ? `${m.closingRate}%` : '—'}
                      </td>
                      <td>
                        <Sparkbars
                          data={c.cashContractedTrend}
                          height={22} width={52}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Link href={`/clients/${c.id}`} onClick={e => e.stopPropagation()} className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>
                            Fiche
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const ONBOARDING_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  invited:           { label: 'Invité',               color: 'var(--muted)', bg: 'var(--surface-2)' },
  account_created:   { label: 'Compte créé',          color: 'var(--amber)', bg: 'var(--amber-soft)' },
  integrating:       { label: 'Intégrations en cours', color: 'var(--amber)', bg: 'var(--amber-soft)' },
  reconnect_needed:  { label: 'Reconnexion requise',  color: 'var(--red)', bg: '#ef444420' },
  active:            { label: 'Actif',                color: 'var(--green)', bg: '#22c55e20' },
};

function OnboardingBadge({ status }: { status?: string }) {
  const cfg = ONBOARDING_LABELS[status || 'active'] ?? ONBOARDING_LABELS.active;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
      color: cfg.color, background: cfg.bg, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

// Badge Signaux cliquable — ouvre un menu listant chaque tâche en retard / no-show
// individuellement avec un bouton pour le résoudre, sans quitter la liste clients.
// Réutilise les mêmes routes API que PageClientDetail.tsx (resolveTask/acknowledgeNoShow).
function SignalsCell({ client, signals, onResolved }: {
  client: ClientWithMetrics;
  signals: ReturnType<typeof getClientSignals> | undefined;
  onResolved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (!signals || signals.total === 0) return <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>;

  const overdueTasks = client.tasks.filter(t => t.added_by === 'coach' && isTaskOverdue(t));
  const activeNoShows = client.sessionReports.filter(r => r.attended === false && !r.acknowledged_at);

  async function resolveTask(taskId: string) {
    setBusyId(taskId);
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved_by_coach: true }),
    });
    setBusyId(null);
    if (res.ok) onResolved();
  }

  async function acknowledgeNoShow(reportId: string) {
    setBusyId(reportId);
    const res = await fetch(`/api/session-reports/${reportId}/acknowledge`, { method: 'PATCH' });
    setBusyId(null);
    if (res.ok) onResolved();
  }

  const parts = [
    signals.overdueTasksCount > 0 ? `${signals.overdueTasksCount} tâche${signals.overdueTasksCount > 1 ? 's' : ''} en retard` : null,
    signals.activeNoShowsCount > 0 ? `${signals.activeNoShowsCount} no-show${signals.activeNoShowsCount > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
      >
        {parts}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 20,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 260, padding: 6,
        }}>
          {overdueTasks.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--ink)' }}>{t.label}</span>
              <button
                type="button"
                onClick={() => resolveTask(t.id)}
                disabled={busyId === t.id}
                className="btn-ghost"
                style={{ fontSize: 11, flexShrink: 0, opacity: busyId === t.id ? 0.5 : 1 }}
              >
                Résoudre
              </button>
            </div>
          ))}
          {activeNoShows.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--ink)' }}>No-show</span>
              <button
                type="button"
                onClick={() => acknowledgeNoShow(r.id)}
                disabled={busyId === r.id}
                className="btn-ghost"
                style={{ fontSize: 11, flexShrink: 0, opacity: busyId === r.id ? 0.5 : 1 }}
              >
                Compris
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
