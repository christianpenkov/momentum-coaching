// SW v15 — push + coquille hors ligne + pastille persistante
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

// ── Compteur de pastille partage avec l'application ────────────────────────
//
// L'API Badging ne permet PAS de relire la valeur courante de la pastille. Le
// service worker, qui ne voit que le tiroir de notifications, ne pouvait donc
// que poser un nombre devine — et comme les notifications de messagerie
// partagent un tag (elles se remplacent l'une l'autre), il n'en voyait jamais
// qu'une seule : il ecrasait « 6 en attente » par « 1 ».
//
// L'etat est donc range dans IndexedDB, seul stockage accessible AUX DEUX.
// L'application y ecrit la verite chaque fois qu'elle la calcule ; le service
// worker part de la pendant qu'elle est fermee. A la reouverture, l'application
// recalcule et corrige.
//
// On range les DEUX sources separement, jamais leur somme. Les pushs de
// messagerie transportent `unreadCount`, qui ne compte QUE les messages non lus
// (voir app/api/push/webhook/route.ts) : l'appliquer comme total ecrasait les
// notifications de la cloche — six notifications plus deux messages affichaient
// « 2 ». En gardant les deux compteurs, le worker remplace celui que le serveur
// lui donne et conserve l'autre.
const BADGE_DB = 'momentum-badge';
const BADGE_STORE = 'kv';
const BADGE_KEY = 'counts';

function badgeStore(mode, value) {
  return new Promise(resolve => {
    let req;
    try { req = indexedDB.open(BADGE_DB, 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(BADGE_STORE)) {
        req.result.createObjectStore(BADGE_STORE);
      }
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      let tx;
      try {
        tx = db.transaction(BADGE_STORE, mode === 'read' ? 'readonly' : 'readwrite');
      } catch { return resolve(null); }
      const store = tx.objectStore(BADGE_STORE);
      if (mode === 'read') {
        const g = store.get(BADGE_KEY);
        g.onsuccess = () => {
          const r = g.result;
          resolve(r && typeof r === 'object'
            ? { notifs: Number(r.notifs) || 0, messages: Number(r.messages) || 0 }
            : null);
        };
        g.onerror = () => resolve(null);
      } else {
        store.put(value, BADGE_KEY);
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => resolve(null);
      }
    };
  });
}

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
  swLog('install', { msg: 'SW v15 installing', ts: Date.now() });
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
              // On INCREMENTE le total connu au lieu d'en deviner un nouveau.
              //
              // Compter les notifications du tiroir ne marchait pas : elles
              // partagent un tag et se remplacent, donc le compte valait
              // toujours 1 — six notifications en attente devenaient « 1 » des
              // qu'un septieme message arrivait. La valeur precedente n'est pas
              // relisable depuis l'API Badging, d'ou le total range dans
              // IndexedDB par l'application (voir badgeStore plus haut).
              //
              // `unreadCount` ne vaut QUE pour les messages : c'est le nombre de
              // messages non lus calcule par le serveur (push/webhook). Il
              // remplace donc le compteur « messages » et laisse le compteur
              // « notifs » intact, au lieu d'ecraser le total comme avant.
              const previous = await badgeStore('read') || { notifs: 0, messages: 0 };
              const next = {
                notifs: previous.notifs,
                messages: typeof payload.unreadCount === 'number'
                  ? payload.unreadCount
                  : previous.messages + 1,
              };
              const count = next.notifs + next.messages;
              await self.navigator.setAppBadge(count);
              await badgeStore('write', next);
              swLog('badge_set', { count, previous, next });
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
    const tag = e.data.tag || 'momentum-msg';
    self.registration.getNotifications({ tag })
      .then(notifs => {
        // On ne journalise QUE si quelque chose a reellement ete ferme. L'ordre
        // etait auparavant trace a chaque reception, y compris quand le tiroir
        // etait deja vide — soit la quasi-totalite des 43 000 lignes accumulees
        // en deux semaines. Un journal doit enregistrer les evenements, pas les
        // non-evenements.
        if (notifs.length === 0) return;
        swLog('clear_notifications_requested', { tag, closed: notifs.length });
        notifs.forEach(n => n.close());
      });
  }
});

// ── Rotation de l'abonnement par le navigateur ──────────────────────────────
//
// Le navigateur peut remplacer un abonnement de sa propre initiative (rotation
// de cle, expiration interne). Sans cet ecouteur, l'ancien endpoint reste seul
// connu du serveur : les envois partent dans le vide jusqu'a la prochaine
// ouverture de l'app, ou `registerPush` finit par renvoyer le nouveau.
//
// C'est le mecanisme standard pour eviter ce trou (RFC 8030 / spec Push API).
// iOS ne declenche PAS encore cet evenement — la revalidation a chaque
// ouverture reste donc le filet de securite la-bas — mais Chrome et Firefox
// Android le font, et la base contient des endpoints FCM et Mozilla.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const ancien = e.oldSubscription?.endpoint || null;

      // La cle de l'ancien abonnement quand elle est disponible, sinon celle du
      // serveur : `oldSubscription` est absent dans plusieurs implementations.
      let cle = e.oldSubscription?.options?.applicationServerKey || null;
      if (!cle) {
        const rep = await fetch('/api/push/vapid');
        if (!rep.ok) throw new Error('vapid indisponible');
        cle = urlBase64ToUint8Array((await rep.json()).cle);
      }

      const nouveau = e.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: cle,
      });

      // `credentials: 'include'` : la route identifie le profil par le cookie de
      // session. Sans lui, la requete arrive anonyme et se fait refuser.
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: nouveau.toJSON(), ancienEndpoint: ancien }),
      });
      swLog('subscription_rotee', { ok: res.ok, statut: res.status });
    } catch (err) {
      // Journalise sans relancer : l'app rattrapera a la prochaine ouverture.
      swLog('subscription_rotation_echec', String(err));
    }
  })());
});

// Conversion de la cle publique VAPID (base64 URL-safe) en octets, attendue par
// `pushManager.subscribe`. Meme fonction que cote application.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

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
