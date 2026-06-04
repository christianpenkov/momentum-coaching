'use client';

import { useEffect, useState } from 'react';
import { urlBase64ToUint8Array } from '@/lib/usePushNotifications';

/**
 * Composant autonome de gestion des notifications push.
 * Monté dans le layout client — gère tout le flow :
 * 1. Enregistrement du SW
 * 2. Affichage du bouton si permission pas encore accordée
 * 3. requestPermission() synchrone au tap (requis iOS)
 * 4. Subscribe + save en base
 */
export default function PushInit({ userId }: { userId: string }) {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  // Initialisation : vérifier l'état de permission actuel
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    setPermission(Notification.permission);

    // Si déjà accordé, s'enregistrer silencieusement
    if (Notification.permission === 'granted') {
      silentRegister(userId);
    }
  }, [userId]);

  // Tap sur le bouton — requestPermission() doit être appelé ici,
  // dans un handler onClick NON-async (iOS exige la synchronicité du geste)
  function handleClick() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    Notification.requestPermission().then(async (perm) => {
      setPermission(perm);
      if (perm !== 'granted') return;
      await silentRegister(userId);
    });
  }

  // Visible seulement si permission pas encore traitée
  if (permission !== 'default') return null;

  return (
    <button
      onClick={handleClick}
      title="Activer les notifications"
      style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        border: '1px solid var(--border)', background: 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
    </button>
  );
}

async function silentRegister(userId: string) {
  try {
    // S'assurer que le SW est enregistré et actif
    await navigator.serviceWorker.register('/sw.js');
    const reg = await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    });

    const subJson = sub.toJSON();
    console.log('[PushInit] Subscription endpoint:', sub.endpoint.slice(0, 50) + '...');

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subJson, userId }),
    });

    console.log('[PushInit] ✅ Subscription sauvegardée');
  } catch (err) {
    console.error('[PushInit] ❌ Erreur:', err);
  }
}
