'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon, { type IconName } from '@/components/ui/Icon';
import { sectionHasUnseenResource } from '@/lib/resourceHelpers';
import type { Resource, ResourceSection } from '@/lib/resourceTypes';

interface Props {
  sections: ResourceSection[];
  resources: Resource[];
  activeSectionId: string | null;
  onSelect: (sectionId: string | null) => void;
  onClose: () => void;
  readOnly: boolean;
  showUnseenDot?: boolean;
  autoCreate?: boolean;
  onCreate?: (name: string, parentId: string | null) => Promise<void>;
  onRename?: (id: string, name: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

// Icône et couleur uniques pour tous les dossiers — pas de personnalisation.
const FOLDER_COLOR = '#3a6a86';

function InlineForm({ initialName, onSubmit, onCancel }: {
  initialName: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) { onCancel(); return; }
    onSubmit(trimmed);
  }

  return (
    <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name="folder" size={14} style={{ color: FOLDER_COLOR, flexShrink: 0 }} />
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => { if (!name.trim()) onCancel(); }}
        placeholder="Nom du dossier…"
        style={{
          flex: 1, minWidth: 0, padding: '7px 10px',
          border: '1px solid var(--accent)', borderRadius: 7,
          background: 'var(--bg)', fontSize: 13, color: 'var(--ink)',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
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
          className="btn-primary-brand"
          style={{ fontSize: 12, opacity: hasContent && !checked ? 0.5 : 1 }}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

function SectionMenu({ anchorRect, onClose, onRename, onCreateSub, onDelete, canCreateSub }: {
  anchorRect: DOMRect;
  onClose: () => void;
  onRename: () => void;
  onCreateSub?: () => void;
  onDelete: () => void;
  canCreateSub: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose]);

  const left = Math.min(anchorRect.left, window.innerWidth - 190);
  const top = anchorRect.bottom + 4;

  const items: { label: string; icon: IconName; danger?: boolean; onClick: () => void }[] = [
    { label: 'Renommer', icon: 'edit', onClick: () => { onRename(); onClose(); } },
    ...(canCreateSub ? [{ label: 'Nouvelle sous-section', icon: 'plus' as IconName, onClick: () => { onCreateSub?.(); onClose(); } }] : []),
    { label: 'Supprimer', icon: 'trash', danger: true, onClick: () => { onDelete(); onClose(); } },
  ];

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed', left, top, zIndex: 3000,
        minWidth: 178, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 11, boxShadow: 'var(--shadow-menu, 0 8px 28px rgba(0,0,0,.16))',
        overflow: 'hidden', fontSize: 13,
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          onClick={item.onClick}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', cursor: 'pointer',
            color: item.danger ? 'var(--red)' : 'var(--ink)',
            borderTop: i > 0 ? '1px solid var(--border)' : 'none',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <Icon name={item.icon} size={14} style={{ color: item.danger ? 'var(--red)' : 'var(--muted)' }} />
          {item.label}
        </div>
      ))}
    </div>,
    document.body
  );
}

function SectionRow({ section, count, active, readOnly, indent, hasChildren, isOpen, showUnseenDot, unseen, onSelect, onToggleOpen, onOpenMenu }: {
  section: ResourceSection;
  count: number;
  active: boolean;
  readOnly: boolean;
  indent: boolean;
  hasChildren: boolean;
  isOpen: boolean;
  showUnseenDot: boolean;
  unseen: boolean;
  onSelect: () => void;
  onToggleOpen: () => void;
  onOpenMenu: (rect: DOMRect) => void;
}) {
  const [hover, setHover] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '7px 8px', marginLeft: indent ? 18 : 0,
        borderRadius: 8, cursor: 'pointer',
        background: active ? 'var(--surface)' : 'transparent',
        border: active ? '1px solid var(--border)' : '1px solid transparent',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
      }}
      onClick={onSelect}
    >
      {!indent && (
        hasChildren ? (
          <span
            onClick={e => { e.stopPropagation(); onToggleOpen(); }}
            style={{ width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <Icon name="chevR" size={11} style={{ color: 'var(--muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }} />
          </span>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )
      )}
      {indent ? (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: FOLDER_COLOR, flexShrink: 0 }} />
      ) : (
        <Icon name="folder" size={14} style={{ color: active ? FOLDER_COLOR : 'var(--muted)', flexShrink: 0 }} />
      )}
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? 'var(--accent)' : 'var(--ink)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {section.name}
      </span>
      {showUnseenDot && unseen && (
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{count}</span>
      {!readOnly && (
        <button
          ref={menuBtnRef}
          type="button"
          onClick={e => { e.stopPropagation(); if (menuBtnRef.current) onOpenMenu(menuBtnRef.current.getBoundingClientRect()); }}
          title="Options"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)',
            padding: 3, borderRadius: 5, lineHeight: 0, flexShrink: 0,
            opacity: hover ? 1 : 0, transition: 'opacity 120ms',
          }}
        >
          <Icon name="ellipsis" size={14} />
        </button>
      )}
    </div>
  );
}

export default function ResourceSectionTree({
  sections, resources, activeSectionId, onSelect, onClose, readOnly, showUnseenDot, autoCreate,
  onCreate, onRename, onDelete,
}: Props) {
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(autoCreate ? null : undefined); // undefined = pas de création en cours, null = racine
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openRoots, setOpenRoots] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ sectionId: string; rect: DOMRect } | null>(null);

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
  const totalResourceCount = resources.filter(r => r.section_id !== null).length + resources.filter(r => r.section_id === null).length;

  return (
    <>
      <div style={{ padding: '15px 14px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono, inherit)' }}>
            {readOnly ? 'Mes dossiers' : 'Dossiers'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setCreatingUnder(null)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px',
                  borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)',
                  cursor: 'pointer', color: 'var(--accent-brand, var(--accent))', fontSize: 11, fontWeight: 600,
                }}
              >
                <Icon name="plus" size={13} /> Dossier
              </button>
            )}
            <button type="button" onClick={onClose} style={{ width: 24, height: 24, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)' }}>
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
        {/* Toutes les ressources */}
        <div
          onClick={() => select(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
            background: activeSectionId === null ? 'var(--surface)' : 'transparent',
            border: activeSectionId === null ? '1px solid var(--border)' : '1px solid transparent',
            boxShadow: activeSectionId === null ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
          }}
        >
          <Icon name="stack" size={14} style={{ color: activeSectionId === null ? 'var(--accent)' : 'var(--muted)' }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: activeSectionId === null ? 600 : 500, color: activeSectionId === null ? 'var(--accent)' : 'var(--ink)' }}>
            Toutes les ressources
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{totalResourceCount}</span>
        </div>

        {creatingUnder === null && (
          <InlineForm
            initialName=""
            onSubmit={async (name) => { await onCreate?.(name, null); setCreatingUnder(undefined); }}
            onCancel={() => setCreatingUnder(undefined)}
          />
        )}

        {!readOnly && sections.length === 0 && creatingUnder === undefined && (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 8px', lineHeight: 1.5 }}>
            Aucun dossier. Crée-en un avec + Dossier.
          </div>
        )}

        {visibleRoots.map(root => {
          const subs = childrenOf(root.id);
          const hasChildren = subs.length > 0;
          const isOpen = !!openRoots[root.id];
          return (
            <div key={root.id}>
              {renamingId === root.id ? (
                <InlineForm
                  initialName={root.name}
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
                  hasChildren={hasChildren}
                  isOpen={isOpen}
                  showUnseenDot={!!showUnseenDot}
                  unseen={sectionHasUnseenResource(root.id, sections, resources)}
                  onSelect={() => select(root.id)}
                  onToggleOpen={() => setOpenRoots(prev => ({ ...prev, [root.id]: !prev[root.id] }))}
                  onOpenMenu={rect => setMenu({ sectionId: root.id, rect })}
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
              {hasChildren && isOpen && subs.map(sub => (
                <div key={sub.id}>
                  {renamingId === sub.id ? (
                    <InlineForm
                      initialName={sub.name}
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
                      hasChildren={false}
                      isOpen={false}
                      showUnseenDot={!!showUnseenDot}
                      unseen={sectionHasUnseenResource(sub.id, sections, resources)}
                      onSelect={() => select(sub.id)}
                      onToggleOpen={() => {}}
                      onOpenMenu={rect => setMenu({ sectionId: sub.id, rect })}
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
                    onSubmit={async (name) => { await onCreate?.(name, root.id); setCreatingUnder(undefined); }}
                    onCancel={() => setCreatingUnder(undefined)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', flexShrink: 0, fontSize: 11, color: 'var(--muted)' }}>
          {resources.length} ressource{resources.length !== 1 ? 's' : ''} · {sections.length} dossier{sections.length !== 1 ? 's' : ''}
        </div>
      )}

      {menu && (() => {
        const menuSection = sections.find(s => s.id === menu.sectionId);
        if (!menuSection) return null;
        return (
          <SectionMenu
            anchorRect={menu.rect}
            onClose={() => setMenu(null)}
            onRename={() => setRenamingId(menu.sectionId)}
            onCreateSub={menuSection.parent_id === null ? () => setCreatingUnder(menu.sectionId) : undefined}
            canCreateSub={menuSection.parent_id === null}
            onDelete={() => setDeletingId(menu.sectionId)}
          />
        );
      })()}
    </>
  );
}
