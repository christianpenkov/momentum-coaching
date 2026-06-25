'use client';

import { AnimatePresence } from 'framer-motion';
import Icon, { type IconName } from '@/components/ui/Icon';
import ModalShell from '@/components/ui/ModalShell';
import { getEmbedUrl, formatSize, TYPE_META } from '@/lib/resourceHelpers';
import type { Resource } from './ResourceModal';

interface Props {
  resource: Resource;
  onClose: () => void;
  onEdit: (r: Resource) => void;
}

export default function ResourcePreviewModal({ resource, onClose, onEdit }: Props) {
  const type = (resource.type || 'link') as keyof typeof TYPE_META;
  const meta = TYPE_META[type] || TYPE_META.link;
  const embedUrl = resource.video_url ? getEmbedUrl(resource.video_url) : null;

  const isImage = resource.file_name
    ? /\.(png|jpe?g|gif|webp|svg)$/i.test(resource.file_name)
    : false;

  return (
    <ModalShell onClose={onClose} width={680}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '20px 24px 18px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: meta.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={meta.icon as IconName} size={20} style={{ color: meta.color }} />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 12 }}>
          <button
            type="button"
            onClick={() => { onClose(); onEdit(resource); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '6px 12px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface-2)',
              fontSize: 12, color: 'var(--accent)', cursor: 'pointer',
            }}
          >
            <Icon name="edit" size={12} />
            Modifier
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, borderRadius: 6, lineHeight: 0 }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
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

        {type === 'file' && resource.file_url && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {isImage ? (
              <img
                src={resource.file_url}
                alt={resource.file_name || ''}
                style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--border)' }}
              />
            ) : (
              <iframe
                src={resource.file_url}
                style={{ width: '100%', height: 420, border: '1px solid var(--border)', borderRadius: 10 }}
                title={resource.file_name || 'Fichier'}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{resource.file_name}</div>
                {resource.file_size && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{formatSize(resource.file_size)}</div>
                )}
              </div>
              <a
                href={resource.file_url}
                target="_blank"
                rel="noopener noreferrer"
                download={resource.file_name || true}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 8,
                  background: 'var(--accent)', color: '#fff',
                  fontSize: 13, fontWeight: 600, textDecoration: 'none',
                }}
              >
                <Icon name="download" size={13} style={{ color: '#fff' }} />
                Télécharger
              </a>
            </div>
          </div>
        )}

        {type === 'link' && resource.url && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '32px 0' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: meta.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="link" size={28} style={{ color: meta.color }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4, wordBreak: 'break-all' }}>
                {resource.url}
              </div>
            </div>
            <a
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 24px', borderRadius: 10,
                background: 'var(--accent)', color: '#fff',
                fontSize: 13, fontWeight: 600, textDecoration: 'none',
              }}
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
