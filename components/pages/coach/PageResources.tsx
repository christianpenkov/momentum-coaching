'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import { resources } from '@/lib/data';

const TYPE_ICONS: Record<string, 'play' | 'folder' | 'list' | 'mic'> = {
  Vidéo: 'play',
  PDF: 'folder',
  Notion: 'list',
  Template: 'list',
  Checklist: 'list',
};

export default function PageResources() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const types = ['all', ...Array.from(new Set(resources.map(r => r.type)))];

  const filtered = resources.filter(r => {
    const matchType = typeFilter === 'all' || r.type === typeFilter;
    const matchSearch = !search || r.title.toLowerCase().includes(search.toLowerCase()) || r.desc.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ressources</h1>
          <p className="page-sub">{resources.length} ressources · bibliothèque du coach</p>
        </div>
        <button className="btn-primary" type="button">
          <Icon name="upload" size={14} /> Ajouter
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {types.map(t => (
            <button
              key={t}
              className={`chip${typeFilter === t ? ' chip-active' : ''}`}
              onClick={() => setTypeFilter(t)}
              type="button"
            >
              {t === 'all' ? 'Tout' : t}
            </button>
          ))}
        </div>
        <div className="search-wrap" style={{ flex: 1, minWidth: 200 }}>
          <Icon name="search" size={14} />
          <input
            className="search-input"
            placeholder="Rechercher une ressource…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="resource-grid">
        {filtered.map((res) => (
          <div key={res.id} className="card resource-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={TYPE_ICONS[res.type] || 'folder'} size={18} />
              </div>
              <span className="pill pill-green" style={{ fontSize: 10 }}>Disponible</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>{res.title}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 12 }}>{res.desc}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span className="pill pill-neutral" style={{ fontSize: 10 }}>{res.type}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{res.duration || (res.week ? `Sem. ${res.week}` : '')}</span>
            </div>
            <button className="btn-ghost" style={{ width: '100%', justifyContent: 'center', display: 'flex', gap: 6, fontSize: 12 }} type="button">
              <Icon name="external" size={13} /> Ouvrir
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>
            Aucune ressource trouvée
          </div>
        )}
      </div>
    </div>
  );
}
