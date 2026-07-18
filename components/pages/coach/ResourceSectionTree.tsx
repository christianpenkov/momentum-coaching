'use client';

import { useState, useRef, useEffect } from 'react';
import Icon, { type IconName } from '@/components/ui/Icon';
import { guessSectionIcon } from '@/lib/resourceHelpers';
import type { Resource, ResourceSection } from '@/lib/resourceTypes';

interface Props {
  sections: ResourceSection[];
  resources: Resource[];
  activeSectionId: string | null;
  onSelect: (sectionId: string | null) => void;
  onClose: () => void;
  readOnly: boolean;
  onCreate?: (name: string, parentId: string | null, icon: IconName) => Promise<void>;
  onRename?: (id: string, name: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

const ICON_CHOICES: IconName[] = ['folder', 'brain', 'zap', 'target', 'star', 'sparkle'];

function InlineForm({ initialName, initialIcon, onSubmit, onCancel }: {
  initialName: string;
  initialIcon: IconName;
  onSubmit: (name: string, icon: IconName) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<IconName>(initialIcon);
  const [iconTouched, setIconTouched] = useState(initialName.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function handleNameChange(v: string) {
    setName(v);
    if (!iconTouched) setIcon(guessSectionIcon(v));
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) { onCancel(); return; }
    onSubmit(trimmed, icon);
  }

  return (
    <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        ref={inputRef}
        value={name}
        onChange={e => handleNameChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => { if (!name.trim()) onCancel(); }}
        placeholder="Nom du dossier…"
        style={{
          width: '100%', padding: '7px 10px',
          border: '1px solid var(--accent)', borderRadius: 7,
          background: 'var(--bg)', fontSize: 13, color: 'var(--ink)',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 4 }}>
        {ICON_CHOICES.map(ic => (
          <button
            key={ic}
            type="button"
            onMouseDown={e => { e.preventDefault(); setIcon(ic); setIconTouched(true); }}
            style={{
              width: 26, height: 26, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: icon === ic ? 'var(--accent)' : 'var(--surface-2)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            <Icon name={ic} size={13} style={{ color: icon === ic ? '#fff' : 'var(--muted)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function DeleteConfirm({ section, childCount, resourceCount, destinationLabel, onConfirm, onCancel }: {
  section: ResourceSection;
  childCount: number;
  resourceCount: number;
  destinationLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const hasContent = childCount > 0 || resourceCount > 0;

  return (
    <div style={{
      padding: '12px 12px 10px', margin: '4px 8px',
      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>
        Supprimer « {section.name} » ?
      </div>
      {hasContent ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 10 }}>
          Ce dossier contient {resourceCount > 0 && <>{resourceCount} ressource{resourceCount !== 1 ? 's' : ''}</>}
          {resourceCount > 0 && childCount > 0 && ' et '}
          {childCount > 0 && <>{childCount} sous-dossier{childCount !== 1 ? 's' : ''}</>}.
          <br />
          Tout sera déplacé vers <b>{destinationLabel}</b>.
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          Ce dossier est vide.
        </div>
      )}
      {hasContent && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: 'var(--ink)', marginBottom: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
          J'ai compris, déplacer le contenu et supprimer le dossier.
        </label>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} className="btn-ghost" style={{ fontSize: 12 }}>Annuler</button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={hasContent && !checked}
          className="btn-primary"
          style={{ fontSize: 12, opacity: hasContent && !checked ? 0.5 : 1 }}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

function SectionRow({ section, count, active, readOnly, indent, onSelect, onStartRename, onStartDelete, onStartCreateSub }: {
  section: ResourceSection;
  count: number;
  active: boolean;
  readOnly: boolean;
  indent: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onStartDelete: () => void;
  onStartCreateSub?: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 8px', marginLeft: indent ? 18 : 0,
        borderRadius: 8, cursor: 'pointer',
        background: active ? 'var(--surface-2)' : 'transparent',
      }}
      onClick={onSelect}
    >
      <Icon name={(section.icon as IconName) || 'folder'} size={14} style={{ color: active ? 'var(--accent)' : 'var(--muted)', flexShrink: 0 }} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? 'var(--accent)' : 'var(--ink)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {section.name}
      </span>
      <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{count}</span>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 2, flexShrink: 0, opacity: hover ? 1 : 0, transition: 'opacity 120ms' }} onClick={e => e.stopPropagation()}>
          {!indent && onStartCreateSub && (
            <button type="button" onClick={onStartCreateSub} title="Nouveau sous-dossier" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 3, borderRadius: 5, lineHeight: 0 }}>
              <Icon name="plus" size={12} />
            </button>
          )}
          <button type="button" onClick={onStartRename} title="Renommer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 3, borderRadius: 5, lineHeight: 0 }}>
            <Icon name="edit" size={12} />
          </button>
          <button type="button" onClick={onStartDelete} title="Supprimer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 3, borderRadius: 5, lineHeight: 0 }}>
            <Icon name="trash" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function ResourceSectionTree({
  sections, resources, activeSectionId, onSelect, onClose, readOnly,
  onCreate, onRename, onDelete,
}: Props) {
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined); // undefined = pas de création en cours, null = racine
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const rootSections = sections.filter(s => s.parent_id === null);
  const visibleSections = readOnly
    ? sections.filter(s => resources.some(r => r.section_id === s.id) || sections.some(child => child.parent_id === s.id && resources.some(r => r.section_id === child.id)))
    : sections;
  const visibleRoots = rootSections.filter(s => visibleSections.includes(s));

  function countFor(sectionId: string) {
    return resources.filter(r => r.section_id === sectionId).length;
  }

  function childrenOf(sectionId: string) {
    return sections.filter(s => s.parent_id === sectionId).filter(s => visibleSections.includes(s));
  }

  function select(id: string | null) {
    onSelect(id);
    onClose();
  }

  const deletingSection = deletingId ? sections.find(s => s.id === deletingId) : null;

  return (
    <>
      <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>Dossiers</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, borderRadius: 6, lineHeight: 0 }}>
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
        {/* Toutes les ressources */}
        <div
          onClick={() => select(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
            background: activeSectionId === null ? 'var(--surface-2)' : 'transparent',
          }}
        >
          <Icon name="list" size={14} style={{ color: activeSectionId === null ? 'var(--accent)' : 'var(--muted)' }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: activeSectionId === null ? 600 : 500, color: activeSectionId === null ? 'var(--accent)' : 'var(--ink)' }}>
            Toutes les ressources
          </span>
        </div>

        {visibleRoots.map(root => {
          const subs = childrenOf(root.id);
          return (
            <div key={root.id}>
              {renamingId === root.id ? (
                <InlineForm
                  initialName={root.name}
                  initialIcon={(root.icon as IconName) || 'folder'}
                  onSubmit={async (name) => { await onRename?.(root.id, name); setRenamingId(null); }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <SectionRow
                  section={root}
                  count={countFor(root.id)}
                  active={activeSectionId === root.id}
                  readOnly={readOnly}
                  indent={false}
                  onSelect={() => select(root.id)}
                  onStartRename={() => setRenamingId(root.id)}
                  onStartDelete={() => setDeletingId(root.id)}
                  onStartCreateSub={() => setCreatingUnder(root.id)}
                />
              )}
              {deletingId === root.id && deletingSection && (
                <DeleteConfirm
                  section={deletingSection}
                  childCount={subs.length}
                  resourceCount={countFor(root.id)}
                  destinationLabel="Toutes les ressources"
                  onConfirm={async () => { await onDelete?.(root.id); setDeletingId(null); }}
                  onCancel={() => setDeletingId(null)}
                />
              )}
              {subs.map(sub => (
                <div key={sub.id}>
                  {renamingId === sub.id ? (
                    <InlineForm
                      initialName={sub.name}
                      initialIcon={(sub.icon as IconName) || 'folder'}
                      onSubmit={async (name) => { await onRename?.(sub.id, name); setRenamingId(null); }}
                      onCancel={() => setRenamingId(null)}
                    />
                  ) : (
                    <SectionRow
                      section={sub}
                      count={countFor(sub.id)}
                      active={activeSectionId === sub.id}
                      readOnly={readOnly}
                      indent={true}
                      onSelect={() => select(sub.id)}
                      onStartRename={() => setRenamingId(sub.id)}
                      onStartDelete={() => setDeletingId(sub.id)}
                    />
                  )}
                  {deletingId === sub.id && deletingSection && (
                    <DeleteConfirm
                      section={deletingSection}
                      childCount={0}
                      resourceCount={countFor(sub.id)}
                      destinationLabel={root.name}
                      onConfirm={async () => { await onDelete?.(sub.id); setDeletingId(null); }}
                      onCancel={() => setDeletingId(null)}
                    />
                  )}
                </div>
              ))}
              {creatingUnder === root.id && (
                <div style={{ marginLeft: 18 }}>
                  <InlineForm
                    initialName=""
                    initialIcon="folder"
                    onSubmit={async (name, icon) => { await onCreate?.(name, root.id, icon); setCreatingUnder(undefined); }}
                    onCancel={() => setCreatingUnder(undefined)}
                  />
                </div>
              )}
            </div>
          );
        })}

        {!readOnly && creatingUnder === null && (
          <InlineForm
            initialName=""
            initialIcon="folder"
            onSubmit={async (name, icon) => { await onCreate?.(name, null, icon); setCreatingUnder(undefined); }}
            onCancel={() => setCreatingUnder(undefined)}
          />
        )}
      </div>

      {!readOnly && creatingUnder === undefined && (
        <div style={{ padding: '10px 16px 16px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setCreatingUnder(null)}
            className="btn-ghost"
            style={{ fontSize: 13, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Icon name="plus" size={13} /> Nouveau dossier
          </button>
        </div>
      )}
    </>
  );
}
