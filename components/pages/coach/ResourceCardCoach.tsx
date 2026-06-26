'use client';

import { motion } from 'framer-motion';
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
  const MAX_AVATARS = 4;
  const shownClients = accessClients.slice(0, MAX_AVATARS);
  const extraCount = accessClients.length - shownClients.length;

  return (
    <motion.div
      className="card"
      whileHover={{ y: -3, scale: 1.01, boxShadow: 'var(--shadow-elev)' }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={{ padding: 0, overflow: 'visible', cursor: 'default', display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Miniature — overflow:hidden ici seulement */}
      <div onClick={() => onOpen(resource)} style={{ cursor: 'pointer', overflow: 'hidden', borderRadius: '10px 10px 0 0' }}>
        <ResourceThumbnail
          type={resource.type}
          videoUrl={resource.video_url}
          fileUrl={resource.file_url}
          fileName={resource.file_name}
          fileSize={resource.file_size}
          url={resource.url}
          height={148}
          showFileName={true}
          resourceTitle={resource.title}
        />
      </div>

      {/* Titre + description + boutons actions */}
      <div
        onClick={() => onOpen(resource)}
        style={{ padding: '12px 16px 10px', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--accent)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginBottom: resource.description ? 3 : 0,
            }}>
              {resource.title}
            </div>

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

          {/* Boutons edit + delete inline */}
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onEdit(resource)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px 5px', borderRadius: 6, lineHeight: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
            >
              <Icon name="edit" size={14} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(resource)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px 5px', borderRadius: 6, lineHeight: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
            >
              <Icon name="trash" size={14} />
            </button>
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
          marginTop: 'auto',
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
            <span style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
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
              <span style={{ fontSize: 11, color: 'var(--accent)' }}>
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
            fontSize: 11, color: 'var(--accent)',
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 6, padding: '4px 9px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          <Icon name="users" size={11} />
          Gérer l'accès
        </button>
      </div>
    </motion.div>
  );
}
