'use client';

import { useState, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import ResourceDrawer, { type Resource } from './ResourceDrawer';

interface Section {
  id: string;
  title: string;
  position: number;
  locked: boolean;
}

interface AccessCount {
  resource_id: string;
  count: number;
}

export default function PageResources() {
  const { clients } = useSupabaseClients();
  const supabase = createClient();

  const [sections, setSections] = useState<Section[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [accessCounts, setAccessCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [search, setSearch] = useState('');

  // Editing section title inline
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionTitle, setEditingSectionTitle] = useState('');

  // Adding new resource
  const [addingToSection, setAddingToSection] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [addingSaving, setAddingSaving] = useState(false);

  // Adding new section
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [addingSectionSaving, setAddingSectionSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [sectionsRes, resourcesRes, accessRes] = await Promise.all([
      supabase.from('resource_sections').select('*').eq('coach_id', user.id).order('position'),
      supabase.from('resources').select('*').eq('coach_id', user.id).order('position'),
      supabase.from('resource_access').select('resource_id').eq('unlocked', true),
    ]);

    setSections(sectionsRes.data || []);
    setResources(resourcesRes.data || []);

    const counts: Record<string, number> = {};
    for (const row of accessRes.data || []) {
      counts[row.resource_id] = (counts[row.resource_id] || 0) + 1;
    }
    setAccessCounts(counts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addSection() {
    if (!newSectionTitle.trim()) return;
    setAddingSectionSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setAddingSectionSaving(false); return; }
    await supabase.from('resource_sections').insert({
      coach_id: user.id,
      title: newSectionTitle.trim(),
      position: sections.length,
    });
    setNewSectionTitle('');
    setAddingSection(false);
    setAddingSectionSaving(false);
    load();
  }

  async function saveSectionTitle(id: string) {
    if (!editingSectionTitle.trim()) { setEditingSectionId(null); return; }
    await supabase.from('resource_sections').update({ title: editingSectionTitle.trim() }).eq('id', id);
    setSections(prev => prev.map(s => s.id === id ? { ...s, title: editingSectionTitle.trim() } : s));
    setEditingSectionId(null);
  }

  async function toggleSectionLock(section: Section) {
    await supabase.from('resource_sections').update({ locked: !section.locked }).eq('id', section.id);
    setSections(prev => prev.map(s => s.id === section.id ? { ...s, locked: !s.locked } : s));
  }

  async function deleteSection(id: string) {
    if (!confirm('Supprimer cette section ? Les ressources qu\'elle contient ne seront pas supprimées.')) return;
    await supabase.from('resource_sections').delete().eq('id', id);
    setSections(prev => prev.filter(s => s.id !== id));
  }

  async function addResource(sectionId: string) {
    if (!newTitle.trim()) return;
    setAddingSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setAddingSaving(false); return; }
    const sectionResources = resources.filter(r => r.section_id === sectionId);
    const { data } = await supabase.from('resources').insert({
      coach_id: user.id,
      section_id: sectionId,
      title: newTitle.trim(),
      type: 'link',
      position: sectionResources.length,
      locked: true,
    }).select().single();
    setNewTitle('');
    setAddingToSection(null);
    setAddingSaving(false);
    if (data) {
      setResources(prev => [...prev, data]);
      setSelectedResource(data);
    }
  }

  async function deleteResource(id: string) {
    if (!confirm('Supprimer cette ressource ?')) return;
    await supabase.from('resources').delete().eq('id', id);
    setResources(prev => prev.filter(r => r.id !== id));
    if (selectedResource?.id === id) setSelectedResource(null);
  }

  // Resources without section
  const unsectioned = resources.filter(r => !r.section_id && (
    !search || r.title.toLowerCase().includes(search.toLowerCase())
  ));

  function filterResources(sectionId: string) {
    return resources.filter(r => r.section_id === sectionId && (
      !search || r.title.toLowerCase().includes(search.toLowerCase())
    ));
  }

  const TYPE_ICON: Record<string, string> = {
    link: 'link',
    file: 'folder',
    video: 'play',
    markdown: 'list',
  };

  if (loading) return (
    <div className="page-content">
      <div className="page-header"><h1 className="page-title">Ressources</h1></div>
      <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>Chargement…</div>
    </div>
  );

  return (
    <div className="page-content" style={{ position: 'relative' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Ressources</h1>
          <p className="page-sub">{resources.length} ressource{resources.length !== 1 ? 's' : ''} · {sections.length} section{sections.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              style={{ paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink)', outline: 'none', width: 180 }}
            />
          </div>
          <button
            type="button" className="btn-primary"
            onClick={() => { setAddingSection(true); setNewSectionTitle(''); }}
            style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="plus" size={14} /> Ajouter une section
          </button>
        </div>
      </div>

      {/* New section input */}
      {addingSection && (
        <div className="card" style={{ padding: '14px 16px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            autoFocus
            value={newSectionTitle}
            onChange={e => setNewSectionTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addSection(); if (e.key === 'Escape') setAddingSection(false); }}
            placeholder="Nom de la section…"
            style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', outline: 'none' }}
          />
          <button type="button" className="btn-primary" onClick={addSection} disabled={addingSectionSaving || !newSectionTitle.trim()} style={{ fontSize: 13 }}>
            {addingSectionSaving ? '…' : 'Créer'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setAddingSection(false)} style={{ fontSize: 13 }}>Annuler</button>
        </div>
      )}

      {/* Empty state */}
      {sections.length === 0 && resources.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Aucune ressource</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
            Crée une section pour organiser tes ressources, puis ajoute du contenu à débloquer pour tes élèves.
          </div>
          <button type="button" className="btn-primary" onClick={() => { setAddingSection(true); setNewSectionTitle(''); }} style={{ fontSize: 13 }}>
            <Icon name="plus" size={13} /> Créer ma première section
          </button>
        </div>
      )}

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sections.map(section => {
          const sectionResources = filterResources(section.id);
          const isEditingTitle = editingSectionId === section.id;

          return (
            <div key={section.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Section header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 16px',
                background: section.locked ? 'rgba(var(--red-rgb,239,68,68),0.04)' : 'var(--surface-2)',
                borderBottom: '1px solid var(--border)',
              }}>
                {isEditingTitle ? (
                  <input
                    autoFocus
                    value={editingSectionTitle}
                    onChange={e => setEditingSectionTitle(e.target.value)}
                    onBlur={() => saveSectionTitle(section.id)}
                    onKeyDown={e => { if (e.key === 'Enter') saveSectionTitle(section.id); if (e.key === 'Escape') setEditingSectionId(null); }}
                    style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 6, padding: '4px 8px', fontSize: 13, fontWeight: 700, color: 'var(--accent)', outline: 'none' }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setEditingSectionId(section.id); setEditingSectionTitle(section.title); }}
                    style={{ flex: 1, background: 'none', border: 'none', cursor: 'text', textAlign: 'left', fontSize: 13, fontWeight: 700, color: 'var(--accent)', padding: 0 }}
                  >
                    {section.title}
                  </button>
                )}
                <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                  {sectionResources.length} ressource{sectionResources.length !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => toggleSectionLock(section)}
                  title={section.locked ? 'Section verrouillée pour tous — cliquer pour déverrouiller' : 'Section déverrouillée (accès individuel) — cliquer pour verrouiller pour tous'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: section.locked ? 'var(--red)' : 'var(--muted)', padding: 4 }}
                >
                  <Icon name={section.locked ? 'lock' : 'unlock'} size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => deleteSection(section.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}
                  title="Supprimer la section"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>

              {/* Resources list */}
              <div style={{ padding: '8px 0' }}>
                {sectionResources.length === 0 && !search && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 16px' }}>Aucune ressource dans cette section.</div>
                )}
                {sectionResources.map(r => {
                  const count = accessCounts[r.id] || 0;
                  const isSelected = selectedResource?.id === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedResource(isSelected ? null : r)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '9px 16px',
                        cursor: 'pointer',
                        background: isSelected ? 'var(--surface-2)' : 'transparent',
                        borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                        transition: 'background 120ms',
                      }}
                    >
                      <div style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <Icon name={TYPE_ICON[r.type || 'link'] || 'link'} size={13} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title}
                        </div>
                        {r.description && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</div>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: count > 0 ? 'var(--green)' : 'var(--muted)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
                        {count > 0 && <Icon name="check" size={11} />}
                        {count} élève{count !== 1 ? 's' : ''}
                      </div>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); deleteResource(r.id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, flexShrink: 0, opacity: 0.5 }}
                        title="Supprimer"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  );
                })}

                {/* Add resource to section */}
                {addingToSection === section.id ? (
                  <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
                    <input
                      autoFocus
                      value={newTitle}
                      onChange={e => setNewTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addResource(section.id); if (e.key === 'Escape') { setAddingToSection(null); setNewTitle(''); } }}
                      placeholder="Titre de la ressource…"
                      style={{ flex: 1, padding: '7px 11px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', outline: 'none' }}
                    />
                    <button type="button" className="btn-primary" onClick={() => addResource(section.id)} disabled={addingSaving || !newTitle.trim()} style={{ fontSize: 12 }}>
                      {addingSaving ? '…' : 'Ajouter'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => { setAddingToSection(null); setNewTitle(''); }} style={{ fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setAddingToSection(section.id); setNewTitle(''); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      margin: '4px 16px 8px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: 'var(--muted)', padding: '4px 0',
                    }}
                  >
                    <Icon name="plus" size={12} /> Ajouter une ressource
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Unsectioned resources */}
        {unsectioned.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.06em' }}>
              SANS SECTION
            </div>
            <div style={{ padding: '8px 0' }}>
              {unsectioned.map(r => {
                const count = accessCounts[r.id] || 0;
                const isSelected = selectedResource?.id === r.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedResource(isSelected ? null : r)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '9px 16px', cursor: 'pointer',
                      background: isSelected ? 'var(--surface-2)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                    }}
                  >
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name={TYPE_ICON[r.type || 'link'] || 'link'} size={13} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                    </div>
                    <div style={{ fontSize: 11, color: count > 0 ? 'var(--green)' : 'var(--muted)', flexShrink: 0 }}>
                      {count > 0 && <Icon name="check" size={11} />} {count} élève{count !== 1 ? 's' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Drawer */}
      <ResourceDrawer
        resource={selectedResource}
        onClose={() => setSelectedResource(null)}
        onSaved={() => { load(); setSelectedResource(null); }}
      />
    </div>
  );
}
