'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    __fbqPixelReady?: boolean;
  }
}

// Le code de base du pixel Meta (dans <head>, app/layout.tsx) n'envoie qu'UN
// seul PageView : celui du chargement initial du document. Or Momentum est une
// SPA — passer de /dashboard à /pipeline ne recharge jamais le document, donc
// sans ce composant Meta ne verrait qu'une seule page par session, celle par
// laquelle l'utilisateur est entré.
//
// On se cale sur usePathname (et pas useSearchParams) volontairement :
// useSearchParams force la page appelante en rendu dynamique et exige une
// frontière <Suspense>. Aucune page ici ne distingue deux vues par la seule
// query string, donc le pathname suffit.
export default function MetaPixelRouteTracker() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Le premier passage correspond au PageView déjà envoyé par le <head>.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.fbq?.('track', 'PageView');
  }, [pathname]);

  return null;
}
