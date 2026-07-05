// Pastille sur l'icône de l'app PWA (iOS 16.4+, PWA installée + permission notif
// acceptée). Android ignore setAppBadge et gère déjà un badge automatique via
// showNotification côté service worker — rien à faire ici pour Android.
export function clearAppBadge() {
  if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
    (navigator as any).clearAppBadge().catch(() => {});
  }
}
