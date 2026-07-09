import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import Providers from './Providers';

// display: 'optional' (et non 'swap') — évite le FOUT qui faisait sauter le scroll de la
// messagerie : avec 'swap', le texte s'affiche en police système puis BASCULE vers Inter
// quand elle finit de charger (premières secondes), ce qui change la hauteur des messages
// donc le scrollHeight APRÈS le premier paint. 'optional' laisse ~100ms au navigateur puis
// garde la police de repli pour la session si elle n'est pas prête — plus aucune bascule
// tardive, donc plus de changement de hauteur après coup. next/font génère déjà un
// adjustFontFallback (metrics de la police de repli calées sur Inter) pour minimiser
// l'écart visuel. Les volets scroll (ResizeObserver sur le contenu, tap qui ne coupe plus
// la compensation) protègent en plus contre tout autre reflow tardif (images, vocaux).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'optional',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'optional',
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
      </head>
      <body>
        <Providers>{children}</Providers>
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

          // Service Worker — force reload dès qu'un nouveau SW est prêt
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').then(function(reg) {
                reg.addEventListener('updatefound', function() {
                  var newWorker = reg.installing;
                  newWorker.addEventListener('statechange', function() {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                      window.location.reload();
                    }
                  });
                });
              });
            });
          }
        `}} />
      </body>
    </html>
  );
}
