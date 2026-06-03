// SW v5 — purge tout et ne met rien en cache
// Chaque requête va directement au réseau

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Force le rechargement de tous les clients ouverts
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.navigate(client.url));
        });
      })
  );
});

// Aucun cache — network direct pour tout
self.addEventListener('fetch', () => {});
