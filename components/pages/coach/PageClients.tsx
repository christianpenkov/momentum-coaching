'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Chip from '@/components/ui/Chip';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { createClient } from '@/lib/supabase/client';

type Filter = 'all' | 'green' | 'amber' | 'red';

export default function PageClients() {
  const { clients, loading } = useSupabaseClients();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'mrr' | 'followers' | 'week'>('mrr');
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newNiche, setNewNiche] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaveError('Non connecté'); setSaving(false); return; }

    const { error } = await supabase.from('clients').insert({
      coach_id: user.id,
      name: newName.trim(),
      email: newEmail.trim() || null,
      niche: newNiche.trim() || null,
      status: 'green',
      week: 1,
    });

    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }

    setShowModal(false);
    setNewName('');
    setNewEmail('');
    setNewNiche('');
    setSaving(false);
    window.location.reload();
  }

  const filtered = useMemo(() => {
    let list = [...clients];
    if (filter !== 'all') list = list.filter(c => c.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.niche || '').toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sort === 'mrr') return (b.latestMetrics?.stripe_mrr || 0) - (a.latestMetrics?.stripe_mrr || 0);
      if (sort === 'followers') return (b.latestMetrics?.followers_ig || 0) - (a.latestMetrics?.followers_ig || 0);
      if (sort === 'week') return (b.week || 0) - (a.week || 0);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [clients, filter, search, sort]);

  const counts = {
    all: clients.length,
    green: clients.filter(c => c.status === 'green').length,
    amber: clients.filter(c => c.status === 'amber').length,
    red: clients.filter(c => c.status === 'red').length,
  };

  if (loading) return <InlineLoader fullPage />;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-sub">{clients.length} élève{clients.length !== 1 ? 's' : ''} · {filtered.length} affiché{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" type="button" onClick={() => setShowModal(true)}>
          <Icon name="plus" size={14} /> Nouveau client
        </button>
      </div>

      {/* Modal nouveau client */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '32px 28px', width: 420, boxShadow: 'var(--shadow-elev)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>Ajouter un client</div>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18 }}>×</button>
            </div>
            <form onSubmit={handleAddClient} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Nom *</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} required placeholder="Prénom Nom"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Email</label>
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="client@email.fr"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Niche</label>
                <input value={newNiche} onChange={e => setNewNiche(e.target.value)} placeholder="Ex : Fitness, Marketing…"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {saveError && (
                <div style={{ fontSize: 12, color: 'var(--red)', padding: '7px 10px', background: 'var(--red-soft)', borderRadius: 6 }}>{saveError}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn-ghost" style={{ fontSize: 13 }}>Annuler</button>
                <button type="submit" disabled={saving} className="btn-primary" style={{ fontSize: 13, opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Enregistrement…' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Filtres + recherche */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'green', 'amber', 'red'] as Filter[]).map(f => (
            <Chip
              key={f}
              label={`${f === 'all' ? 'Tous' : f === 'green' ? 'Vert' : f === 'amber' ? 'Vigilance' : 'Alerte'} (${counts[f]})`}
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
          <option value="mrr">Trier par MRR</option>
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
                  <th>Statut</th>
                  <th>Semaine</th>
                  <th>IG</th>
                  <th>YT</th>
                  <th>MRR</th>
                  <th>Closing</th>
                  <th>Tendance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const m = c.latestMetrics;
                  const igDelta = m && c.prevMetrics ? m.followers_ig - c.prevMetrics.followers_ig : 0;
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/clients/${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
                          <Avatar initials={c.initials || c.name.slice(0, 2).toUpperCase()} size={32} />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.niche || 'Infopreneur'}</div>
                          </div>
                        </Link>
                      </td>
                      <td>
                        <Pill
                          status={c.status as 'green' | 'amber' | 'red'}
                          label={c.status === 'green' ? 'Vert' : c.status === 'amber' ? 'Vigilance' : 'Alerte'}
                          size="sm"
                        />
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>S{c.week}</td>
                      <td>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>
                          {(m?.followers_ig || 0).toLocaleString('fr-FR')}
                        </div>
                        {igDelta !== 0 && (
                          <div style={{ fontSize: 11, color: igDelta > 0 ? 'var(--green)' : 'var(--red)' }}>
                            {igDelta > 0 ? '+' : ''}{igDelta}
                          </div>
                        )}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {(m?.followers_yt || 0).toLocaleString('fr-FR')}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                        {(m?.stripe_mrr || 0).toLocaleString('fr-FR')} €
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {m?.closing_rate ? `${m.closing_rate}%` : '—'}
                      </td>
                      <td>
                        <Sparkbars
                          data={c.weeklyMetrics.slice(-8).map(w => w.followers_ig)}
                          height={22} width={52}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Link href={`/clients/${c.id}`} className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>
                            Fiche
                          </Link>
                          <Link href={`/clients/${c.id}/brief`} className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>
                            Brief
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
