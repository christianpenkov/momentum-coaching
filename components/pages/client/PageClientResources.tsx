'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon, { type IconName } from '@/components/ui/Icon';
import InlineLoader from '@/components/ui/InlineLoader';
import { createClient } from '@/lib/supabase/client';
import { formatSize, getEmbedUrl, TYPE_META } from '@/lib/resourceHelpers';

interface Resource {
  id: string;
  title: string;
  type: string | null;
  description: string | null;
  url: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  video_url: string | null;
  markdown_content: string | null;
  is_new: boolean;
  position: number;
  section_id: string | null;
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { ease: 'easeOut' as const, duration: 0.38 } },
};

function ResourceCard({ resource, onMarkSeen }: { resource: Resource; onMarkSeen: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const type = (resource.type || 'link') as keyof typeof TYPE_META;
  const meta = TYPE_META[type] || TYPE_META.link;
  const embedUrl = resource.video_url ? getEmbedUrl(resource.video_url) : null;
  const isExpandable = resource.type === 'video';

  function handleOpen() {
    if (resource.is_new) onMarkSeen(resource.id);
    if (resource.type === 'link' && resource.url) window.open(resource.url, '_blank', 'noopener,noreferrer');
    if (resource.type === 'file' && resource.file_url) window.open(resource.file_url, '_blank', 'noopener,noreferrer');
    if (isExpandable) setExpanded(e => !e);
  }

  return (
    <motion.div
      variants={itemVariants}
      className="card"
      style={{
        padding: 0, overflow: 'hidden',
        border: resource.is_new ? '1.5px solid var(--green)' : '1px solid var(--border)',
        transition: 'border-color 300ms, box-shadow 150ms',
      }}
      whileHover={{ y: -2, boxShadow: 'var(--shadow-elev)' }}
    >
      {/* Header cliquable */}
      <div
        onClick={handleOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}
      >
        {/* Icône */}
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: meta.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={meta.icon as IconName} size={17} style={{ color: meta.color }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: resource.description ? 2 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {resource.title}
            </span>
            <AnimatePresence>
              {resource.is_new && (
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
            <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {resource.description}
            </div>
          )}
          {resource.type === 'file' && resource.file_name && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
              {resource.file_name} · {formatSize(resource.file_size)}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, color: 'var(--muted)' }}>
          {isExpandable
            ? <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
            : <Icon name="external" size={14} />
          }
        </div>
      </div>

      {/* Expandable video */}
      <AnimatePresence>
        {expanded && resource.type === 'video' && embedUrl && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' as const }}
            style={{ overflow: 'hidden', borderTop: '1px solid var(--border)' }}
          >
            <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
              <iframe
                src={embedUrl}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function PageClientResources() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: clientRow } = await supabase
        .from('clients')
        .select('coach_id')
        .eq('profile_id', user.id)
        .single();

      if (!clientRow) { setLoading(false); return; }

      const { data: accessData } = await supabase
        .from('resource_access')
        .select('resource_id')
        .eq('client_id', user.id)
        .eq('unlocked', true);

      const unlockedIds = (accessData || []).map((a: { resource_id: string }) => a.resource_id);

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

      setResources(resourcesData || []);
      setLoading(false);
    }
    load();
  }, []);

  async function markSeen(resourceId: string) {
    setResources(prev => prev.map(r => r.id === resourceId ? { ...r, is_new: false } : r));
    const supabase = createClient();
    await supabase.from('resources').update({ is_new: false }).eq('id', resourceId);
  }

  const filtered = useMemo(() => {
    if (!search) return resources;
    const q = search.toLowerCase();
    return resources.filter(r => r.title.toLowerCase().includes(q));
  }, [resources, search]);

  const newCount = resources.filter(r => r.is_new).length;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <InlineLoader />
    </div>
  );

  return (
    <div className="page-content">
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
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
          }}>
            <Icon name="folder" size={22} style={{ color: 'var(--muted)' }} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Aucune ressource</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            Ton coach te débloquera des ressources au fur et à mesure de ta progression.
          </div>
        </motion.div>
      )}

      {/* No results */}
      {resources.length > 0 && filtered.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', paddingTop: 32 }}>
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
          {filtered.map(r => (
            <ResourceCard key={r.id} resource={r} onMarkSeen={markSeen} />
          ))}
        </motion.div>
      )}
    </div>
  );
}
