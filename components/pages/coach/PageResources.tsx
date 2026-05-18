'use client';

import { useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import type { DepotFile } from '@/lib/supabase/types';

export default function PageResources() {
  const { clients, loading } = useSupabaseClients();
  const [files, setFiles] = useState<(DepotFile & { client_name?: string })[]>([]);
  const [search, setSearch] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (clients.length === 0) { setLoadingFiles(false); return; }
    const clientIds = clients.map(c => c.id);
    supabase.from('depot_files').select('*').in('client_id', clientIds)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const enriched = (data || []).map(f => ({
          ...f,
          client_name: clients.find(c => c.id === f.client_id)?.name,
        }));
        setFiles(enriched);
        setLoadingFiles(false);
      });
  }, [clients]);

  const filtered = files.filter(f =>
    !search || f.file_name.toLowerCase().includes(search.toLowerCase()) || f.client_name?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading || loadingFiles) {
    return (
      <div className="page-content">
        <div className="page-header"><h1 className="page-title">Ressources</h1></div>
        <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          <Icon name="refresh-cw" size={16} /> Chargement…
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ressources</h1>
          <p className="page-sub">{files.length} fichier{files.length !== 1 ? 's' : ''} partagé{files.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 20, maxWidth: 340 }}>
        <Icon name="search" size={13} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un fichier…"
          style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--ink)', flex: 1 }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
          {files.length === 0
            ? 'Aucun fichier partagé pour le moment. Les ressources apparaîtront ici quand tu ou tes clients en déposeront.'
            : 'Aucun résultat pour cette recherche.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Fichier</th>
                <th>Client</th>
                <th>Type</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id}>
                  <td style={{ fontSize: 13, fontWeight: 500 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon name="folder" size={14} />
                      {f.file_name}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{f.client_name || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{f.file_type || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(f.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
