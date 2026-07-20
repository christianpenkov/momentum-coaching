'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import InlineLoader from '@/components/ui/InlineLoader';
import ModalShell from '@/components/ui/ModalShell';
import DrawerShell from '@/components/ui/DrawerShell';
import { createClient } from '@/lib/supabase/client';
import { formatSize, getEmbedUrl, TYPE_META, isImageFile, sectionHasChildren, type ResourceType } from '@/lib/resourceHelpers';
import ResourceThumbnail from '@/components/pages/coach/ResourceThumbnail';
import ResourceSectionTree from '@/components/pages/coach/ResourceSectionTree';
import type { Resource, ResourceSection } from '@/lib/resourceTypes';

// is_new calculé côté client depuis seen_at (par élève), pas depuis resources.is_new
interface ResourceWithSeen extends Resource {
  seen_at: string | null;
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { ease: 'easeOut' as const, duration: 0.38 } },
};

// Modale d'aperçu côté élève
function ResourcePreviewModal({ resource, onClose }: { resource: ResourceWithSeen; onClose: () => void }) {
  const type = (resource.type || 'link') as ResourceType;
  const meta = TYPE_META[type] || TYPE_META.link;
  const embedUrl = resource.video_url ? getEmbedUrl(resource.video_url) : null;
  const isImg = isImageFile(resource.file_name);

  const modalWidth = type === 'video' ? 900 : 720;

  async function forceDownload(url: string, fileName: string) {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <ModalShell onClose={onClose} width={modalWidth}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '20px 24px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11, flexShrink: 0,
            background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={meta.icon as never} size={18} style={{ color: meta.color }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {resource.title}
            </div>
            {resource.description && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>
                {resource.description}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, borderRadius: 6, lineHeight: 0, flexShrink: 0 }}
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
        {/* Vidéo */}
        {type === 'video' && (
          embedUrl ? (
            <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 10, overflow: 'hidden', background: '#000' }}>
              <iframe
                src={embedUrl}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>
              URL vidéo non reconnue (YouTube ou Vimeo uniquement).
            </div>
          )
        )}

        {/* Fichier */}
        {type === 'file' && resource.file_url && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {isImg ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', padding: 12 }}>
                <img
                  src={resource.file_url}
                  alt={resource.file_name || ''}
                  style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 6, display: 'block' }}
                />
              </div>
            ) : (
              <iframe
                src={resource.file_url}
                style={{ width: '100%', height: 460, border: '1px solid var(--border)', borderRadius: 10 }}
                title={resource.file_name || 'Fichier'}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{resource.file_name}</div>
                {resource.file_size && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{formatSize(resource.file_size)}</div>}
              </div>
              <a
                href={resource.file_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 13, fontWeight: 500, color: 'var(--accent)', textDecoration: 'none' }}
              >
                <Icon name="external" size={13} />
                Ouvrir
              </a>
              <button
                type="button"
                onClick={() => forceDownload(resource.file_url!, resource.file_name || 'fichier')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}
              >
                <Icon name="download" size={13} style={{ color: '#fff' }} />
                Télécharger
              </button>
            </div>
          </div>
        )}

        {/* Lien */}
        {type === 'link' && resource.url && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '32px 0' }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="link" size={28} style={{ color: meta.color }} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', wordBreak: 'break-all', textAlign: 'center' }}>{resource.url}</div>
            <a
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
            >
              <Icon name="external" size={14} style={{ color: '#fff' }} />
              Ouvrir le lien
            </a>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function ResourceCard({ resource, onOpen }: { resource: ResourceWithSeen; onOpen: (r: ResourceWithSeen) => void }) {
  const isNew = resource.seen_at === null;

  return (
    <motion.div
      variants={itemVariants}
      className="card dc-liftrow"
      style={{
        padding: 0, overflow: 'hidden',
        border: isNew ? '1.5px solid var(--green)' : '1px solid var(--border)',
        transition: 'border-color 300ms, box-shadow 150ms',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', height: '100%',
      }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onClick={() => onOpen(resource)}
    >
      {/* Miniature */}
      <ResourceThumbnail
        type={resource.type}
        videoUrl={resource.video_url}
        fileUrl={resource.file_url}
        fileName={resource.file_name}
        fileSize={resource.file_size}
        url={resource.url}
        height={140}
        videoDuration={resource.video_duration}
        thumbnailUrl={resource.thumbnail_url}
        pageCount={resource.page_count}
        resourceTitle={resource.title}
      />

      {/* Infos */}
      <div style={{ padding: '12px 14px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: resource.description ? 3 : 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {resource.title}
          </span>
          <AnimatePresence>
            {isNew && (
              <motion.span
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.7, opacity: 0 }}
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                  padding: '2px 6px', borderRadius: 20,
                  background: 'var(--green)', color: 'white',
                  flexShrink: 0, lineHeight: 1.4,
                }}
              >
                NOUVEAU
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {resource.description && (
          <div style={{
            fontSize: 12, color: 'var(--muted)', lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          } as React.CSSProperties}>
            {resource.description}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function SectionFolderCard({ section, count, subCount, unseen, onClick }: {
  section: ResourceSection;
  count: number;
  subCount: number;
  unseen: boolean;
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
        width: 40, height: 40, borderRadius: 11, flexShrink: 0, position: 'relative',
        background: 'rgba(58,106,134,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="folder" size={19} style={{ color: '#3a6a86' }} />
        {unseen && (
          <span style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: 'var(--green)', border: '2px solid var(--surface)' }} />
        )}
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

export default function PageClientResources() {
  const [resources, setResources] = useState<ResourceWithSeen[]>([]);
  const [sections, setSections] = useState<ResourceSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [previewResource, setPreviewResource] = useState<ResourceWithSeen | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [coachName, setCoachName] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const { data: clientRow } = await supabase
        .from('clients')
        .select('coach_id')
        .eq('profile_id', user.id)
        .single();

      if (!clientRow) { setLoading(false); return; }

      const { data: coachProfile } = await supabase
        .from('profiles').select('full_name').eq('id', clientRow.coach_id).maybeSingle();
      if (coachProfile?.full_name) setCoachName(coachProfile.full_name.split(' ')[0]);

      const { data: sectionsData } = await supabase
        .from('resource_sections')
        .select('*')
        .eq('coach_id', clientRow.coach_id)
        .order('position');
      setSections(sectionsData || []);

      const { data: accessData } = await supabase
        .from('resource_access')
        .select('resource_id, seen_at')
        .eq('client_id', user.id)
        .eq('unlocked', true);

      const unlockedIds = (accessData || []).map((a: { resource_id: string; seen_at: string | null }) => a.resource_id);
      const seenMap: Record<string, string | null> = {};
      for (const a of accessData || []) seenMap[a.resource_id] = a.seen_at;

      if (unlockedIds.length === 0) {
        setResources([]);
        setLoading(false);
        return;
      }

      const { data: resourcesData } = await supabase
        .from('resources')
        .select('*')
        .in('id', unlockedIds)
        .order('position');

      const merged: ResourceWithSeen[] = (resourcesData || []).map(r => ({
        ...r,
        seen_at: seenMap[r.id] ?? null,
      }));

      setResources(merged);
      setLoading(false);
    }
    load();
  }, []);

  const markSeen = useCallback(async (resourceId: string) => {
    if (!userId) return;
    const now = new Date().toISOString();
    // MAJ optimiste
    setResources(prev => prev.map(r => r.id === resourceId ? { ...r, seen_at: now } : r));
    const supabase = createClient();
    await supabase
      .from('resource_access')
      .update({ seen_at: now })
      .eq('resource_id', resourceId)
      .eq('client_id', userId);
  }, [userId]);

  function handleOpen(resource: ResourceWithSeen) {
    if (resource.seen_at === null) markSeen(resource.id);
    // Pour les liens directs, ouvrir sans modale
    if (resource.type === 'link' && resource.url) {
      window.open(resource.url, '_blank', 'noopener,noreferrer');
      return;
    }
    setPreviewResource(resource);
  }

  const drillDownChildren = (activeSectionId && sectionHasChildren(sections, activeSectionId))
    ? sections.filter(s => s.parent_id === activeSectionId)
    : [];

  const filtered = useMemo(() => {
    if (search) {
      const q = search.toLowerCase();
      return resources.filter(r => r.title.toLowerCase().includes(q)); // recherche = tout le catalogue
    }
    if (activeSectionId === null) return resources; // "Toutes les ressources" = tout, dossiers confondus
    return resources.filter(r => r.section_id === activeSectionId);
  }, [resources, search, activeSectionId]);

  const newCount = resources.filter(r => r.seen_at === null).length;
  const activeSection = activeSectionId ? sections.find(s => s.id === activeSectionId) : null;
  const activeParent = activeSection?.parent_id ? sections.find(s => s.id === activeSection.parent_id) : null;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <InlineLoader />
    </div>
  );

  return (
    <div className="page-content">
      {/* Barre de navigation dossiers — ☰ + fil d'ariane, en haut à gauche */}
      {sections.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            title="Mes dossiers"
            style={{
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '8px 9px', cursor: 'pointer',
              color: 'var(--ink)', display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            <Icon name="menu-lines" size={15} />
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
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Ressources</div>
          )}
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Ressources</h1>
          <p className="page-sub">
            {resources.length} ressource{resources.length !== 1 ? 's' : ''} disponible{resources.length !== 1 ? 's' : ''}
            {newCount > 0 && (
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                {' '}· {newCount} nouveau{newCount !== 1 ? 'x' : ''}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Barre de recherche */}
      {resources.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ position: 'relative', maxWidth: 280 }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              style={{
                width: '100%', paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      )}

      {/* Empty state */}
      {resources.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
          style={{ padding: '56px 24px', textAlign: 'center' }}
        >
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Icon name="folder" size={22} style={{ color: 'var(--muted)' }} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Aucune ressource</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            {coachName || 'Ton coach'} te débloquera des ressources au fur et à mesure de ta progression.
          </div>
        </motion.div>
      )}

      {/* No results */}
      {resources.length > 0 && drillDownChildren.length === 0 && filtered.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', paddingTop: 32 }}>
          {search ? 'Aucune ressource ne correspond à ta recherche.' : 'Ce dossier est vide.'}
        </div>
      )}

      {/* Cartes-dossier (drill-down) */}
      {drillDownChildren.length > 0 && (
        <motion.div
          className="resource-grid"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {drillDownChildren.map(fc => (
            <SectionFolderCard
              key={fc.id}
              section={fc}
              count={resources.filter(r => r.section_id === fc.id).length}
              subCount={sections.filter(s => s.parent_id === fc.id).length}
              unseen={resources.some(r => r.section_id === fc.id && r.seen_at === null)}
              onClick={() => setActiveSectionId(fc.id)}
            />
          ))}
        </motion.div>
      )}

      {/* Intertitre "Dans ce dossier" */}
      {drillDownChildren.length > 0 && filtered.length > 0 && (
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '18px 0 10px' }}>
          Dans ce dossier
        </div>
      )}

      {/* Grid ressources */}
      {filtered.length > 0 && (
        <motion.div
          className="resource-grid"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {filtered.map(r => (
            <ResourceCard key={r.id} resource={r} onOpen={handleOpen} />
          ))}
        </motion.div>
      )}

      {/* Modale aperçu */}
      <AnimatePresence>
        {previewResource && (
          <ResourcePreviewModal
            key={previewResource.id}
            resource={previewResource}
            onClose={() => setPreviewResource(null)}
          />
        )}
      </AnimatePresence>

      {/* Tiroir dossiers — lecture seule */}
      <AnimatePresence>
        {drawerOpen && (
          <DrawerShell onClose={() => setDrawerOpen(false)}>
            <ResourceSectionTree
              sections={sections}
              resources={resources}
              activeSectionId={activeSectionId}
              onSelect={setActiveSectionId}
              onClose={() => setDrawerOpen(false)}
              readOnly={true}
              showUnseenDot={true}
            />
          </DrawerShell>
        )}
      </AnimatePresence>
    </div>
  );
}
