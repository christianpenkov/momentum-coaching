'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import InlineLoader from '@/components/ui/InlineLoader';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import ResourceModal, { type Resource } from './ResourceModal';
import ResourceCardCoach from './ResourceCardCoach';
import AccessSheet from './AccessSheet';
import ResourcePreviewModal from './ResourcePreviewModal';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { ease: 'easeOut' as const, duration: 0.35 } },
};

export default function PageResources() {
  const { clients } = useSupabaseClients();
  const supabase = createClient();

  const [resources, setResources] = useState<Resource[]>([]);
  const [accessMap, setAccessMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [accessResource, setAccessResource] = useState<Resource | null>(null);
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);

  const load = useCallback(async () => {
    let { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      await new Promise(r => setTimeout(r, 400));
      const retry = await supabase.auth.getUser();
      user = retry.data.user;
    }
    if (!user) return;

    const [resourcesRes, accessRes] = await Promise.all([
      supabase.from('resources').select('*').eq('coach_id', user.id).order('position'),
      supabase.from('resource_access').select('resource_id, client_id').eq('unlocked', true),
    ]);

    setResources(resourcesRes.data || []);

    const map: Record<string, string[]> = {};
    for (const row of accessRes.data || []) {
      if (!map[row.resource_id]) map[row.resource_id] = [];
      map[row.resource_id].push(row.client_id);
    }
    setAccessMap(map);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function getAccessClients(resourceId: string): ClientWithMetrics[] {
    const profileIds = accessMap[resourceId] || [];
    return clients.filter(c => c.profile_id && profileIds.includes(c.profile_id));
  }

  function openCreate() {
    setEditingResource(null);
    setModalOpen(true);
  }

  function openEdit(r: Resource) {
    setPreviewResource(null);
    setEditingResource(r);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingResource(null);
  }

  function handleSaved(saved: Resource) {
    setResources(prev => {
      const idx = prev.findIndex(r => r.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    closeModal();
  }

  async function handleDelete(r: Resource) {
    if (!confirm(`Supprimer « ${r.title} » ?`)) return;
    if (r.file_url) {
      const path = r.file_url.split('/resources/')[1];
      if (path) await supabase.storage.from('resources').remove([path]);
    }
    await supabase.from('resources').delete().eq('id', r.id);
    setResources(prev => prev.filter(res => res.id !== r.id));
  }

  const filtered = resources.filter(r =>
    !search || r.title.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="page-content">
      <div className="page-header"><h1 className="page-title">Ressources</h1></div>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><InlineLoader /></div>
    </div>
  );

  return (
    <div className="page-content" style={{ position: 'relative' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Ressources</h1>
          <p className="page-sub">
            {resources.length} ressource{resources.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {resources.length > 0 && (
            <div style={{ position: 'relative' }}>
              <Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher…"
                style={{
                  paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)',
                  outline: 'none', width: 170,
                }}
              />
            </div>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={openCreate}
            style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="plus" size={14} /> Nouvelle ressource
          </button>
        </div>
      </div>

      {/* Empty state */}
      {resources.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
          style={{ textAlign: 'center', padding: '56px 20px' }}
        >
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <Icon name="folder" size={24} style={{ color: 'var(--muted)' }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>
            Aucune ressource
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.5 }}>
            Crée ta première ressource à débloquer<br />pour tes élèves.
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={openCreate}
            style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="plus" size={13} /> Créer une ressource
          </button>
        </motion.div>
      )}

      {/* No results */}
      {resources.length > 0 && filtered.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', paddingTop: 40 }}>
          Aucune ressource ne correspond à ta recherche.
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <motion.div
          className="resource-grid"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {filtered.map(resource => (
            <motion.div key={resource.id} variants={itemVariants}>
              <ResourceCardCoach
                resource={resource}
                accessClients={getAccessClients(resource.id)}
                onEdit={openEdit}
                onDelete={handleDelete}
                onManageAccess={r => setAccessResource(r)}
                onOpen={r => setPreviewResource(r)}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Modal création/édition — key force remontage par ressource */}
      <AnimatePresence>
        {modalOpen && (
          <ResourceModal
            key={editingResource?.id ?? 'new'}
            resource={editingResource}
            onClose={closeModal}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>

      {/* Aperçu ressource */}
      <AnimatePresence>
        {previewResource && (
          <ResourcePreviewModal
            key={previewResource.id}
            resource={previewResource}
            onClose={() => setPreviewResource(null)}
            onEdit={openEdit}
          />
        )}
      </AnimatePresence>

      {/* AccessSheet — key force remontage par ressource (bug #7) */}
      <AnimatePresence>
        {accessResource && (
          <AccessSheet
            key={accessResource.id}
            resource={accessResource}
            onClose={() => setAccessResource(null)}
            onChanged={load}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
