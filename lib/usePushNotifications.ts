'use client';

import { useEffect, useRef } from 'react';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

/**
 * navigator.serviceWorker.ready n'a AUCUN délai d'expiration : tant que le
 * service worker n'est pas activé, la promesse ne se résout jamais. C'est le
 * cas juste après l'installation de la PWA — exactement le moment où l'écran
 * d'activation des notifications s'affiche. Sans borne de temps, l'appelant
 * reste bloqué en « Activation… » indéfiniment.
 */
function serviceWorkerReady(timeoutMs = 8000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/**
 * @returns true si l'abonnement push est bien enregistré côté serveur.
 * L'appelant a besoin de cette information pour savoir s'il peut passer à la
 * suite : avant, la fonction ne renvoyait rien et avalait toutes les erreurs.
 */
async function registerPush(userId: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  // Sur iOS, si la permission est déjà accordée on peut s'enregistrer silencieusement.
  // Si elle est 'default', on ne demande PAS automatiquement (iOS bloque les demandes
  // sans geste utilisateur). L'enregistrement se fera via triggerPushSetup() au 1er envoi.
  if (Notification.permission === 'denied') return false;

  if (Notification.permission === 'default') return false; // attendre geste utilisateur

  try {
    const reg = await serviceWorkerReady();
    if (!reg) return false; // SW pas encore actif : on n'insiste pas, on débloque l'UI

    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    });

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), userId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Appelé depuis un geste utilisateur (envoi de message) pour demander la permission iOS
/**
 * @returns 'granted' si la permission est accordée (que l'abonnement serveur
 * ait abouti ou non — il sera retenté au prochain lancement par
 * usePushNotifications), 'denied' si refusée, 'unsupported' sinon.
 *
 * L'appelant doit pouvoir débloquer son interface dans tous les cas : la
 * version précédente ne renvoyait rien, donc l'écran d'activation ne savait
 * jamais quoi faire quand l'enregistrement traînait.
 */
export async function triggerPushSetup(userId: string): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';

  try {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'unsupported';
    }
    // L'échec de l'abonnement serveur ne doit pas bloquer l'utilisateur : la
    // permission système est accordée, c'est ce qui compte pour continuer.
    // usePushNotifications réessaiera à chaque ouverture de l'app.
    await registerPush(userId);
    return 'granted';
  } catch {
    // Permission accordée mais abonnement en échec : on laisse passer.
    return Notification.permission === 'granted' ? 'granted' : 'unsupported';
  }
}

export function usePushNotifications(userId: string | null) {
  const done = useRef(false);

  useEffect(() => {
    if (!userId || done.current) return;
    done.current = true;
    registerPush(userId);
  }, [userId]);
}
