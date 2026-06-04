// SW v6 — pas de cache réseau + notifications push

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Aucun cache — network direct
self.addEventListener('fetch', () => {});

// ── Notifications push ───────────────────────────────────────────────────────

self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Momentum', body: e.data.text() }; }

  const title = data.title || 'Momentum';
  const options = {
    body: data.body || '',
    icon: '/favicon-momentum.png',
    badge: '/favicon-momentum.png',
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100],
    tag: 'momentum-msg',
    renotify: true,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus().then(c => c.navigate(url));
      return self.clients.openWindow(url);
    })
  );
});
