'use client';

import { useState } from 'react';
import Icon, { type IconName } from '@/components/ui/Icon';
import { getVideoThumbnail, isImageFile, TYPE_META, type ResourceType } from '@/lib/resourceHelpers';

interface ResourceThumbnailProps {
  type: string | null;
  videoUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  url?: string | null;
  height?: number;
}

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export default function ResourceThumbnail({
  type,
  videoUrl,
  fileUrl,
  fileName,
  url,
  height = 160,
}: ResourceThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const [iframeError, setIframeError] = useState(false);

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

  const placeholderStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: meta.bg,
  };

  if (rtype === 'video' && videoUrl) {
    const thumb = getVideoThumbnail(videoUrl);
    return (
      <div style={containerStyle}>
        {thumb && !imgError ? (
          <img
            src={thumb}
            alt=""
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={placeholderStyle} />
        )}
        {/* Overlay play */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.25)',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(255,255,255,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.22)',
          }}>
            <Icon name="play" size={18} style={{ color: meta.color, marginLeft: 2 }} />
          </div>
        </div>
      </div>
    );
  }

  if (rtype === 'file' && fileUrl) {
    if (isImageFile(fileName || null)) {
      return (
        <div style={containerStyle}>
          <img
            src={fileUrl}
            alt={fileName || ''}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {imgError && (
            <div style={{ ...placeholderStyle, position: 'absolute', inset: 0 }}>
              <Icon name="folder" size={28} style={{ color: meta.color }} />
            </div>
          )}
        </div>
      );
    }

    // PDF / autre fichier — iframe avec fallback
    return (
      <div style={containerStyle}>
        {!iframeError ? (
          <iframe
            src={`${fileUrl}#page=1&toolbar=0&view=FitH`}
            style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none', display: 'block' }}
            onError={() => setIframeError(true)}
            title={fileName || 'Fichier'}
          />
        ) : (
          <div style={placeholderStyle}>
            <Icon name="folder" size={28} style={{ color: meta.color }} />
          </div>
        )}
        {/* Overlay transparent pour bloquer toute interaction */}
        <div style={{ position: 'absolute', inset: 0 }} />
      </div>
    );
  }

  if (rtype === 'link') {
    const domain = url ? getDomain(url) : null;
    return (
      <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'rgba(255,255,255,0.7)',
          border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          {domain && !imgError ? (
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              width={32}
              height={32}
              onError={() => setImgError(true)}
              style={{ display: 'block' }}
            />
          ) : (
            <Icon name={'link' as IconName} size={24} style={{ color: meta.color }} />
          )}
        </div>
      </div>
    );
  }

  // Fallback générique
  return (
    <div style={{ ...containerStyle, ...placeholderStyle }}>
      <Icon name={meta.icon as IconName} size={28} style={{ color: meta.color }} />
    </div>
  );
}
