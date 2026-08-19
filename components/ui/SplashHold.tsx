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

// Durées d'affichage minimales, comptées depuis le chargement du document.
//
// Mobile : l'écran système a déjà été montré pendant le lancement, le
// prolonger donnerait l'impression que l'app est lente.
//
// Desktop : aucun splash système, et le chargement est rapide — sans durée
// plancher le logo n'apparaîtrait que le temps d'un flash. La valeur est
// volontairement généreuse pour que l'écran se lise comme une marque.
const MIN_VISIBLE_MOBILE_MS = 260;
const MIN_VISIBLE_DESKTOP_MS = 3000;

// Doit rester aligné sur la transition CSS de #app-splash.
const FADE_MS = 240;

/**
 * Détection par pointeur ET largeur : une tablette tactile large n'est pas un
 * desktop, elle a bien un splash système et n'a pas besoin de la durée longue.
 */
function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: fine)').matches && window.innerWidth >= 768;
}

/**
 * true si le document a été rechargé (F5, Cmd+R, bouton recharger) plutôt
 * qu'atteint par une navigation. Un rechargement est un nouveau lancement pour
 * l'utilisateur : l'écran doit se rejouer, alors que le marqueur de session,
 * lui, survit au refresh.
 */
function isReload(): boolean {
  if (typeof performance === 'undefined') return false;
  try {
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return nav?.type === 'reload';
  } catch {
    return false;
  }
}

// Un seul SplashHold doit décider du retrait. Le layout racine en monte un pour
// couvrir /login, /signup, /invite et / (qui n'ont pas de layout d'app), mais il
// doit s'effacer dès qu'un layout coach/élève en monte un piloté par la session.
// Sans ça, le splash partirait avant que la session soit résolue.
let sessionOwner = false;

/**
 * @param show true tant que l'app n'est pas prête à être montrée. Omis sur les
 * écrans qui n'attendent aucune session : ils sont prêts dès leur rendu.
 * @param owner true pour le SplashHold d'un layout d'app, qui a autorité sur
 * celui du layout racine.
 */
export default function SplashHold({ show = false, owner = false }: { show?: boolean; owner?: boolean }) {
  useEffect(() => {
    if (owner) sessionOwner = true;
    // Le contrôleur racine se tait dès qu'un layout d'app a pris la main.
    if (!owner && sessionOwner) return;

    const el = document.getElementById('app-splash');
    if (!el) return;

    // Déjà vu dans cette session : retrait sec, sans fondu ni délai. Une
    // navigation interne vers l'accueil ne doit pas rejouer un lancement.
    //
    // Exception : un rechargement de page est un nouveau lancement du point de
    // vue de l'utilisateur, l'écran doit donc se rejouer. Le marqueur de session
    // survivant au refresh, on le neutralise explicitement dans ce cas.
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* mode privé */ }
    if (seen && isReload()) {
      seen = false;
      try { sessionStorage.removeItem(SEEN_KEY); } catch { /* mode privé */ }
    }
    if (seen) {
      el.setAttribute('data-done', '1');
      document.body.removeAttribute('data-splash');
      return;
    }

    if (show) return; // session pas encore résolue : on laisse l'écran

    // performance.now() : temps écoulé depuis le début du chargement du
    // document, donc depuis que l'écran est réellement à l'image.
    const minVisible = isDesktop() ? MIN_VISIBLE_DESKTOP_MS : MIN_VISIBLE_MOBILE_MS;
    const elapsed = performance.now();
    const wait = Math.max(0, minVisible - elapsed);

    const fadeTimer = setTimeout(() => {
      el.setAttribute('data-hide', '1');
      try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* mode privé */ }
    }, wait);

    const doneTimer = setTimeout(() => {
      el.setAttribute('data-done', '1');
      // Les loaders de page redeviennent visibles seulement maintenant : entre
      // le debut du fondu et ce point, l'ecran couvre encore la page.
      document.body.removeAttribute('data-splash');
    }, wait + FADE_MS);

    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
  }, [show, owner]);

  return null;
}
