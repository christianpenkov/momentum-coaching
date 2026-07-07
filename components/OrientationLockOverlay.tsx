'use client';

import { useEffect } from 'react';

/**
 * Verrouillage d'orientation portrait sur mobile — combine deux mécanismes complémentaires
 * car aucun n'est fiable seul :
 *
 * 1. manifest.json "orientation": "portrait" — respecté par Android/Chrome en mode standalone,
 *    mais iOS Safari l'ignore historiquement de façon incohérente (confirmé par recherche :
 *    aucune garantie sur iPhone, même app installée en PWA).
 * 2. screen.orientation.lock('portrait') (Android uniquement, appelé ci-dessous après un geste
 *    utilisateur) — API totalement absente sur iOS Safari, inutile d'essayer.
 * 3. Overlay CSS plein écran affiché dès que le device est en paysage (@media
 *    (orientation: landscape) + max-width mobile) — LE seul mécanisme fiable sur iOS. Pas de
 *    rotation forcée (transform: rotate) : ce pattern casse les vw/vh et désynchronise les
 *    coordonnées tactiles (documenté) — on bloque juste l'usage avec un message, comme la
 *    majorité des PWA en production.
 */
export default function OrientationLockOverlay() {
  useEffect(() => {
    // Best-effort Android — no-op silencieux si non supporté (iOS, pas de geste utilisateur
    // encore effectué, etc.). Un clic n'importe où sur la page tente le lock une fois.
    function tryLock() {
      const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
      orientation?.lock?.('portrait').catch(() => {});
      document.removeEventListener('click', tryLock);
    }
    document.addEventListener('click', tryLock, { once: true });
    return () => document.removeEventListener('click', tryLock);
  }, []);

  return (
    <div className="orientation-lock-overlay">
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', padding: 32, textAlign: 'center',
        background: 'var(--bg)', color: 'var(--ink)',
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}>
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" transform="rotate(90 12 12)" />
          <path d="M12 18h.01" />
        </svg>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Tourne ton téléphone</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Momentum fonctionne uniquement en mode portrait.</div>
      </div>
    </div>
  );
}
