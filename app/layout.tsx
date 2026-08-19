import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import Providers from './Providers';
import AppBootstrap from '@/components/AppBootstrap';

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

// [largeur px physique, hauteur px physique, device-pixel-ratio]
// Le media query iOS raisonne en points CSS (px physiques ÷ ratio) : un ratio
// faux fait ignorer l'image et retomber sur l'écran blanc. Les fichiers
// correspondants sont dans public/splash/ (nommés en pixels physiques).
const SPLASH_SCREENS: [number, number, number][] = [
  [1320, 2868, 3], // iPhone 16 Pro Max
  [1206, 2622, 3], // iPhone 16 Pro
  [1290, 2796, 3], // iPhone 15/16 Pro Max, 14 Pro Max
  [1179, 2556, 3], // iPhone 15/16, 14 Pro
  [1284, 2778, 3], // iPhone 14 Plus, 13 Pro Max, 12 Pro Max
  [1170, 2532, 3], // iPhone 14, 13, 13 Pro, 12, 12 Pro
  [1125, 2436, 3], // iPhone 13 mini, 12 mini, 11 Pro, XS, X
  [1242, 2688, 3], // iPhone 11 Pro Max, XS Max
  [828, 1792, 2],  // iPhone 11, XR
  [1242, 2208, 3], // iPhone 8 Plus, 7 Plus, 6s Plus
  [750, 1334, 2],  // iPhone SE (2e/3e gen), 8, 7, 6s
  [1536, 2048, 2], // iPad 9.7"
  [1668, 2224, 2], // iPad Pro 10.5"
  [1668, 2388, 2], // iPad Pro 11"
  [2048, 2732, 2], // iPad Pro 12.9"
];

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
        {/* Écrans de démarrage iOS. Sans eux, lancer la PWA depuis l'écran
            d'accueil affiche un écran BLANC jusqu'au premier rendu — iOS ne
            génère rien tout seul, contrairement à Android. C'est le premier
            contact avec l'app à chaque ouverture.
            iOS n'accepte une image que si le media query correspond EXACTEMENT
            à l'écran ; toute taille manquante retombe sur le blanc. */}
        {SPLASH_SCREENS.map(([w, h, ratio]) => (
          <link
            key={`${w}x${h}`}
            rel="apple-touch-startup-image"
            href={`/splash/${w}x${h}.png`}
            media={`(device-width: ${w / ratio}px) and (device-height: ${h / ratio}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`}
          />
        ))}
        <link rel="preconnect" href="https://fathom.video" />
      </head>
      <body>
        <Providers>{children}</Providers>
        <AppBootstrap />
      </body>
    </html>
  );
}
