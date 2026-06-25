'use client';

import { useState, useEffect, useMemo } from 'react';
import Icon from '@/components/ui/Icon';
import InlineLoader from '@/components/ui/InlineLoader';
import { createClient } from '@/lib/supabase/client';

interface Section {
  id: string;
  title: string;
  position: number;
  locked: boolean;
}

interface Resource {
  id: string;
  section_id: string | null;
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
}

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function getEmbedUrl(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul]|<\/[hul]|<li|<\/li)(.+)$/gm, '<p>$1</p>');
}

const TYPE_ICON: Record<string, string> = {
  link: 'link',
  file: 'folder',
  video: 'play',
  markdown: 'list',
};

function ResourceCard({ resource, onMarkSeen }: { resource: Resource; onMarkSeen: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const embedUrl = resource.video_url ? getEmbedUrl(resource.video_url) : null;

  function handleOpen() {
    if (resource.is_new) onMarkSeen(resource.id);
    if (resource.type === 'link' && resource.url) window.open(resource.url, '_blank', 'noopener,noreferrer');
    if (resource.type === 'file' && resource.file_url) window.open(resource.file_url, '_blank', 'noopener,noreferrer');
    if (resource.type === 'markdown' || resource.type === 'video') setExpanded(e => !e);
  }

  return (
    <div
      className="card"
      style={{
        padding: 0, overflow: 'hidden',
        border: resource.is_new ? '1px solid var(--green)' : '1px solid var(--border)',
        transition: 'border-color 300ms',
      }}
    >
      {/* Card header */}
      <div
        onClick={handleOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon name={TYPE_ICON[resource.type || 'link'] || 'link'} size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: resource.description ? 2 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {resource.title}
            </span>
            {resource.is_new && (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                padding: '2px 6px', borderRadius: 20,
                background: 'var(--green)', color: 'white',
                flexShrink: 0,
              }}>
                NOUVEAU
              </span>
            )}
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
          {resource.type === 'markdown' || resource.type === 'video'
            ? <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
            : <Icon name="external" size={14} />
          }
        </div>
      </div>

      {/* Expandable content */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {resource.type === 'video' && embedUrl && (
            <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
              <iframe
                src={embedUrl}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
          {resource.type === 'markdown' && resource.markdown_content && (
            <div
              style={{ padding: '16px 20px', fontSize: 13, lineHeight: 1.7, color: 'var(--ink)' }}
              className="md-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(resource.markdown_content) }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function PageClientResources() {
  const [sections, setSections] = useState<Section[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSection, setFilterSection] = useState('all');

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

      const [sectionsRes, accessRes] = await Promise.all([
        supabase
          .from('resource_sections')
          .select('*')
          .eq('coach_id', clientRow.coach_id)
          .order('position'),
        supabase
          .from('resource_access')
          .select('resource_id')
          .eq('client_id', user.id)
          .eq('unlocked', true),
      ]);

      const unlockedIds = new Set((accessRes.data || []).map((a: any) => a.resource_id));

      if (unlockedIds.size === 0) {
        setSections(sectionsRes.data || []);
        setResources([]);
        setLoading(false);
        return;
      }

      const { data: resourcesData } = await supabase
        .from('resources')
        .select('*')
        .in('id', Array.from(unlockedIds))
        .order('position');

      setSections(sectionsRes.data || []);
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
    return resources.filter(r => {
      const matchSearch = !search || r.title.toLowerCase().includes(search.toLowerCase());
      const matchSection = filterSection === 'all' || r.section_id === filterSection || (filterSection === 'none' && !r.section_id);
      return matchSearch && matchSection;
    });
  }, [resources, search, filterSection]);

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
            {newCount > 0 && <span style={{ color: 'var(--green)', fontWeight: 700 }}> · {newCount} nouveau{newCount !== 1 ? 'x' : ''}</span>}
          </p>
        </div>
      </div>

      {/* Filters */}
      {resources.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              style={{ width: '100%', paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          {sections.length > 0 && (
            <select
              value={filterSection}
              onChange={e => setFilterSection(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', outline: 'none', cursor: 'pointer' }}
            >
              <option value="all">Toutes les sections</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              <option value="none">Sans section</option>
            </select>
          )}
        </div>
      )}

      {/* Empty state */}
      {resources.length === 0 && (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Aucune ressource pour le moment</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            Ton coach te débloquera des ressources au fur et à mesure de ta progression.
          </div>
        </div>
      )}

      {/* No results from filter */}
      {resources.length > 0 && filtered.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', paddingTop: 32 }}>
          Aucune ressource ne correspond à ta recherche.
        </div>
      )}

      {/* Sections with resources */}
      {filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* Resources grouped by section */}
          {sections.map(section => {
            const sectionResources = filtered.filter(r => r.section_id === section.id);
            if (sectionResources.length === 0) return null;
            return (
              <div key={section.id}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--muted)',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  marginBottom: 12,
                }}>
                  {section.title}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sectionResources.map(r => (
                    <ResourceCard key={r.id} resource={r} onMarkSeen={markSeen} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Resources without section */}
          {(() => {
            const nosection = filtered.filter(r => !r.section_id);
            if (nosection.length === 0) return null;
            return (
              <div>
                {sections.length > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                    Autres ressources
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {nosection.map(r => (
                    <ResourceCard key={r.id} resource={r} onMarkSeen={markSeen} />
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <style>{`
        .md-content h1 { font-size: 18px; font-weight: 700; margin: 0 0 10px; color: var(--accent); }
        .md-content h2 { font-size: 15px; font-weight: 700; margin: 16px 0 8px; color: var(--accent); }
        .md-content h3 { font-size: 13px; font-weight: 700; margin: 14px 0 6px; color: var(--accent); }
        .md-content p { margin: 0 0 10px; }
        .md-content ul { margin: 0 0 10px; padding-left: 20px; }
        .md-content li { margin-bottom: 4px; }
        .md-content strong { font-weight: 700; }
        .md-content em { font-style: italic; }
        .md-content a { color: var(--accent); text-decoration: underline; }
      `}</style>
    </div>
  );
}
