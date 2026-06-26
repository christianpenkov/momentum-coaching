'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Icon, { type IconName } from '@/components/ui/Icon';
import { isImageFile, stripExtension, TYPE_META, type ResourceType } from '@/lib/resourceHelpers';

interface ResourceThumbnailProps {
  type: string | null;
  videoUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  url?: string | null;
  height?: number;
  showFileName?: boolean;
}

function getDomain(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

function getYtId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  return m ? m[1] : null;
}


// Proxy same-domain → zéro CORS/CSP
function YtThumbnail({ id, meta }: { id: string; meta: typeof TYPE_META.video }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div style={{ width: '100%', height: '100%', background: meta.bg }} />;
  }

  return (
    <img
      src={`/api/resources/yt-thumb?id=${id}`}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}

export default function ResourceThumbnail({
  type,
  videoUrl,
  fileUrl,
  fileName,
  fileSize,
  url,
  height = 160,
  showFileName = false,
}: ResourceThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);

  const rtype = (type || 'link') as ResourceType;
  const meta = TYPE_META[rtype] || TYPE_META.link;

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height,
    borderRadius: '10px 10px 0 0',
    overflow: 'hidden',
    position: 'relative',
    background: meta.bg,
    flexShrink: 0,
  };

  // ── VIDÉO ─────────────────────────────────────────────────────────
  if (rtype === 'video' && videoUrl) {
    const ytId = getYtId(videoUrl);
    return (
      <div style={containerStyle} className="resource-thumb-video">
        {ytId ? (
          <YtThumbnail id={ytId} meta={meta} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: meta.bg }} />
        )}
        {/* Overlay sombre + bouton play */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.28)',
        }}>
          <motion.div
            className="play-btn"
            whileHover={{ scale: 1.12 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            style={{
              width: 46, height: 46, borderRadius: '50%',
              background: 'rgba(255,255,255,0.93)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
            }}
          >
            <Icon name="play" size={18} style={{ color: meta.color, marginLeft: 3 }} />
          </motion.div>
        </div>
      </div>
    );
  }

  // ── FICHIER ───────────────────────────────────────────────────────
  if (rtype === 'file' && fileUrl) {
    // Image
    if (isImageFile(fileName || null)) {
      return (
        <div style={{ ...containerStyle, background: 'var(--surface-2)' }}>
          {!imgError ? (
            <img
              src={fileUrl}
              alt={fileName || ''}
              onError={() => setImgError(true)}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="folder" size={28} style={{ color: meta.color }} />
            </div>
          )}
        </div>
      );
    }

    // PDF / autre → placeholder card style (icône seule)
    const ext = (fileName?.split('.').pop() || 'FILE').toUpperCase().slice(0, 4);
    return (
      <div style={{
        ...containerStyle,
        background: 'rgba(181,128,37,0.06)',
        display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {/* Badge ext */}
        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.07em',
            padding: '3px 7px', borderRadius: 6,
            background: meta.color, color: '#fff',
          }}>
            {ext}
          </span>
        </div>
        {/* Icône centrée */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'rgba(255,255,255,0.7)',
            border: `1.5px solid rgba(181,128,37,0.2)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 10px rgba(181,128,37,0.12)',
          }}>
            <Icon name="folder" size={28} style={{ color: meta.color }} />
          </div>
          {showFileName && fileName && (
            <div style={{
              fontSize: 10, color: meta.color, fontWeight: 600, marginTop: 6,
              textAlign: 'center', padding: '0 10px',
              overflow: 'hidden', display: '-webkit-box',
              WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              lineHeight: 1.3, maxWidth: 120,
            } as React.CSSProperties}>
              {stripExtension(fileName)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── LIEN ──────────────────────────────────────────────────────────
  if (rtype === 'link') {
    const domain = url ? getDomain(url) : null;
    return (
      <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 58, height: 58, borderRadius: 16,
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
        }}>
          {domain && !faviconError ? (
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              width={32} height={32}
              onError={() => setFaviconError(true)}
              style={{ display: 'block' }}
            />
          ) : (
            <Icon name={'link' as IconName} size={24} style={{ color: meta.color }} />
          )}
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={meta.icon as IconName} size={28} style={{ color: meta.color }} />
    </div>
  );
}
