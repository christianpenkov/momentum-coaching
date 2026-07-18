'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import InlineLoader from '@/components/ui/InlineLoader';
import DrawerShell from '@/components/ui/DrawerShell';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { sectionHasChildren } from '@/lib/resourceHelpers';
import ResourceModal, { type Resource } from './ResourceModal';
import ResourceCardCoach from './ResourceCardCoach';
import ResourceSectionTree from './ResourceSectionTree';
import AccessSheet from './AccessSheet';
import ResourcePreviewModal from './ResourcePreviewModal';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';
import type { ResourceSection } from '@/lib/resourceTypes';

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { ease: 'easeOut' as const, duration: 0.35 } },
};

type SectionSelection = string | null | 'folders';

function SectionFolderCard({ section, count, subCount, onClick }: {
  section: ResourceSection;
  count: number;
  subCount: number;
  onClick: () => void;
}) {
  return (
    <motion.div
      variants={itemVariants}
      className="card dc-liftrow"
      onClick={onClick}
      style={{
        padding: '15px 16px', display: 'flex', alignItems: 'center', gap: 13,
        cursor: 'pointer',
      }}
    >
      <span style={{
        width: 40, height: 40, borderRadius: 11, flexShrink: 0,
        background: 'rgba(58,106,134,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="folder" size={19} style={{ color: '#3a6a86' }} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {section.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          {count} ressource{count !== 1 ? 's' : ''}{subCount > 0 ? ` · ${subCount} sous-section${subCount !== 1 ? 's' : ''}` : ''}
        </div>
      </div>
      <Icon name="chevR" size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
    </motion.div>
  );
}

export default function PageResources() {
  const { clients } = useSupabaseClients();
  const supabase = createClient();

  const [resources, setResources] = useState<Resource[]>([]);
  const [sections, setSections] = useState<ResourceSection[]>([]);
  const [accessMap, setAccessMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<SectionSelection>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [autoCreateFolder, setAutoCreateFolder] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [accessResource, setAccessResource] = useState<Resource | null>(null);
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);

  const refreshAccessMap = useCallback(async () => {
    const { data } = await supabase.from('resource_access').select('resource_id, client_id').eq('unlocked', true);
    const map: Record<string, string[]> = {};
    for (const row of data || []) {
      if (!map[row.resource_id]) map[row.resource_id] = [];
      map[row.resource_id].push(row.client_id);
    }
    setAccessMap(map);
  }, []);

  const load = useCallback(async () => {
    let { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      await new Promise(r => setTimeout(r, 400));
      const retry = await supabase.auth.getUser();
      user = retry.data.user;
    }
    if (!user) return;

    const [resourcesRes, accessRes, sectionsRes] = await Promise.all([
      supabase.from('resources').select('*').eq('coach_id', user.id).order('created_at', { ascending: false }),
      supabase.from('resource_access').select('resource_id, client_id').eq('unlocked', true),
      supabase.from('resource_sections').select('*').eq('coach_id', user.id).order('position'),
    ]);

    setResources(resourcesRes.data || []);
    setSections(sectionsRes.data || []);

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
      return [saved, ...prev];
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

  async function handleCreateSection(name: string, parentId: string | null) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const position = sections.filter(s => s.parent_id === parentId).length;
    const { data, error } = await supabase.from('resource_sections')
      .insert({ coach_id: user.id, name, parent_id: parentId, icon: 'folder', color: '#3a6a86', position })
      .select().single();
    if (error) { console.error('create section error', error); return; }
    setSections(prev => [...prev, data]);
  }

  async function handleRenameSection(id: string, name: string) {
    const { data, error } = await supabase.from('resource_sections').update({ name }).eq('id', id).select().single();
    if (error) { console.error('rename section error', error); return; }
    setSections(prev => prev.map(s => s.id === id ? data : s));
  }

  async function handleDeleteSection(id: string) {
    const section = sections.find(s => s.id === id);
    if (!section) return;
    const destinationId = section.parent_id; // remonte au parent, ou null (racine) si c'était un dossier racine

    const { error: subError } = await supabase.from('resource_sections').update({ parent_id: destinationId }).eq('parent_id', id);
    if (subError) { console.error('move subsections error', subError); return; }

    const { error: resError } = await supabase.from('resources').update({ section_id: destinationId }).eq('section_id', id);
    if (resError) { console.error('move resources error', resError); return; }

    const { error: delError } = await supabase.from('resource_sections').delete().eq('id', id);
    if (delError) { console.error('delete section error', delError); return; }

    setSections(prev => prev.filter(s => s.id !== id).map(s => s.parent_id === id ? { ...s, parent_id: destinationId } : s));
    setResources(prev => prev.map(r => r.section_id === id ? { ...r, section_id: destinationId } : r));
    if (activeSectionId === id) setActiveSectionId(destinationId);
  }

  const activeSection = (activeSectionId && activeSectionId !== 'folders') ? sections.find(s => s.id === activeSectionId) : null;
  const activeParent = activeSection?.parent_id ? sections.find(s => s.id === activeSection.parent_id) : null;

  const showAllFolders = activeSectionId === 'folders';
  const drillDownChildren = (!showAllFolders && activeSectionId && sectionHasChildren(sections, activeSectionId))
    ? sections.filter(s => s.parent_id === activeSectionId)
    : [];
  const showingFolderCards = showAllFolders || drillDownChildren.length > 0;

  const folderCards = showAllFolders
    ? sections.filter(s => s.parent_id === null)
    : drillDownChildren;

  const filtered = showAllFolders ? [] : resources.filter(r =>
    (!search || r.title.toLowerCase().includes(search.toLowerCase())) &&
    r.section_id === (activeSectionId as string | null)
  );

  if (loading) return (
    <div className="page-content">
      <div className="page-header"><h1 className="page-title">Ressources</h1></div>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><InlineLoader /></div>
    </div>
  );

  return (
    <div className="page-content" style={{ position: 'relative' }}>
      {/* Barre de navigation dossiers — ☰ + fil d'ariane, en haut à gauche */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          title="Dossiers"
          style={{
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '8px 9px', cursor: 'pointer',
            color: 'var(--ink)', display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
        >
          <Icon name="list" size={15} />
        </button>
        {activeSectionId && activeSection ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
            <span style={{ cursor: 'pointer' }} onClick={() => setActiveSectionId(null)}>Ressources</span>
            {activeParent && (
              <>
                <Icon name="chevR" size={10} />
                <span style={{ cursor: 'pointer' }} onClick={() => setActiveSectionId(activeParent.id)}>{activeParent.name}</span>
              </>
            )}
            <Icon name="chevR" size={10} />
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{activeSection.name}</span>
          </div>
        ) : activeSectionId === 'folders' ? (
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>Ressources</div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Ressources</div>
        )}
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Ressources</h1>
          <p className="page-sub">
            {resources.length} ressource{resources.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setActiveSectionId('folders')}
            className="btn-ghost"
            style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 8 }}
          >
            <Icon name="folder" size={14} /> Tous les dossiers
          </button>
          <button
            type="button"
            onClick={() => { setAutoCreateFolder(true); setDrawerOpen(true); }}
            className="btn-ghost"
            style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 8 }}
          >
            <Icon name="plus" size={14} /> Dossier
          </button>
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
            className="btn-primary-brand"
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
            className="btn-primary-brand"
            onClick={openCreate}
            style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="plus" size={13} /> Créer une ressource
          </button>
        </motion.div>
      )}

      {/* No results */}
      {resources.length > 0 && !showingFolderCards && filtered.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', paddingTop: 40 }}>
          {search ? 'Aucune ressource ne correspond à ta recherche.' : 'Ce dossier est vide.'}
        </div>
      )}
      {showAllFolders && folderCards.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', paddingTop: 40 }}>
          Aucun dossier créé pour l'instant.
        </div>
      )}

      {/* Cartes-dossier (Tous les dossiers ou drill-down) */}
      {showingFolderCards && folderCards.length > 0 && (
        <motion.div
          className="resource-grid"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {folderCards.map(fc => (
            <SectionFolderCard
              key={fc.id}
              section={fc}
              count={resources.filter(r => r.section_id === fc.id).length}
              subCount={sections.filter(s => s.parent_id === fc.id).length}
              onClick={() => setActiveSectionId(fc.id)}
            />
          ))}
        </motion.div>
      )}

      {/* Ressources directes du dossier en drill-down */}
      {drillDownChildren.length > 0 && filtered.length > 0 && (
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '18px 0 10px' }}>
          Dans ce dossier
        </div>
      )}

      {/* Grid ressources (flat, ou "dans ce dossier" en drill-down) */}
      {!showAllFolders && filtered.length > 0 && (
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
            sections={sections}
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
            onChanged={refreshAccessMap}
            onDefaultChanged={(id, val) => {
              setResources(prev => prev.map(r => r.id === id ? { ...r, is_default: val } : r));
            }}
          />
        )}
      </AnimatePresence>

      {/* Tiroir dossiers */}
      <AnimatePresence>
        {drawerOpen && (
          <DrawerShell onClose={() => { setDrawerOpen(false); setAutoCreateFolder(false); }}>
            <ResourceSectionTree
              sections={sections}
              resources={resources}
              activeSectionId={activeSectionId === 'folders' ? null : activeSectionId}
              onSelect={setActiveSectionId}
              onClose={() => { setDrawerOpen(false); setAutoCreateFolder(false); }}
              readOnly={false}
              autoCreate={autoCreateFolder}
              onCreate={handleCreateSection}
              onRename={handleRenameSection}
              onDelete={handleDeleteSection}
            />
          </DrawerShell>
        )}
      </AnimatePresence>
    </div>
  );
}
