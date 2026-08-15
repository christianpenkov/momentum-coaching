'use client';

import { useState, useRef, useEffect } from 'react';
import Icon from '@/components/ui/Icon';

interface Props {
  shareUrl: string | null;
  summary: string | null;
  actionItems: unknown;
  transcript: string | null;
}

// Fenêtre de grâce pour détecter un refus d'embed — filet de sécurité résiduel,
// gardé au cas où Fathom changerait sa politique CSP un jour. En pratique
// fathom.video/share/{id} refuse l'embed cross-origin (X-Frame-Options: SAMEORIGIN,
// confirmé par test réel) mais fathom.video/embed/{id} — même identifiant, endpoint
// dédié à l'embed — l'autorise explicitement (aucun X-Frame-Options/frame-ancestors,
// confirmé par test réel). On dérive donc toujours l'URL d'embed depuis share_url.
const IFRAME_LOAD_TIMEOUT_MS = 4000;

function toEmbedUrl(shareUrl: string): string {
  return shareUrl.replace('/share/', '/embed/');
}

function parseActionItems(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(item => (typeof item === 'string' ? item : (item as any)?.description || (item as any)?.text || JSON.stringify(item)));
  }
  return [];
}

export default function FathomRecordingSection({ shareUrl, summary, actionItems, transcript }: Props) {
  const [embedFailed, setEmbedFailed] = useState(false);
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!shareUrl) return;
    timeoutRef.current = setTimeout(() => {
      if (!embedLoaded) setEmbedFailed(true);
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [shareUrl, embedLoaded]);

  const items = parseActionItems(actionItems);

  if (!shareUrl && !summary && !items.length && !transcript) return null;

  return (
    <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
      {shareUrl && (
        <div style={{ marginBottom: 16 }}>
          {!embedFailed ? (
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)' }}>
              <iframe
                src={toEmbedUrl(shareUrl)}
                title="Enregistrement de l'appel"
                allow="fullscreen"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 'none' }}
                onLoad={() => { setEmbedLoaded(true); if (timeoutRef.current) clearTimeout(timeoutRef.current); }}
              />
            </div>
          ) : (
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary-brand"
              style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Icon name="video" size={15} /> Voir l'enregistrement
            </a>
          )}
        </div>
      )}

      {summary && (
        <div style={{ marginBottom: items.length ? 14 : 0 }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Résumé Fathom</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{summary}</div>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Points d'action</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.7 }}>
            {items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {transcript && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => setShowTranscript(v => !v)}
          >
            {showTranscript ? 'Masquer la transcription' : 'Voir la transcription complète'}
          </button>
          {showTranscript && (
            <div style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto', padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {transcript}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
