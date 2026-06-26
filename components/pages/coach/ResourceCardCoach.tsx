'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import type { Resource } from './ResourceModal';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';
import ResourceThumbnail from './ResourceThumbnail';

interface Props {
  resource: Resource;
  accessClients: ClientWithMetrics[];
  onEdit: (r: Resource) => void;
  onDelete: (r: Resource) => void;
  onManageAccess: (r: Resource) => void;
  onOpen: (r: Resource) => void;
}

const AVATAR_COLORS = [
  '#2563eb', '#7c3aed', '#db2777', '#d97706', '#059669', '#0891b2',
];

function avatarColor(idx: number) { return AVATAR_COLORS[idx % AVATAR_COLORS.length]; }

export default function ResourceCardCoach({ resource, accessClients, onEdit, onDelete, onManageAccess, onOpen }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const MAX_AVATARS = 4;
  const shownClients = accessClients.slice(0, MAX_AVATARS);
  const extraCount = accessClients.length - shownClients.length;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  return (
    <motion.div
      className="card"
      whileHover={{ y: -2, boxShadow: 'var(--shadow-elev)' }}
      transition={{ duration: 0.15 }}
      style={{ padding: 0, overflow: 'hidden', cursor: 'default' }}
    >
      {/* Miniature — cliquable pour ouvrir l'aperçu */}
      <div onClick={() => onOpen(resource)} style={{ cursor: 'pointer' }}>
        <ResourceThumbnail
          type={resource.type}
          videoUrl={resource.video_url}
          fileUrl={resource.file_url}
          fileName={resource.file_name}
          url={resource.url}
          height={148}
        />
      </div>

      {/* Top — info titre/description + menu */}
      <div
        onClick={() => onOpen(resource)}
        style={{ padding: '12px 16px 10px', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Titre */}
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--accent)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginBottom: resource.description ? 3 : 0,
            }}>
              {resource.title}
            </div>

            {/* Description */}
            {resource.description && (
              <div style={{
                fontSize: 12, color: 'var(--muted)', lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {resource.description}
              </div>
            )}
          </div>

          {/* Menu ⋯ — stopPropagation pour ne pas déclencher onOpen */}
          <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', padding: '4px 6px', borderRadius: 6,
                lineHeight: 0,
              }}
            >
              <Icon name="ellipsis" size={16} />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.1 }}
                  style={{
                    position: 'absolute', right: 0, top: 30, zIndex: 100,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    minWidth: 140, overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onEdit(resource); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '9px 14px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 13, color: 'var(--accent)', textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <Icon name="edit" size={13} style={{ color: 'var(--muted)' }} />
                    Modifier
                  </button>
                  <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onDelete(resource); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '9px 14px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 13, color: 'var(--red)', textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(205,91,63,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <Icon name="trash" size={13} style={{ color: 'var(--red)' }} />
                    Supprimer
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px 12px',
          borderTop: '1px solid var(--border)',
        }}
      >
        {/* Avatars empilés */}
        <button
          type="button"
          onClick={() => onManageAccess(resource)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          {accessClients.length === 0 ? (
            <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="lock" size={11} />
              Aucun accès
            </span>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {shownClients.map((c, i) => (
                  <div
                    key={c.id}
                    title={c.name}
                    style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: avatarColor(i),
                      border: '2px solid var(--surface)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: '#fff',
                      marginLeft: i === 0 ? 0 : -7,
                      position: 'relative', zIndex: shownClients.length - i,
                    }}
                  >
                    {(c.initials || c.name.slice(0, 2)).toUpperCase()}
                  </div>
                ))}
                {extraCount > 0 && (
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'var(--surface-2)',
                    border: '2px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 700, color: 'var(--muted)',
                    marginLeft: -7,
                  }}>
                    +{extraCount}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {accessClients.length} élève{accessClients.length !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </button>

        {/* Gérer accès */}
        <button
          type="button"
          onClick={() => onManageAccess(resource)}
          style={{
            fontSize: 11, color: 'var(--muted)',
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 6, padding: '4px 9px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)'; }}
        >
          <Icon name="users" size={11} />
          Gérer l'accès
        </button>
      </div>
    </motion.div>
  );
}
