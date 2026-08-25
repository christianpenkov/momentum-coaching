// SW v11 — push + coquille hors ligne + pastille persistante
//
// Strategie volontairement minimale, alignee sur les recommandations courantes :
//   - navigations : RESEAU D'ABORD, repli sur /offline.html si le reseau echoue.
//     Surtout PAS de cache-first sur le HTML — c'est le piege classique qui fige
//     les utilisateurs sur une ancienne version. Le no-store pose dans
//     next.config.ts reste donc la regle, le SW n'y touche pas.
//   - assets statiques (_next/static, images, polices) : CACHE D'ABORD, ils sont
//     hashes donc immuables : un nom de fichier = un contenu.
//   - reste (API, Supabase) : non intercepte. Des donnees de coaching perimees
//     servies hors ligne seraient pires qu'un ecran honnete "pas de connexion".

const CACHE = 'momentum-v1';
const OFFLINE_URL = '/offline.html';

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
  swLog('install', { msg: 'SW v11 installing', ts: Date.now() });
  e.waitUntil(
    // L'ecran hors ligne doit etre en cache AVANT d'en avoir besoin : au moment
    // ou le reseau manque, il est trop tard pour le telecharger.
    caches.open(CACHE)
      .then(c => c.addAll([OFFLINE_URL, '/logo-momentum-trimmed.png']))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  swLog('activate', { msg: 'SW v8-debug activating + claim', ts: Date.now() });
  e.waitUntil(
    self.clients.claim().then(() => {
      swLog('activate_claimed', { ts: Date.now() });
      // Purge les anciennes versions mais preserve le cache courant, sinon
      // la coquille hors ligne serait effacee a chaque activation.
      return caches.keys().then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ));
    }).then(() => {
      swLog('activate_caches_cleared', { ts: Date.now() });
    })
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Autres origines (Supabase, CDN Instagram...) : non intercepte. Mettre des
  // donnees de coaching en cache les rendrait perimees sans que l'utilisateur
  // le sache — un ecran honnete "pas de connexion" vaut mieux.
  if (url.origin !== self.location.origin) return;

  // NAVIGATIONS — reseau d'abord, repli sur la coquille hors ligne.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // ASSETS HASHES — cache d'abord. Un nom de fichier _next/static correspond a
  // un contenu unique et immuable : aucun risque de servir une version perimee.
  const isStatic = url.pathname.startsWith('/_next/static/')
    || /\.(png|jpg|jpeg|svg|webp|woff2?|ico)$/.test(url.pathname);

  if (isStatic) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        // Ne met en cache que les reponses completes et valides : une reponse
        // partielle ou en erreur figerait un asset casse.
        if (res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => {
        // Un morceau de code introuvable signifie presque toujours qu'un
        // DEPLOIEMENT vient d'avoir lieu : les fichiers _next/static portent un nom
        // different a chaque version, et l'onglet ouvert demande encore ceux de
        // l'ancienne.
        //
        // Sans ce rattrapage, l'echec remontait tel quel et l'application affichait
        // « this page couldn't load », voire l'ecran hors ligne alors que la
        // connexion etait bonne (signale par Chris le 2026-08-21, apres quatorze
        // deploiements en une heure quarante).
        //
        // On recharge la page une fois : le navigateur reprend la version courante
        // et tout redevient normal. Le drapeau en sessionStorage evite une boucle si
        // le rechargement echoue lui aussi — dans ce cas on laisse l'erreur remonter.
        if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
          e.waitUntil(
            self.clients.matchAll({ type: 'window' }).then(clients => {
              clients.forEach(c => c.postMessage({ type: 'DEPLOIEMENT_DETECTE' }));
            })
          );
        }
        return Response.error();
      }))
    );
  }
  // Tout le reste (routes /api, documents non-navigation) passe au reseau
  // normalement, sans interception.
});

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
            // Photo de profil de l'expéditeur si disponible, sinon logo Momentum.
            icon: payload.icon || '/favicon-momentum.png',
            // Miniature large affichée dans la notification (photo envoyée, ou
            // miniature PDF pour un document) — absent pour les messages texte/vocal.
            ...(payload.image ? { image: payload.image } : {}),
            // Un tag PARTAGÉ fait qu'une notification remplace la précédente :
            // c'est voulu pour la messagerie (un seul badge de conversation),
            // mais pas pour des rappels distincts — deux échéances tombant le
            // même jour n'en laisseraient qu'une visible. L'émetteur peut donc
            // imposer son propre tag ; à défaut on garde l'ancien comportement.
            tag: payload.tag || 'momentum-msg',
            renotify: true,
            // requireInteraction + vibrate — pousse Android à traiter la notif comme
            // prioritaire (heads-up) plutôt que la déposer silencieusement dans le tiroir.
            // Limitation connue Android/WebAPK, pas garanti sur tous les constructeurs
            // (Samsung notamment), mais gratuit à tenter.
            requireInteraction: true,
            vibrate: [200, 100, 200],
            data: { url: payload.url || '/' },
          }
        ).then(async () => {
          swLog('push_notification_shown', 'success');
          // Pastille sur l'icône de l'app (iOS 16.4+, PWA installée) — Android
          // ignore setAppBadge et gère déjà un badge automatique via showNotification.
          if ('setAppBadge' in self.navigator) {
            try {
              // L'émetteur ne fournit pas de total (`unreadCount` n'est envoyé
              // par aucune route) : on COMPTE donc les notifications encore
              // présentes dans le tiroir plutôt que de poser 1 en dur. Poser 1
              // écrasait la pastille à chaque push — cinq messages non lus
              // affichaient « 1 », et la pastille semblait « oublier » ce qui
              // s'était accumulé pendant l'absence.
              const shown = await self.registration.getNotifications();
              const count = payload.unreadCount || Math.max(shown.length, 1);
              await self.navigator.setAppBadge(count);
              swLog('badge_set', count);
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

// Permet à l'app (onglet ouvert) de dire au SW de fermer les notifs actives dans
// le tiroir Android quand les messages sont lus depuis l'intérieur de l'app —
// sans ça, seul un tap direct sur la notif la ferme (notificationclick), et le
// badge géré automatiquement par Android reste bloqué tant que la notif traîne.
self.addEventListener('message', e => {
  if (e.data?.type === 'CLEAR_NOTIFICATIONS') {
    swLog('clear_notifications_requested', e.data.tag || 'momentum-msg');
    self.registration.getNotifications({ tag: e.data.tag || 'momentum-msg' })
      .then(notifs => notifs.forEach(n => n.close()));
  }
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
