'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Rend les overlays directement dans <body>.
 *
 * Sans ça, un `position: fixed` se cale sur le conteneur parent au lieu du
 * viewport : `.main-content` a `position: relative` + `overflow-y: auto`, et
 * `PageTransition` applique un `transform` — deux causes indépendantes de
 * contexte d'empilement. Le panneau se retrouvait confiné en haut de la zone de
 * contenu, sans assombrir la sidebar ni la barre du haut, et scrollait avec la page.
 *
 * Même parade que `Portal` dans PageClientStats.tsx.
 */
export default function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  // Le portail ne peut exister qu'après l'hydratation : document n'existe pas au
  // rendu serveur.
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<>{children}</>, document.body);
}
