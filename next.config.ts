import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Autoriser les images YouTube et favicons Google sur toutes les pages
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "img-src 'self' data: blob: https://img.youtube.com https://www.google.com https://*.supabase.co https://*.cdninstagram.com https://*.fbcdn.net https://scontent.cdninstagram.com;",
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
    ];
  },
};

export default nextConfig;
