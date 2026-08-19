'use client';

import { useEffect, useState } from 'react';

/**
 * Page de diagnostic du raccord splash système -> overlay.
 *
 * Il n'y a pas de console accessible en PWA installée sur iPhone : cette page
 * remplace le localStorage.setItem() qu'on ferait au clavier sur desktop, et
 * affiche les mesures à l'écran en plus de les écrire en base.
 *
 * Temporaire — à supprimer une fois la géométrie du splash comprise.
 */

const KEY = 'splash-debug';

type Probe = Record<string, unknown>;

function readProbe(): Probe {
  const cs = getComputedStyle(document.documentElement);
  const el = document.getElementById('app-splash');
  const img = el?.querySelector('img');
  const r = img?.getBoundingClientRect();
  return {
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    innerHeight: window.innerHeight,
    outerHeight: window.outerHeight,
    'screen.height': window.screen.height,
    'screen.availHeight': window.screen.availHeight,
    devicePixelRatio: window.devicePixelRatio,
    'safe-area-inset-top': cs.getPropertyValue('--probe-safe-top').trim() || '(non défini)',
    'visualViewport.height': window.visualViewport ? Math.round(window.visualViewport.height) : null,
    'visualViewport.offsetTop': window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
    'logo.top': r ? Math.round(r.top) : '(splash déjà retiré)',
    'logo.centerY': r ? Math.round(r.top + r.height / 2) : '(splash déjà retiré)',
    userAgent: navigator.userAgent,
  };
}

export default function DebugSplashPage() {
  const [enabled, setEnabled] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(localStorage.getItem(KEY) === '1');
    setProbe(readProbe());
  }, []);

  function toggle() {
    const next = !enabled;
    if (next) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
    setEnabled(next);
  }

  async function sendNow() {
    const data = readProbe();
    setProbe(data);
    try {
      await fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '[SPLASH] manuel', data }),
      });
      setSent('Mesures envoyées ✓');
    } catch {
      setSent('Échec de l’envoi');
    }
    setTimeout(() => setSent(null), 3000);
  }

  return (
    <div style={{ padding: 20, paddingTop: 'calc(env(safe-area-inset-top) + 20px)', fontFamily: 'system-ui', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Diagnostic du splash</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20 }}>
        Active les logs, puis <strong>ferme complètement l’app</strong> et relance-la.
        Les mesures du lancement partent automatiquement en base.
      </p>

      <button
        type="button"
        onClick={toggle}
        style={{
          width: '100%', padding: '14px 18px', fontSize: 15, fontWeight: 600,
          borderRadius: 10, border: 'none', cursor: 'pointer', marginBottom: 10,
          background: enabled ? 'var(--green)' : 'var(--accent)', color: '#fff',
        }}
      >
        {enabled ? 'Logs ACTIVÉS — toucher pour désactiver' : 'Activer les logs'}
      </button>

      <button
        type="button"
        onClick={sendNow}
        style={{
          width: '100%', padding: '14px 18px', fontSize: 15, fontWeight: 600,
          borderRadius: 10, cursor: 'pointer', marginBottom: 20,
          background: 'transparent', border: '1.5px solid var(--border)', color: 'var(--ink)',
        }}
      >
        Envoyer les mesures maintenant
      </button>

      {sent && (
        <div style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600, marginBottom: 16 }}>{sent}</div>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 10 }}>
        Mesures de cet appareil
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {probe && Object.entries(probe).map(([k, v], i) => (
          <div
            key={k}
            style={{
              display: 'flex', justifyContent: 'space-between', gap: 12,
              padding: '10px 14px', fontSize: 12,
              borderTop: i === 0 ? 'none' : '1px solid var(--border-soft)',
            }}
          >
            <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{k}</span>
            <span style={{ fontWeight: 600, textAlign: 'right', wordBreak: 'break-all' }}>{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
