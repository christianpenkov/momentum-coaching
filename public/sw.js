// SW v8-debug — logs push vers Supabase (pas de Mac = pas d'inspecteur Safari)

const SUPABASE_URL = 'https://nvjgwtetyuatnkjihmtw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52amd3dGV0eXVhdG5ramlobXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzc3ODUsImV4cCI6MjA5NDYxMzc4NX0.0apyZEDUtM6LFBX5uDK5amD_jhKAgrYsZ61JSrA9gxk';

function swLog(event, data) {
  fetch(`${SUPABASE_URL}/rest/v1/sw_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      event,
      data: typeof data === 'string' ? data : JSON.stringify(data),
      created_at: new Date().toISOString(),
    }),
  }).catch(() => {}); // silencieux si la table n'existe pas encore
}

self.addEventListener('install', e => {
  swLog('install', 'SW v8-debug installing');
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  swLog('activate', 'SW v8-debug activating + claim');
  e.waitUntil(
    self.clients.claim().then(() =>
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    )
  );
});

self.addEventListener('fetch', () => {});

self.addEventListener('push', e => {
  swLog('push_received', e.data ? 'has_data' : 'no_data');

  e.waitUntil(
    Promise.resolve()
      .then(() => {
        let payload = { title: 'Momentum', body: 'Vous avez reçu un message.' };
        if (e.data) {
          try {
            payload = e.data.json();
            swLog('push_parsed', payload);
          } catch (err) {
            payload = { title: 'Momentum', body: e.data.text() };
            swLog('push_parse_error', String(err));
          }
        }

        swLog('push_showing_notification', payload.title);

        return self.registration.showNotification(
          payload.title || 'Momentum',
          {
            body: (payload.body || 'Nouveau message').substring(0, 100),
            icon: '/favicon-momentum.png',
            // Miniature large affichée dans la notification (photo envoyée, ou
            // miniature PDF pour un document) — absent pour les messages texte/vocal.
            ...(payload.image ? { image: payload.image } : {}),
            tag: 'momentum-msg',
            renotify: true,
            data: { url: payload.url || '/' },
          }
        ).then(async () => {
          swLog('push_notification_shown', 'success');
          // Pastille sur l'icône de l'app (iOS 16.4+, PWA installée) — Android
          // ignore setAppBadge et gère déjà un badge automatique via showNotification.
          if ('setAppBadge' in self.navigator) {
            try {
              await self.navigator.setAppBadge(payload.unreadCount || 1);
              swLog('badge_set', payload.unreadCount || 1);
            } catch (err) {
              swLog('badge_error', String(err));
            }
          }
        });
      })
      .catch(err => {
        swLog('push_error', String(err));
        return self.registration.showNotification('Momentum', {
          body: "Nouveau message — ouvrez l'app.",
          icon: '/favicon-momentum.png',
          tag: 'momentum-msg',
        });
      })
  );
});

self.addEventListener('notificationclick', e => {
  swLog('notification_clicked', e.notification.title);
  e.notification.close();

  let targetUrl = '/';
  try {
    const data = e.notification.data || JSON.parse(e.notification.body || '{}');
    if (data.url) targetUrl = data.url;
  } catch {}

  const fullUrl = self.location.origin + targetUrl;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(fullUrl);
        return existing.focus();
      }
      return self.clients.openWindow(fullUrl);
    })
  );
});
