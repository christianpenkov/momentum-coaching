// Pastille sur l'icône de l'app PWA (iOS 16.4+, PWA installée + permission notif
// acceptée). Android ignore setAppBadge et déduit son badge des notifs actives
// dans le tiroir — d'où le postMessage au SW ci-dessous pour les fermer.
export function clearAppBadge() {
  if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
    (navigator as any).clearAppBadge().catch(() => {});
  }
  // Android : ferme les notifs actives dans le tiroir (sinon le badge, déduit par
  // le système du nombre de notifs présentes, reste bloqué même message lu dans l'app).
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_NOTIFICATIONS' });
  }
}

// Pose le badge au nombre exact de notifs en attente (ou l'efface si 0) — à
// appeler à chaque refresh() de useNotifications, pas seulement quand tout est
// traité. Sans ça, le badge posé par un push (toujours 1, faute d'unreadCount
// dans le payload) reste bloqué jusqu'à ce que la dernière notif soit traitée.
export function setAppBadge(count: number) {
  if (typeof navigator === 'undefined') return;
  if (count <= 0) { clearAppBadge(); return; }
  if ('setAppBadge' in navigator) {
    (navigator as any).setAppBadge(count).catch(() => {});
  }
}
