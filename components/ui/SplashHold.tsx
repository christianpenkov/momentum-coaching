'use client';

import { useEffect, useState } from 'react';

/**
 * Prolonge visuellement l'écran de démarrage jusqu'à ce que le contenu soit prêt.
 *
 * Sans lui, le lancement de la PWA enchaîne : splash iOS (logo sur fond crème)
 * → loader qui clignote → contenu. Ce loader intermédiaire casse l'illusion :
 * une app native garde son écran de lancement jusqu'à ce qu'il y ait quelque
 * chose à montrer.
 *
 * L'overlay reprend exactement le visuel des splash de public/splash/ (même
 * logo, même fond --bg), donc le raccord avec l'écran iOS est invisible : on
 * passe du splash système à celui-ci sans rupture, puis il s'efface.
 *
 * Ne s'affiche qu'au tout premier montage de la session : revenir sur l'accueil
 * après avoir navigué ailleurs ne doit pas redonner un écran de lancement.
 */

// Marqueur de session : sessionStorage et non un state React, car le composant
// est démonté/remonté à chaque navigation vers l'accueil.
const SEEN_KEY = 'momentum:splash-held';

export default function SplashHold({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const alreadySeen = sessionStorage.getItem(SEEN_KEY) === '1';
    if (!alreadySeen && show) setVisible(true);
  }, [show]);

  useEffect(() => {
    if (!visible || show) return;
    // Le contenu est prêt : on lance le fondu, puis on démonte.
    setFading(true);
    sessionStorage.setItem(SEEN_KEY, '1');
    const t = setTimeout(() => setVisible(false), 320);
    return () => clearTimeout(t);
  }, [show, visible]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fading ? 0 : 1,
        // Fondu de sortie seul : l'écran est déjà là à l'arrivée (il prend la
        // suite du splash iOS), l'animer en entrée créerait le flash qu'on veut
        // justement supprimer.
        transition: 'opacity 300ms ease-out',
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      {/* Version recadrée (sans la marge transparente du PNG d'origine) et
          largeur à 38vw : exactement ce qu'utilisent les splash de
          public/splash/, pour que le logo ne bouge pas d'un pixel au raccord. */}
      <img
        src="/logo-momentum-trimmed.png"
        alt=""
        style={{ width: '38vw', maxWidth: 260, height: 'auto' }}
      />
    </div>
  );
}
