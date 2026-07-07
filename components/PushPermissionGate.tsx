'use client';

import { useEffect, useState } from 'react';
import { triggerPushSetup } from '@/lib/usePushNotifications';

// Une fois "Plus tard" cliqué, on ne réaffiche pas l'écran pour le reste de la session
// (sessionStorage — vidé à la fermeture complète de l'app/onglet). Réapparaît donc à
// chaque nouvelle ouverture tant que la permission n'est pas 'granted'.
const SKIP_KEY = 'push-gate-skipped-session';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * Écran plein bloquant qui force l'activation des notifications quand l'app est utilisée
 * en mode installé (ajoutée à l'écran d'accueil) — pas en simple onglet navigateur, où
 * l'utilisateur n'a pas forcément l'intention de recevoir des notifs.
 * "Plus tard" laisse passer une fois par session ; réapparaît à la prochaine ouverture
 * tant que Notification.permission n'est pas 'granted'.
 */
export default function PushPermissionGate({ userId }: { userId: string | null }) {
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!userId) return;
    if (!isStandalone()) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') { setDenied(true); setVisible(true); return; }
    if (sessionStorage.getItem(SKIP_KEY)) return;
    setVisible(true);
  }, [userId]);

  async function handleActivate() {
    if (!userId) return;
    setRequesting(true);
    await triggerPushSetup(userId);
    setRequesting(false);
    if (Notification.permission === 'granted') {
      setVisible(false);
    } else if (Notification.permission === 'denied') {
      setDenied(true);
    }
  }

  function handleSkip() {
    sessionStorage.setItem(SKIP_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'var(--bg)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%', background: 'var(--surface-2)',
        border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', marginBottom: 20,
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      </div>

      {denied ? (
        <>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
            Notifications désactivées
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 320, lineHeight: 1.6, marginBottom: 24 }}>
            Pour ne rater aucun message, active les notifications dans les réglages de ton téléphone :
            <br /><strong>Réglages → Notifications → Momentum → Autoriser</strong>
          </div>
          <button
            onClick={handleSkip}
            style={{ fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}
          >
            Continuer sans notifications
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
            Active les notifications
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 320, lineHeight: 1.6, marginBottom: 24 }}>
            Pour ne rater aucun message de ton coach, active les notifications sur cet appareil.
          </div>
          <button
            onClick={handleActivate}
            disabled={requesting}
            style={{
              padding: '11px 28px', fontSize: 14, fontWeight: 600, borderRadius: 10,
              background: 'var(--accent)', color: '#fff', border: 'none',
              cursor: requesting ? 'default' : 'pointer', opacity: requesting ? 0.7 : 1,
              marginBottom: 14,
            }}
          >
            {requesting ? 'Activation…' : 'Activer les notifications'}
          </button>
          <button
            onClick={handleSkip}
            style={{ fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}
          >
            Plus tard
          </button>
        </>
      )}
    </div>
  );
}
