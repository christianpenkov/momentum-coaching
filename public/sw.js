// SW v8 — iOS strict : options épurées, waitUntil complet, fallback erreur

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    self.clients.claim().then(() =>
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    )
  );
});

self.addEventListener('fetch', () => {});

// ── Push : options strictement compatibles iOS WebKit ────────────────────────
// badge, data, vibrate, actions, image → crash silencieux sur iOS → supprimés

self.addEventListener('push', e => {
  e.waitUntil(
    Promise.resolve()
      .then(() => {
        let payload = { title: 'Momentum', body: 'Vous avez reçu un message.' };
        if (e.data) {
          try { payload = e.data.json(); }
          catch { payload = { title: 'Momentum', body: e.data.text() }; }
        }
        return self.registration.showNotification(
          payload.title || 'Momentum',
          {
            body: (payload.body || 'Nouveau message').substring(0, 100),
            icon: '/favicon-momentum.png',
            tag: 'momentum-msg',
            renotify: true,
            // NE PAS ajouter : badge, data, vibrate, actions, image — non supportés iOS
          }
        );
      })
      .catch(() =>
        // Fallback obligatoire : sans notification visible iOS pénalise le token
        self.registration.showNotification('Momentum', {
          body: 'Nouveau message — ouvrez l\'app pour le lire.',
          icon: '/favicon-momentum.png',
          tag: 'momentum-msg',
        })
      )
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    })
  );
});
