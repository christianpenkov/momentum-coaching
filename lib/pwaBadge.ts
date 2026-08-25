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

function applyBadge() {
  if (typeof navigator === 'undefined') return;
  const total = counts.notifs + counts.messages;

  if (total <= 0) {
    if ('clearAppBadge' in navigator) {
      (navigator as any).clearAppBadge().catch(() => {});
    }
    // Android : ferme les notifs actives dans le tiroir (sinon le badge, déduit
    // par le système du nombre de notifs présentes, reste bloqué même une fois
    // le message lu dans l'app).
    if (navigator.serviceWorker?.controller) {
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
export function dismissDrawerNotifications() {
  if (typeof navigator === 'undefined') return;
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_NOTIFICATIONS' });
  }
}

/**
 * @deprecated Utiliser `setBadgeCount('notifs', n)`. Conservé pour ne pas
 * casser un appel oublié : se comporte comme la source 'notifs'.
 */
export function setAppBadge(count: number) {
  setBadgeCount('notifs', count);
}
