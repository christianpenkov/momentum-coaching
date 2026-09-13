'use client';

import { useEffect } from 'react';
import { signalerDepuisNavigateur } from '@/lib/incidentsNavigateur';

// Dernier filet : une erreur dans le LAYOUT RACINE lui-même, que `app/error.tsx` ne
// peut pas attraper (il vit en dessous). Il remplace alors toute la page, d'où ses
// propres <html> et <body>, et des styles écrits en ligne — la feuille globale peut
// être précisément ce qui n'a pas chargé.
export default function ErreurGlobale({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    signalerDepuisNavigateur({
      type: 'rendu',
      globale: true,
      message: error.message,
      nom: error.name,
      pile: error.stack ? error.stack.slice(0, 4_000) : null,
      digest: error.digest ?? null,
      chemin: typeof location !== 'undefined' ? location.pathname : '',
    });
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ margin: 0, background: '#fbfbf7', color: '#1a1815', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <title>Momentum</title>
            <p style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>La plateforme a rencontré un problème</p>
            <p style={{ fontSize: 14, margin: '0 0 20px', color: '#5c5850', lineHeight: 1.5 }}>
              Le problème a été signalé automatiquement. Vous pouvez réessayer.
            </p>
            <button
              type="button"
              onClick={() => unstable_retry()}
              style={{ padding: '9px 18px', borderRadius: 7, border: '1px solid #1a1815', background: '#1a1815', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              Réessayer
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
