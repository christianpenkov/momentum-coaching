import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.cdninstagram.com' },
      { protocol: 'https', hostname: '*.fbcdn.net' },
      { protocol: 'https', hostname: 'scontent.cdninstagram.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  async headers() {
    return [
      {
        // Autoriser les images YouTube et favicons Google sur toutes les pages
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "img-src 'self' data: blob: https://img.youtube.com https://i.ytimg.com https://www.google.com https://*.supabase.co https://*.cdninstagram.com https://*.fbcdn.net https://scontent.cdninstagram.com https://*.googleusercontent.com;",
          },
        ],
      },
      {
        // sw.js ne doit JAMAIS être mis en cache — Safari iOS vérifie sinon une fois par 24h
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        // manifest.json non-caché aussi
        source: '/manifest.json',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
        ],
      },
      {
        // Pages HTML de l'app — iOS Safari sert une version en cache local
        // MALGRÉ un Cache-Control "must-revalidate, max-age=0" (confirmé : iOS
        // ignore silencieusement la revalidation, seul no-store empêche vraiment
        // la mise en cache). Sans ça, un crash Jetsam qui force un reload peut
        // resservir un ancien HTML pointant vers d'anciens chunks _next/static
        // (eux immutable/max-age=1an par design Next.js, donc toujours servables) —
        // observé en conditions réelles : un composant monté après un crash
        // n'avait pas le dernier code déployé, malgré un déploiement récent.
        source: '/((?!_next/static|_next/image|favicon|sw.js|manifest.json).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0' },
        ],
      },
    ];
  },
};

export default nextConfig;
