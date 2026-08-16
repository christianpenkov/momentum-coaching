'use client';

import { useEffect } from 'react';

// Page de debug TEMPORAIRE — isole le player Fathom hors de tout modal (pas de
// framer-motion, pas de React portal, pas de position:fixed/overlay) pour trancher
// si le crash "flash/reload" au 1er chargement après cold start vient uniquement
// de la charge du player Fathom lui-même, ou si le contexte du modal (transform,
// portal, cycle de vie) y contribue aussi. À retirer une fois la cause confirmée.

const EMBED_URL = 'https://fathom.video/embed/e79x-Sm1_KKeFxkZRPDh_DPszyCweqMs?autoplay=0&preload=none';

function logClient(message: string, data: Record<string, unknown> = {}) {
  try {
    fetch('/api/client-log', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `[FathomDebugPage] ${message}`,
        data: { ...data, ua: typeof navigator !== 'undefined' ? navigator.userAgent : null, ts: Date.now() },
      }),
    }).catch(() => {});
  } catch {}
}

export default function FathomDebugPage() {
  useEffect(() => {
    logClient('mount', { msSincePageLoad: Date.now() - performance.timeOrigin, pageLoadedAt: new Date(performance.timeOrigin).toISOString() });
    return () => logClient('unmount', {});
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 16, marginBottom: 12 }}>Test Fathom direct (sans modal)</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        Ferme complètement l'app, rouvre-la, viens direct ici, l'iframe charge
        automatiquement au montage de la page (pas de clic requis).
      </p>
      <iframe
        src={EMBED_URL}
        title="Fathom debug"
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={{ display: 'block', width: '100%', height: 400, border: '1px solid #ccc' }}
        onLoad={() => logClient('iframe_onload', { msSincePageLoad: Date.now() - performance.timeOrigin })}
      />
    </div>
  );
}
