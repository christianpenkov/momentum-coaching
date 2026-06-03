// Service Worker — Network only (pas de cache pour assurer les mises à jour)
// v4 — force invalidation

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  // Supprime tous les anciens caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-only : jamais de cache, toujours frais
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Laisse passer sans interception — le navigateur gère
});
