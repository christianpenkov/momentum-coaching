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

// Durée d'affichage minimale sur mobile, à partir du chargement du document.
// L'écran système a déjà été montré pendant le lancement : le prolonger
// inutilement donnerait l'impression que l'app est lente.
const MIN_VISIBLE_MOBILE_MS = 260;

// Doit rester aligné sur la transition CSS de #app-splash.
const FADE_MS = 240;

/**
 * Sur desktop, l'écran de lancement est retiré immédiatement et sans fondu.
 * Il n'y a aucun splash système à prolonger et le chargement est rapide :
 * l'écran ne serait qu'un flash de logo, plus gênant que pas d'écran du tout.
 * Le CSS le masque déjà (@media pointer:fine), ceci le retire aussi du flux.
 *
 * Détection par pointeur et largeur, comme la règle CSS correspondante : une
 * tablette tactile large garde l'écran, elle a bien un splash système.
 */
function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: fine)').matches && window.innerWidth >= 768;
}

export default function SplashHold({ show }: { show: boolean }) {
  useEffect(() => {
    const el = document.getElementById('app-splash');
    if (!el) return;

    // Desktop, ou écran déjà vu dans cette session : retrait sec, sans fondu ni
    // délai. Une navigation vers l'accueil ne doit pas rejouer un lancement.
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* mode privé */ }
    if (seen || isDesktop()) {
      el.setAttribute('data-done', '1');
      return;
    }

    if (show) return; // session pas encore résolue : on laisse l'écran

    // performance.now() : temps écoulé depuis le début du chargement du
    // document, donc depuis que l'écran est réellement à l'image.
    const elapsed = performance.now();
    const wait = Math.max(0, MIN_VISIBLE_MOBILE_MS - elapsed);

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
