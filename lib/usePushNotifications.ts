'use client';

import { useEffect, useRef } from 'react';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

/**
 * Obtient un service worker ACTIF, sans attendre passivement.
 *
 * navigator.serviceWorker.ready n'a aucun délai d'expiration : au tout premier
 * lancement de la PWA — précisément quand l'écran d'activation des
 * notifications s'affiche — le worker n'est pas encore activé et la promesse
 * peut ne jamais se résoudre. S'appuyer dessus revenait à faire patienter
 * l'utilisateur sans raison.
 *
 * On force donc l'enregistrement nous-mêmes (idempotent : si le worker est déjà
 * là, le navigateur renvoie l'enregistrement existant sans rien réinstaller) et
 * on écoute `statechange` pour repartir dès la seconde où il devient actif,
 * plutôt que d'attendre un signal global.
 *
 * Le délai n'est plus qu'un dernier filet, jamais le chemin normal.
 */
function serviceWorkerReady(timeoutMs = 8000): Promise<ServiceWorkerRegistration | null> {
  const activated = (async () => {
    // Enregistrement immédiat : ne dépend pas de l'événement 'load' du
    // document, qui peut arriver bien après le geste de l'utilisateur.
    const reg = await navigator.serviceWorker.register('/sw.js');

    if (reg.active) return reg;

    // Un worker en cours d'installation : on suit sa progression et on repart
    // dès qu'il est activé, au lieu d'attendre .ready.
    const pending = reg.installing || reg.waiting;
    if (pending) {
      await new Promise<void>(resolve => {
        if (pending.state === 'activated') return resolve();
        pending.addEventListener('statechange', function onChange() {
          if (pending.state === 'activated') {
            pending.removeEventListener('statechange', onChange);
            resolve();
          }
        });
      });
      return reg;
    }

    // Cas résiduel : ni actif ni en installation. .ready tranchera.
    return navigator.serviceWorker.ready;
  })();

  return Promise.race([
    activated,
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]).catch(() => null);
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

    // Réenvoyé au serveur À CHAQUE ouverture, même quand `getSubscription()`
    // renvoyait déjà un abonnement. L'abonnement présent sur le téléphone ne
    // prouve pas que le serveur le connaît encore : il a pu être supprimé côté
    // base (purge, 410 sur un envoi transitoire, changement de compte). Sans ce
    // renvoi systématique, le client se croyait abonné à vie et plus aucun push
    // — donc plus aucune pastille — n'arrivait jamais, silencieusement.
    // La route est idempotente (upsert sur profile_id+endpoint) : la réémettre
    // à chaque lancement ne coûte qu'une requête.
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
  // Horodatage du dernier enregistrement RÉUSSI, et non plus un simple booléen
  // « déjà tenté ». Un booléen posé avant l'appel condamnait la session entière
  // dès le premier échec (SW pas encore actif, réseau coupé au lancement) : plus
  // jamais de nouvelle tentative, donc plus jamais de push ni de pastille.
  const lastOkRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    // Une PWA reste montée des jours en arrière-plan : sans revalidation au
    // retour, une subscription révoquée par iOS pendant l'absence n'était
    // jamais rétablie. C'est le scénario exact de la pastille qui disparaît
    // après une semaine sans ouvrir l'app.
    const REVALIDATE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 h

    async function ensureRegistered(force = false) {
      if (inFlightRef.current) return;
      if (!force && Date.now() - lastOkRef.current < REVALIDATE_AFTER_MS) return;
      inFlightRef.current = true;
      try {
        const ok = await registerPush(userId!);
        // Seul un succès pose l'horodatage : un échec laisse la porte ouverte
        // à la prochaine occasion (retour au premier plan, remontage).
        if (ok) lastOkRef.current = Date.now();
      } finally {
        inFlightRef.current = false;
      }
    }

    ensureRegistered(true);

    function onVisibility() {
      if (document.visibilityState === 'visible') ensureRegistered();
    }
    document.addEventListener('visibilitychange', onVisibility);
    // `pageshow` couvre le retour depuis le bfcache iOS, où `visibilitychange`
    // ne se déclenche pas toujours.
    window.addEventListener('pageshow', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
    };
  }, [userId]);
}
