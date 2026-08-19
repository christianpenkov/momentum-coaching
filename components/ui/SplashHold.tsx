'use client';

import { useEffect, useState } from 'react';

/**
 * Prolonge visuellement l'écran de démarrage jusqu'à ce que l'app soit prête.
 *
 * Sans lui, le lancement de la PWA enchaîne : splash iOS (logo sur fond crème)
 * → loader qui clignote → contenu. Ce loader intermédiaire casse l'illusion :
 * une app native garde son écran de lancement jusqu'à ce qu'il y ait quelque
 * chose à montrer.
 *
 * L'overlay reprend exactement le visuel des splash de public/splash/ (même
 * logo recadré, même fond --bg, même proportion), donc le raccord avec l'écran
 * système est invisible, puis il s'efface en fondu.
 *
 * IMPORTANT — l'état initial est `visible`, pas `caché`. Un useEffect ne
 * s'exécute qu'après le premier rendu et l'hydratation : si l'overlay attendait
 * un effet pour apparaître, il resterait un trou entre le splash système et
 * lui, pendant lequel on voit un écran blanc puis un flash du loader. C'est
 * exactement le bug qu'il doit supprimer.
 */

// Marqueur de session : sessionStorage et non un state React, car le composant
// est remonté à chaque navigation. Lu de façon paresseuse au premier rendu.
const SEEN_KEY = 'momentum:splash-held';

function alreadySeen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export default function SplashHold({ show }: { show: boolean }) {
  // Initialiseur paresseux : décidé au tout premier rendu, avant tout effet,
  // donc l'overlay est peint dès la première frame — pas de trou blanc.
  //
  // Volontairement sans lecture de sessionStorage ici : le serveur ne peut pas
  // la faire, et un état initial différent entre serveur et client provoque une
  // erreur d'hydratation. Le cas "déjà vu" est traité dans l'effet ci-dessous,
  // qui s'exécute assez tôt pour que rien ne clignote.
  const [mounted, setMounted] = useState(show);
  const [fading, setFading] = useState(false);

  // Retrait immédiat (sans fondu) si l'écran a déjà été montré dans cette
  // session : une navigation vers l'accueil ne doit pas rejouer un lancement.
  useEffect(() => {
    if (mounted && alreadySeen()) setMounted(false);
  }, [mounted]);

  useEffect(() => {
    if (!mounted || show) return;
    // L'app est prête : on lance le fondu, puis on démonte.
    setFading(true);
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* mode privé */ }
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [show, mounted]);

  if (!mounted) return null;

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
        // suite du splash système), l'animer en entrée créerait le flash qu'on
        // veut justement supprimer.
        transition: 'opacity 240ms ease-out',
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      {/* Version recadrée (sans la marge transparente du PNG d'origine) et
          largeur à 38vw : exactement ce qu'utilisent les splash de
          public/splash/, pour que le logo ne bouge pas d'un pixel au raccord. */}
      <img
        src="/logo-momentum-trimmed.png"
        alt=""
        // fetchPriority : l'image doit être là dès la première frame, sinon on
        // voit le fond crème nu avant que le logo n'apparaisse.
        fetchPriority="high"
        style={{ width: '38vw', maxWidth: 260, height: 'auto' }}
      />
    </div>
  );
}
