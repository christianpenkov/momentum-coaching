'use client';

import { useEffect, useRef } from 'react';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function registerPush(userId: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  // Sur iOS, si la permission est déjà accordée on peut s'enregistrer silencieusement.
  // Si elle est 'default', on ne demande PAS automatiquement (iOS bloque les demandes
  // sans geste utilisateur). L'enregistrement se fera via triggerPushSetup() au 1er envoi.
  if (Notification.permission === 'denied') return;

  if (Notification.permission === 'default') return; // attendre geste utilisateur

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    });

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), userId }),
    });
  } catch { /* silencieux */ }
}

// Appelé depuis un geste utilisateur (envoi de message) pour demander la permission iOS
export async function triggerPushSetup(userId: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission === 'denied') return;

  try {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
    }
    await registerPush(userId);
  } catch { /* silencieux */ }
}

export function usePushNotifications(userId: string | null) {
  const done = useRef(false);

  useEffect(() => {
    if (!userId || done.current) return;
    done.current = true;
    registerPush(userId);
  }, [userId]);
}
