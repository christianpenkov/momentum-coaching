'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { AppNotif } from '@/lib/useNotifications';
import RapportModal from '@/components/ui/RapportModal';
import { createClient } from '@/lib/supabase/client';

interface Props {
  notifs: AppNotif[];
  onClose: () => void;
  onRapportDone: () => void;
  onRefresh: () => void;
}

type RespondState = 'idle' | 'accepting' | 'declining' | 'done';

export default function NotifCenter({ notifs, onClose, onRapportDone, onRefresh }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [rapportNotif, setRapportNotif] = useState<AppNotif | null>(null);

  async function dismissCanceled(dbId: string) {
    const supabase = createClient();
    await supabase.from('client_notifications').update({ read_at: new Date().toISOString() }).eq('id', dbId);
    onRefresh();
  }

  // Ferme si clic dehors — désactivé si la modale rapport est ouverte
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (rapportNotif) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, rapportNotif]);

  function handleRapportDone() {
    setRapportNotif(null);
    onRapportDone();
  }

  return createPortal(
    <>
      {/* Overlay léger */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onClick={onClose} />

      {/* Panel top-right */}
      <div
        ref={ref}
        style={{
          position: 'fixed',
          top: 56,
          right: 16,
          width: 340,
          maxHeight: 'calc(100vh - 80px)',
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          zIndex: 2000,
          padding: '16px 0',
        }}
      >
        {/* En-tête */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Notifications</div>
          {notifs.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{notifs.length} en attente</span>
          )}
        </div>

        {/* Liste */}
        {notifs.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Aucune notification
          </div>
        ) : (
          <div style={{ padding: '8px 0' }}>
            {notifs.map(notif => (
              <NotifItem
                key={notif.id}
                notif={notif}
                onAction={() => {
                  if (notif.type === 'rapport_call') setRapportNotif(notif);
                }}
                onDismiss={notif.dbId ? () => dismissCanceled(notif.dbId!) : undefined}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom-sheet rapport ouvert depuis le centre de notifs */}
      {rapportNotif?.type === 'rapport_call' && rapportNotif.callId && (
        <RapportModal
          callId={rapportNotif.callId}
          inviteeName={rapportNotif.inviteeName ?? null}
          scheduledAt={rapportNotif.scheduledAt ?? null}
          onClose={handleRapportDone}
        />
      )}
    </>,
    document.body
  );
}

function NotifItem({ notif, onAction, onDismiss, onRefresh }: { notif: AppNotif; onAction: () => void; onDismiss?: () => void; onRefresh: () => void }) {
  const [respondState, setRespondState] = useState<RespondState>('idle');
  const isRapport = notif.type === 'rapport_call';
  const isCallRequest = notif.type === 'call_request';
  const isCanceled = notif.type === 'call_canceled';
  const isAccepted = notif.type === 'call_accepted';
  const isDeclined = notif.type === 'call_declined';
  const isCoachResponse = isAccepted || isDeclined;
  const accentColor = isRapport ? '#f59e0b' : isCanceled ? '#ef4444' : isAccepted ? '#22c55e' : isDeclined ? '#f97316' : 'var(--accent)';

  async function handleAccept() {
    if (!notif.callId) return;
    setRespondState('accepting');
    await fetch(`/api/calls/${notif.callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'accepted' }),
    });
    setRespondState('done');
    onRefresh();
  }

  async function handleDecline() {
    if (!notif.callId) return;
    setRespondState('declining');
    await fetch(`/api/calls/${notif.callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'declined' }),
    });
    setRespondState('done');
    onRefresh();
  }

  return (
    <div style={{
      padding: '12px 16px',
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      borderBottom: '1px solid var(--border)',
    }}>
      {/* Icône */}
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: isRapport ? '#f59e0b20' : isCallRequest ? 'var(--surface-2)' : isCanceled ? '#ef444420' : isAccepted ? '#22c55e20' : isDeclined ? '#f9731620' : 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={isCanceled || isDeclined ? 'x' : isCallRequest ? 'calendar' : isRapport ? 'video' : isAccepted ? 'check' : 'bell'} size={16} />
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 2 }}>{notif.title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{notif.body}</div>
        {notif.scheduledAt && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {new Date(notif.scheduledAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}
            {new Date(notif.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
        {isRapport && (
          <button type="button" onClick={onAction}
            style={{ marginTop: 10, fontSize: 12, fontWeight: 700, background: accentColor, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
            Remplir le rapport
          </button>
        )}
        {isCallRequest && respondState !== 'done' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={handleAccept} disabled={respondState !== 'idle'}
              style={{ fontSize: 12, fontWeight: 700, background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
              {respondState === 'accepting' ? '…' : 'Accepter'}
            </button>
            <button type="button" onClick={handleDecline} disabled={respondState !== 'idle'}
              style={{ fontSize: 12, fontWeight: 700, background: 'none', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
              {respondState === 'declining' ? '…' : 'Refuser'}
            </button>
          </div>
        )}
        {isCallRequest && respondState === 'done' && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Réponse envoyée</div>
        )}
        {(isCanceled || isCoachResponse) && onDismiss && (
          <button type="button" onClick={onDismiss}
            style={{ marginTop: 10, fontSize: 12, fontWeight: 700, background: accentColor, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
            OK, compris
          </button>
        )}
      </div>
    </div>
  );
}
