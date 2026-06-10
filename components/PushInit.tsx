'use client';

import { useEffect, useState } from 'react';
import { urlBase64ToUint8Array } from '@/lib/usePushNotifications';

const SUPABASE_URL = 'https://nvjgwtetyuatnkjihmtw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52amd3dGV0eXVhdG5ramlobXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzc3ODUsImV4cCI6MjA5NDYxMzc4NX0.0apyZEDUtM6LFBX5uDK5amD_jhKAgrYsZ61JSrA9gxk';

function swLog(event: string, data: string) {
  fetch(`${SUPABASE_URL}/rest/v1/sw_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ event, data, created_at: new Date().toISOString() }),
  }).catch(() => {});
}

export default function PushInit({ userId }: { userId: string }) {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // Log ce que iOS voit réellement
    const hasNotif = 'Notification' in window;
    const hasSW = 'serviceWorker' in navigator;
    const hasPush = 'PushManager' in window;
    const perm = hasNotif ? Notification.permission : 'unavailable';

    swLog('PushInit_mount', JSON.stringify({
      hasNotif, hasSW, hasPush, permission: perm,
      ua: navigator.userAgent.slice(0, 80),
    }));

    if (!hasNotif || !hasSW || !hasPush) {
      setSupported(false);
      return;
    }

    setPermission(Notification.permission);

    if (Notification.permission === 'granted') {
      silentRegister(userId);
    }
  }, [userId]);

  function handleClick() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    swLog('PushInit_click', 'bouton cloche tapé');

    Notification.requestPermission().then(async (perm) => {
      swLog('PushInit_permission_result', perm);
      setPermission(perm);
      if (perm !== 'granted') return;
      await silentRegister(userId);
    });
  }

  // Pas supporté = iOS < 16.4 ou pas standalone
  if (!supported) return null;
  // Déjà accordé ET subscription en base = pas besoin d'afficher
  // On laisse visible si 'default' ou 'denied' pour permettre re-souscription
  if (permission === 'granted') return null;

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
    await navigator.serviceWorker.register('/sw.js');
    const reg = await navigator.serviceWorker.ready;

    // Réutiliser la subscription existante si elle est valide — iOS génère un nouvel
    // endpoint à chaque unsubscribe/resubscribe, ce qui accumule des entrées en DB.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
    }

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
