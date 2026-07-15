'use client';
import { useState, useEffect } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

// SSR-safe : false au premier rendu serveur, corrigé au montage via matchMedia.
// Pour tout comportement qui doit être correct dès le PREMIER paint (ex. neutraliser
// un auto-select avant que ce state ne se mette à jour), lire directement
// window.matchMedia(MOBILE_QUERY).matches plutôt que la valeur retournée par ce hook.
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

export function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}
