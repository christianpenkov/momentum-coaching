// Pastille sur l'icône de l'app PWA (iOS 16.4+, PWA installée + permission notif
// acceptée). Android ignore setAppBadge et gère déjà un badge automatique via
// showNotification côté service worker — rien à faire ici pour Android.
export function clearAppBadge() {
  if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
    (navigator as any).clearAppBadge().catch(() => {});
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
