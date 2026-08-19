'use client';

import { useOnline } from '@/lib/useOnline';

/**
 * Bandeau affiché quand l'app perd le réseau.
 *
 * Sans lui, une action réseau échouait en silence : le bouton Rafraîchir
 * reprenait son état normal (les fetch sont dans un Promise.allSettled, qui ne
 * rejette jamais) et déclenchait même son cooldown, alors que rien n'avait été
 * rafraîchi. L'utilisateur croyait l'action faite.
 *
 * Un bandeau global plutôt qu'un message par bouton : la cause est la même
 * partout, et il n'y a rien d'utile à ajouter au cas par cas. La détection
 * elle-même vit dans lib/useOnline (source unique, un seul sondage partagé).
 */
export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        // Sous la barre du haut : visible sans masquer la navigation, et sans
        // décaler la mise en page (position fixed, hors du flux).
        top: 'calc(env(safe-area-inset-top, 0px) + 52px)',
        zIndex: 1500,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          maxWidth: 'calc(100% - 28px)',
          padding: '8px 16px',
          borderRadius: 20,
          background: 'var(--amber-soft)',
          border: '1px solid var(--amber)',
          color: 'var(--amber)',
          fontSize: 12.5,
          fontWeight: 600,
          boxShadow: 'var(--shadow-elev)',
        }}
      >
        <span
          style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--amber)', flexShrink: 0,
          }}
        />
        Hors connexion — les données ne se mettent plus à jour
      </div>
    </div>
  );
}
