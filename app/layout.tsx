import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import Providers from './Providers';
import FathomPreconnect from '@/components/FathomPreconnect';

// display: 'swap' — le texte s'affiche immédiatement en police système puis bascule vers
// Inter quand elle charge. Ce swap agrandit le contenu de la messagerie APRÈS le premier
// paint (scrollHeight qui grandit), ce qui faisait "sauter" le scroll — mais ce n'est plus
// un problème depuis la refonte column-reverse de la messagerie : le navigateur ancre en
// bas nativement, donc le grossissement du contenu reste invisible (il pousse vers le haut
// hors-champ au lieu de décaler la vue). 'swap' garantit qu'Inter s'affiche toujours (vs
// 'optional' qui gardait la police système pour la session si Inter ne chargeait pas en 100ms).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Momentum — Plateforme coaching',
  description: 'Infrastructure de delivery pour coachs premium 1:1',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Momentum',
  },
  icons: {
    icon: [
      { url: '/favicon-momentum.png', type: 'image/png' },
    ],
    shortcut: '/favicon-momentum.png',
    apple: '/favicon-momentum.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${ibmPlexMono.variable}`}>
      <head>
        {/* Viewport app-native : pas de zoom, pas de bounce, width=device */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Momentum" />
        <meta name="theme-color" content="#fbfbf7" />
        <link rel="apple-touch-icon" href="/logo-momentum-apple.png" sizes="180x180" />
        <link rel="preconnect" href="https://fathom.video" />
      </head>
      <body>
        <Providers>{children}</Providers>
        <FathomPreconnect />
        <script dangerouslySetInnerHTML={{ __html: `
          // Zoom iOS — bloque pinch + double-tap
          document.addEventListener('touchstart', function(e) {
            if (e.touches.length > 1) e.preventDefault();
          }, { passive: false });
          var lastTouchEnd = 0;
          document.addEventListener('touchend', function(e) {
            var now = Date.now();
            if (now - lastTouchEnd <= 300) e.preventDefault();
            lastTouchEnd = now;
          }, false);

          // Service Worker — le reload automatique sur updatefound est désactivé
          // temporairement (diagnostic refresh à l'ouverture d'app) : on logge
          // l'événement sans recharger, pour vérifier sur les prochaines ouvertures
          // si c'est bien lui qui déclenchait le refresh systématique observé, ou
          // si la cause est ailleurs (à réactiver une fois confirmé).
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').then(function(reg) {
                fetch('/api/client-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[SW] register_resolved', data: { active: !!reg.active, waiting: !!reg.waiting, installing: !!reg.installing, controller: !!navigator.serviceWorker.controller } }) }).catch(function() {});
                reg.addEventListener('updatefound', function() {
                  fetch('/api/client-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[SW] updatefound', data: { controller: !!navigator.serviceWorker.controller } }) }).catch(function() {});
                  var newWorker = reg.installing;
                  newWorker.addEventListener('statechange', function() {
                    fetch('/api/client-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[SW] worker_statechange', data: { state: newWorker.state, controller: !!navigator.serviceWorker.controller } }) }).catch(function() {});
                  });
                });
              });
              navigator.serviceWorker.addEventListener('controllerchange', function() {
                fetch('/api/client-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[SW] controllerchange', data: {} }) }).catch(function() {});
              });
            });
          }
          fetch('/api/client-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[APP] boot', data: { navType: (performance.getEntriesByType('navigation')[0] || {}).type || null, href: location.href, standalone: window.navigator.standalone === true } }) }).catch(function() {});
          window.addEventListener('pagehide', function(e) {
            fetch('/api/client-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[APP] pagehide', data: { persisted: e.persisted } }) }).catch(function() {});
          });
          window.addEventListener('beforeunload', function() {
            fetch('/api/client-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[APP] beforeunload', data: {} }) }).catch(function() {});
          });
          // Erreurs JS non catchées — sans ça, une exception qui casse le rendu de
          // toute la page (comme le crash suspecté au clic sur Infos) ne laisse
          // aucune trace exploitable dans nos logs, seulement un silence qu'on ne
          // peut pas distinguer d'un vrai crash WebKit au niveau OS.
          window.addEventListener('error', function(e) {
            fetch('/api/client-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[APP] window_error', data: { msg: String(e.message || ''), filename: e.filename || null, line: e.lineno || null, col: e.colno || null, stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 500) : null } }) }).catch(function() {});
          });
          window.addEventListener('unhandledrejection', function(e) {
            var reason = e.reason;
            var serialized = reason instanceof Error ? { name: reason.name, message: reason.message, stack: (reason.stack || '').slice(0, 500) } : String(reason);
            fetch('/api/client-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[APP] unhandledrejection', data: { reason: serialized } }) }).catch(function() {});
          });
        `}} />
      </body>
    </html>
  );
}
