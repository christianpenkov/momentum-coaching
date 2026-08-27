// Pastille sur l'icône de l'app PWA (iOS 16.4+, PWA installée + permission notif
// acceptée). Android ignore setAppBadge et déduit son badge des notifs actives
// dans le tiroir — d'où le postMessage au SW ci-dessous pour les fermer.
//
// ── Pourquoi un compteur agrégé ────────────────────────────────────────────
// Deux sources indépendantes alimentent la pastille : les notifications de la
// cloche (useNotifications) et les messages non lus (useUnreadMessagesCount).
// Chacune appelait `setAppBadge(sonPropreTotal)`, donc la dernière à parler
// ÉCRASAIT l'autre. Concrètement : un message non lu posait la pastille via le
// push, puis le premier rafraîchissement de la cloche — qui n'a aucune notif à
// signaler — la remettait à zéro. La pastille disparaissait alors que le
// message n'avait jamais été lu.
//
// Les deux sources déclarent désormais leur compte séparément, et c'est la
// SOMME qui est posée. Une source qui tombe à zéro n'efface plus l'autre.

type BadgeSource = 'notifs' | 'messages';

const counts: Record<BadgeSource, number> = { notifs: 0, messages: 0 };

// Une source n'est prise en compte qu'une fois qu'elle a VRAIMENT parlé.
//
// Sans ce garde, `counts` valant {0, 0} au démarrage du module, la moindre
// application de la pastille avant la fin du premier chargement des données
// concluait « rien en attente » et EFFAÇAIT une pastille pourtant légitime —
// celle posée par un push pendant que l'app était fermée. Un simple démarrage à
// froid suffisait donc à la faire disparaître.
const reported: Record<BadgeSource, boolean> = { notifs: false, messages: false };

// Dernier total réellement posé, pour ne fermer les notifications du tiroir
// qu'au moment où l'on PASSE à zéro. Le faire à chaque application d'un total
// nul revenait à balayer le tiroir toutes les 60 secondes (rythme du refresh) :
// une notification reçue app ouverte était refermée dans la minute.
let lastAppliedTotal: number | null = null;

// Total partagé avec le service worker via IndexedDB — seul stockage accessible
// aux deux. L'API Badging ne permet pas de relire la pastille : sans cette
// trace, le service worker qui reçoit un push app fermée ne peut qu'écraser le
// total par une valeur devinée (voir sw.js, badgeStore). L'application écrit
// donc la vérité chaque fois qu'elle la calcule, et le worker se contente
// d'incrémenter à partir de là.
// On écrit les DEUX compteurs, jamais leur somme : les pushs de messagerie
// portent `unreadCount`, qui ne concerne que les messages. Le worker doit
// pouvoir remplacer ce compteur-là sans perdre celui de la cloche.
function persistBadgeCounts(snapshot: Record<BadgeSource, number>) {
  if (typeof indexedDB === 'undefined') return;
  try {
    const req = indexedDB.open('momentum-badge', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ ...snapshot }, 'counts');
      } catch { /* stockage indisponible : la pastille reste correcte tant que
                  l'app est ouverte, seul l'incrément hors ligne est perdu */ }
    };
    req.onerror = () => {};
  } catch { /* idem */ }
}

function applyBadge() {
  if (typeof navigator === 'undefined') return;
  // Tant qu'aucune source n'a répondu, on ne sait rien : ne rien affirmer.
  if (!reported.notifs && !reported.messages) return;

  const total = counts.notifs + counts.messages;
  const previous = lastAppliedTotal;
  lastAppliedTotal = total;
  // Ecrit AVANT de poser la pastille : c'est de cet etat que partira le service
  // worker au prochain push recu app fermee.
  persistBadgeCounts(counts);

  if (total <= 0) {
    if ('clearAppBadge' in navigator) {
      (navigator as any).clearAppBadge().catch(() => {});
    }
    // Android : ferme les notifs actives dans le tiroir (sinon le badge, déduit
    // par le système du nombre de notifs présentes, reste bloqué même une fois
    // le message lu dans l'app). Uniquement sur la TRANSITION vers zéro.
    if (previous !== 0 && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_NOTIFICATIONS' });
    }
    return;
  }

  if ('setAppBadge' in navigator) {
    (navigator as any).setAppBadge(total).catch(() => {});
  }
}

/**
 * Déclare le compte d'UNE source. La pastille affiche la somme de toutes les
 * sources — appeler ceci avec 0 n'efface que sa propre contribution.
 */
export function setBadgeCount(source: BadgeSource, count: number) {
  counts[source] = Math.max(0, count);
  reported[source] = true;
  applyBadge();
}

/**
 * Repose la pastille avec les comptes déjà connus, sans les recalculer.
 *
 * iOS efface la pastille d'une PWA de son propre chef : redémarrage du
 * téléphone, purge mémoire, ou simplement plusieurs jours sans ouvrir l'app.
 * Rien ne la rétablit tout seul. On la réaffirme donc à chaque retour au
 * premier plan, pour qu'elle survive indéfiniment tant qu'il reste quelque
 * chose à traiter.
 *
 * Sans effet tant qu'aucune source n'a communiqué son compte : au démarrage à
 * froid, `pageshow` se déclenche AVANT que les données soient chargées, et
 * réaffirmer un total de zéro à cet instant effacerait la pastille posée par un
 * push reçu app fermée. On ne réaffirme que ce que l'on sait.
 */
export function reassertAppBadge() {
  applyBadge();
}

/**
 * Efface la pastille de TOUTES les sources.
 *
 * À n'utiliser que quand il est certain que plus rien n'est en attente — pas
 * pour signaler qu'une seule source est retombée à zéro (utiliser
 * `setBadgeCount(source, 0)` dans ce cas).
 */
export function clearAppBadge() {
  counts.notifs = 0;
  counts.messages = 0;
  // Effacement explicite : c'est une affirmation (« plus rien en attente »),
  // pas une absence d'information — les deux sources comptent donc comme ayant
  // parlé, sans quoi le garde de `applyBadge` bloquerait l'effacement demandé.
  reported.notifs = true;
  reported.messages = true;
  applyBadge();
}

/**
 * Ferme les notifications encore affichées dans le tiroir Android, SANS toucher
 * au compteur de la pastille.
 *
 * Utile après avoir marqué un message lu depuis l'intérieur de l'app : Android
 * déduit son badge des notifications présentes, il faut donc les fermer. Mais
 * le nombre restant à traiter, lui, est recalculé par les hooks — l'effacer ici
 * supprimerait aussi les notifications de la cloche encore en attente.
 */
const DISMISS_THROTTLE_MS = 3000;
let lastDismissAt = 0;

export function dismissDrawerNotifications() {
  if (typeof navigator === 'undefined') return;
  if (!navigator.serviceWorker?.controller) return;

  // Étranglé volontairement. L'appelant est `markMessageRead`, déclenché par
  // l'IntersectionObserver de CHAQUE bulle : ouvrir une conversation de trente
  // messages non lus émettait trente ordres en deux secondes, et le service
  // worker écrivait une ligne en base pour chacun (43 000 lignes accumulées en
  // deux semaines pour un seul testeur).
  //
  // Fermer le tiroir est idempotent : le refaire trente fois d'affilée ne ferme
  // rien de plus. Un ordre par salve suffit.
  const now = Date.now();
  if (now - lastDismissAt < DISMISS_THROTTLE_MS) return;
  lastDismissAt = now;

  navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_NOTIFICATIONS' });
}

/**
 * @deprecated Utiliser `setBadgeCount('notifs', n)`. Conservé pour ne pas
 * casser un appel oublié : se comporte comme la source 'notifs'.
 */
export function setAppBadge(count: number) {
  setBadgeCount('notifs', count);
}
