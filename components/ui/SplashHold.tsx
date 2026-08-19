'use client';

import { useEffect } from 'react';

/**
 * Retire l'écran de lancement posé en HTML par app/layout.tsx (#app-splash).
 *
 * Ce composant ne REND rien : l'écran existe déjà dans le document avant que
 * React ne démarre, c'est ce qui garantit qu'aucun blanc ni aucun loader
 * n'apparaît entre le splash système et l'app. Une version React de l'écran
 * créerait justement le trou qu'on veut supprimer (le rendu dépend du bundle
 * JS), et un second écran superposé au premier.
 *
 * Ne fait donc que piloter des attributs sur ce nœud :
 *   data-hide=1  → lance le fondu de sortie
 *   data-done=1  → le retire du flux une fois le fondu fini
 */

// Marqueur de session : une navigation vers l'accueil ne doit pas rejouer un
// lancement. sessionStorage et non un state React, car le composant est
// remonté à chaque changement de page.
const SEEN_KEY = 'momentum:splash-held';

// Durée d'affichage minimale, à partir du premier rendu.
// Sur mobile, l'écran système a déjà été affiché pendant le lancement : le
// prolonger inutilement donnerait l'impression que l'app est lente.
// Sur desktop il n'y a aucun splash système, l'écran apparaît donc à froid et
// doit rester assez longtemps pour être lu comme une marque et non comme un
// clignotement.
const MIN_VISIBLE_MOBILE_MS = 260;
const MIN_VISIBLE_DESKTOP_MS = 900;

// Doit rester aligné sur la transition CSS de #app-splash.
const FADE_MS = 240;

function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  // Pointeur fin = souris/trackpad. Plus fiable qu'une largeur d'écran : une
  // tablette large reste un appareil tactile avec splash système.
  return window.matchMedia('(pointer: fine)').matches;
}

export default function SplashHold({ show }: { show: boolean }) {
  useEffect(() => {
    const el = document.getElementById('app-splash');
    if (!el) return;

    // Déjà vu dans cette session : retrait sec, sans fondu ni délai.
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* mode privé */ }
    if (seen) {
      el.setAttribute('data-done', '1');
      return;
    }

    if (show) return; // session pas encore résolue : on laisse l'écran

    const minVisible = isDesktop() ? MIN_VISIBLE_DESKTOP_MS : MIN_VISIBLE_MOBILE_MS;
    // performance.timeOrigin : temps écoulé depuis le début du chargement du
    // document, donc depuis que l'écran est réellement à l'image.
    const elapsed = performance.now();
    const wait = Math.max(0, minVisible - elapsed);

    const fadeTimer = setTimeout(() => {
      el.setAttribute('data-hide', '1');
      try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* mode privé */ }
    }, wait);

    const doneTimer = setTimeout(() => {
      el.setAttribute('data-done', '1');
    }, wait + FADE_MS);

    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
  }, [show]);

  return null;
}
