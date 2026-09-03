'use client';

import { useEffect } from 'react';

// Logique de démarrage globale (zoom iOS, Service Worker, logs de cycle de vie).
// Auparavant un <script dangerouslySetInnerHTML> directement dans le Server
// Component racine (app/layout.tsx) — Next.js sérialise le HTML du body une
// fois pour le SSR initial ET une seconde fois dans le flux de streaming RSC
// pour l'hydratation, donc le navigateur exécutait ce script deux fois à
// chaque chargement (confirmé : même sessionStorage, deux `boot` consécutifs
// avec le même sessionId, et <script> présent deux fois dans le HTML brut
// servi). Un vrai Client Component avec useEffect ne s'exécute qu'au montage
// React réel, jamais dupliqué par le streaming SSR.
let bootLogged = false;

declare global {
  interface Window {
    __MOMENTUM_RUNTIME_ID__?: string;
    __MOMENTUM_MOUNT_COUNT__?: number;
  }
}

// window.__MOMENTUM_RUNTIME_ID__ (pas une variable de module) — seule preuve
// fiable pour trancher entre "même document, module ré-exécuté" (id identique)
// et "vrai second document/contexte JS" (id différent, puisque window lui-même
// serait recréé). Voir aussi timeOrigin envoyé plus bas dans le boot log.
function getRuntimeId(): string {
  if (!window.__MOMENTUM_RUNTIME_ID__) {
    window.__MOMENTUM_RUNTIME_ID__ = Date.now() + '-' + Math.random().toString(36).slice(2);
  }
  return window.__MOMENTUM_RUNTIME_ID__;
}

function logClient(message: string, data: Record<string, unknown> = {}) {
  fetch('/api/client-log', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, data }),
  }).catch(() => {});
}

export default function AppBootstrap() {
  useEffect(() => {
    // Zoom iOS — bloque pinch + double-tap
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length > 1) e.preventDefault();
    }
    let lastTouchEnd = 0;
    function onTouchEnd(e: TouchEvent) {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }
    document.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchend', onTouchEnd, false);

    window.__MOMENTUM_MOUNT_COUNT__ = (window.__MOMENTUM_MOUNT_COUNT__ || 0) + 1;
    logClient('[APP] appbootstrap_mount', {
      runtimeId: getRuntimeId(),
      mountCount: window.__MOMENTUM_MOUNT_COUNT__,
      moduleBootLogged: bootLogged,
      timeOrigin: performance.timeOrigin,
      navigationStart: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.startTime ?? null,
    });

    if (bootLogged) {
      return () => {
        document.removeEventListener('touchstart', onTouchStart);
        document.removeEventListener('touchend', onTouchEnd);
      };
    }
    bootLogged = true;

    // Service Worker — le reload automatique sur updatefound reste désactivé
    // (diagnostic refresh à l'ouverture d'app) : on logge sans recharger.
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').then(function (reg) {
          logClient('[SW] register_resolved', { active: !!reg.active, waiting: !!reg.waiting, installing: !!reg.installing, controller: !!navigator.serviceWorker.controller });
          reg.addEventListener('updatefound', function () {
            logClient('[SW] updatefound', { controller: !!navigator.serviceWorker.controller });
            const newWorker = reg.installing;
            newWorker?.addEventListener('statechange', function () {
              logClient('[SW] worker_statechange', { state: newWorker.state, controller: !!navigator.serviceWorker.controller });
            });
          });
        });
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          logClient('[SW] controllerchange', {});
        });
      });

      // ── Rattrapage de déploiement (audit du 2026-09-02) ─────────────────────
      // Le SW envoie DEPLOIEMENT_DETECTE quand un chunk _next/static renvoie 404
      // — le cas d'une PWA restée en mémoire pendant qu'un deploy remplaçait les
      // fichiers hashés. Le commentaire du SW promettait « on recharge la page
      // une fois » avec « un drapeau en sessionStorage »… mais AUCUN code client
      // n'écoutait : le message partait dans le vide, et l'élève voyait « this
      // page couldn't load » (incident du 2026-08-21). Voici l'écouteur, avec le
      // drapeau anti-boucle promis — levé après 60 s pour qu'un deploy ultérieur
      // dans la même session soit rattrapé aussi.
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data?.type !== 'DEPLOIEMENT_DETECTE') return;
        const dernierRechargement = Number(sessionStorage.getItem('__deploy_reload_at') || '0');
        if (Date.now() - dernierRechargement < 60_000) {
          logClient('[SW] deploiement_detecte_boucle_evitee', {});
          return;
        }
        sessionStorage.setItem('__deploy_reload_at', String(Date.now()));
        logClient('[SW] deploiement_detecte_reload', {});
        location.reload();
      });
    }

    let sessionId = sessionStorage.getItem('__boot_session_id');
    if (!sessionId) {
      sessionId = Date.now() + '-' + Math.random().toString(36).slice(2);
      sessionStorage.setItem('__boot_session_id', sessionId);
    }
    const bootCount = parseInt(sessionStorage.getItem('__boot_count') || '0', 10) + 1;
    sessionStorage.setItem('__boot_count', String(bootCount));
    logClient('[APP] boot', {
      navType: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? null,
      href: location.href,
      standalone: (window.navigator as any).standalone === true,
      sessionId,
      bootCount,
      referrer: document.referrer || null,
      runtimeId: getRuntimeId(),
      timeOrigin: performance.timeOrigin,
    });

    function onPageHide(e: PageTransitionEvent) {
      logClient('[APP] pagehide', { persisted: e.persisted });
    }
    function onBeforeUnload() {
      logClient('[APP] beforeunload', {});
    }
    function onError(e: ErrorEvent) {
      logClient('[APP] window_error', {
        msg: String(e.message || ''),
        filename: e.filename || null,
        line: e.lineno || null,
        col: e.colno || null,
        stack: e.error?.stack ? String(e.error.stack).slice(0, 500) : null,
      });
    }
    function onUnhandledRejection(e: PromiseRejectionEvent) {
      const reason = e.reason;
      const serialized = reason instanceof Error
        ? { name: reason.name, message: reason.message, stack: (reason.stack || '').slice(0, 500) }
        : String(reason);
      logClient('[APP] unhandledrejection', { reason: serialized });
    }

    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}
