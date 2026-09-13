'use client';

import { useEffect } from 'react';
import { signalerDepuisNavigateur } from '@/lib/incidentsNavigateur';

// Filet de rendu de toute la plateforme (sous le layout racine).
//
// Avant ce fichier (2026-09-13), une exception de rendu affichait la page d'erreur
// brute de Next et ne laissait AUCUNE trace : ni l'élève ni le mainteneur ne savaient
// qu'un écran était cassé. Cas réel qui l'a motivé : `BandeauIntegrations` levait
// `Cannot read properties of undefined (reading 'fond')` dès qu'une intégration passait
// en `erreur_api` — c'est-à-dire exactement pendant une panne, sur « Mes stats ».
//
// Deux rôles : signaler (l'incident part en base, puis par e-mail), et laisser
// l'utilisateur réessayer sans recharger toute l'application.
export default function ErreurDePage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    signalerDepuisNavigateur({
      type: 'rendu',
      message: error.message,
      nom: error.name,
      pile: error.stack ? error.stack.slice(0, 4_000) : null,
      digest: error.digest ?? null,
      chemin: typeof location !== 'undefined' ? location.pathname : '',
    });
  }, [error]);

  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <p style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px', color: 'var(--accent)' }}>
          Cet écran a rencontré un problème
        </p>
        <p style={{ fontSize: 14, margin: '0 0 20px', color: 'var(--ink-2, #5c5850)', lineHeight: 1.5 }}>
          Le problème a été signalé automatiquement. Vous pouvez réessayer ; si ça se reproduit, il est déjà en cours de traitement.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={() => unstable_retry()}>
            Réessayer
          </button>
          <a href="/" className="btn btn-secondary">Retour à l’accueil</a>
        </div>
      </div>
    </div>
  );
}
