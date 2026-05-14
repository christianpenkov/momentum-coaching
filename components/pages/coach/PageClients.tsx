'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Chip from '@/components/ui/Chip';
import Sparkbars from '@/components/ui/Sparkbars';
import Icon from '@/components/ui/Icon';
import { clients } from '@/lib/data';

type Filter = 'all' | 'green' | 'amber' | 'red';

export default function PageClients() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'mrr' | 'followers' | 'week'>('mrr');

  const filtered = useMemo(() => {
    let list = [...clients];
    if (filter !== 'all') list = list.filter(c => c.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.niche.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (sort === 'mrr') return (b.weeklyHistory[11]?.stripeMRR || 0) - (a.weeklyHistory[11]?.stripeMRR || 0);
      if (sort === 'followers') return (b.weeklyHistory[11]?.followersIG || 0) - (a.weeklyHistory[11]?.followersIG || 0);
      if (sort === 'week') return b.week - a.week;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [filter, search, sort]);

  const counts = {
    all: clients.length,
    green: clients.filter(c => c.status === 'green').length,
    amber: clients.filter(c => c.status === 'amber').length,
    red: clients.filter(c => c.status === 'red').length,
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-sub">{clients.length} élèves · {filtered.length} affichés</p>
        </div>
        <button className="btn-primary" type="button">
          <Icon name="plus" size={14} /> Nouveau client
        </button>
      </div>

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
          className="select-ghost"
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

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th>Élève</th>
                <th>Statut</th>
                <th>Semaine</th>
                <th>Audience</th>
                <th>Posts</th>
                <th>DM</th>
                <th>MRR</th>
                <th>Tendance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/clients/${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
                      <Avatar initials={c.initials} size={32} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.niche}</div>
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
                      {c.followers}
                    </div>
                    <div style={{ fontSize: 11, color: c.fdir === 'up' ? 'var(--green)' : 'var(--red)' }}>
                      {c.fdir === 'up' ? '+' : '-'}{c.fdelta}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.posts}/sem</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.dms}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                    {c.mrr}
                  </td>
                  <td>
                    <Sparkbars
                      data={c.weeklyHistory.slice(-8).map(w => w.followersIG)}
                      height={22}
                      width={52}
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
