'use client';

import { useState } from 'react';

// Page de debug TEMPORAIRE — isole le player vidéo hors de tout modal (pas de
// framer-motion, pas de React portal, pas de position:fixed/overlay, pas
// d'animation) pour trancher si le crash "flash/reload" au 1er chargement après
// cold start vient de la charge du player Fathom lui-même, d'un paramètre
// d'URL spécifique, ou du contexte applicatif (modal/CSS/cycle de vie). Chaque
// variante est testée manuellement : fermer complètement Safari/l'app, rouvrir,
// venir ici, cliquer UNE SEULE variante, noter si ça crash ou pas, recommencer
// pour la variante suivante en refermant l'app entre chaque essai. À retirer
// une fois la cause confirmée.

const VARIANTS: { label: string; url: string }[] = [
  { label: 'A. example.com (contrôle, déjà testé OK)', url: 'https://example.com' },
  { label: 'B. YouTube embed (contrôle)', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ?controls=1' },
  { label: 'C. Fathom sans paramètres', url: 'https://fathom.video/embed/e79x-Sm1_KKeFxkZRPDh_DPszyCweqMs' },
  { label: 'D. Fathom autoplay=0', url: 'https://fathom.video/embed/e79x-Sm1_KKeFxkZRPDh_DPszyCweqMs?autoplay=0' },
  { label: 'E. Fathom autoplay=0&preload=none (actuel)', url: 'https://fathom.video/embed/e79x-Sm1_KKeFxkZRPDh_DPszyCweqMs?autoplay=0&preload=none' },
  { label: 'F. Fathom /share/ au lieu de /embed/ (test)', url: 'https://fathom.video/share/e79x-Sm1_KKeFxkZRPDh_DPszyCweqMs' },
];

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
  const [activeUrl, setActiveUrl] = useState<string | null>(null);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 16, marginBottom: 8 }}>Test isolement vidéo (sans modal)</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        Ferme complètement l'app, rouvre-la, viens direct ici, clique UNE seule
        variante, note si ça crash ou pas. Referme et rouvre l'app avant de
        tester la variante suivante — ne pas enchaîner plusieurs clics dans la
        même session, le 2e essai marche toujours et fausserait le test.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {VARIANTS.map(v => (
          <button
            key={v.url}
            type="button"
            onClick={() => {
              logClient('variant_clicked', { label: v.label, url: v.url, msSincePageLoad: Date.now() - performance.timeOrigin });
              setActiveUrl(v.url);
            }}
            disabled={activeUrl === v.url}
            style={{ padding: '10px 14px', fontSize: 13, textAlign: 'left', border: '1px solid #ccc', borderRadius: 8, background: activeUrl === v.url ? '#eee' : '#fff' }}
          >
            {v.label}
          </button>
        ))}
      </div>
      {activeUrl && (
        <iframe
          src={activeUrl}
          title="Test isolement"
          allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          style={{ display: 'block', width: '100%', height: 400, border: '1px solid #ccc' }}
          onLoad={() => logClient('iframe_onload', { url: activeUrl, msSincePageLoad: Date.now() - performance.timeOrigin })}
        />
      )}
    </div>
  );
}
