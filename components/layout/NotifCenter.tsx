'use client';

import { useEffect, useRef, useState } from 'react';
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

function NotifItem({ notif, onAction, onDismiss }: { notif: AppNotif; onAction: () => void; onDismiss?: () => void }) {
  const isRapport = notif.type === 'rapport_call';
  const isCallRequest = notif.type === 'call_request';
  const isCanceled = notif.type === 'call_canceled';
  const isAccepted = notif.type === 'call_accepted';
  const isDeclined = notif.type === 'call_declined';
  const isCoachResponse = isAccepted || isDeclined;
  const accentColor = isRapport ? '#f59e0b' : isCallRequest ? '#3b82f6' : isCanceled ? '#ef4444' : isAccepted ? '#22c55e' : isDeclined ? '#f97316' : 'var(--accent)';

  const WrapTag = isCallRequest ? 'a' : 'div';
  const wrapProps = isCallRequest ? { href: '/client/calls', style: { textDecoration: 'none', color: 'inherit', display: 'block' } } : {};

  return (
    <WrapTag {...(wrapProps as any)}>
    <div style={{
      padding: '12px 16px',
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      borderBottom: '1px solid var(--border)',
      cursor: isCallRequest ? 'pointer' : 'default',
      background: isCallRequest ? 'transparent' : undefined,
      transition: isCallRequest ? 'background 0.15s' : undefined,
    }}
    onMouseEnter={isCallRequest ? e => (e.currentTarget.style.background = '#3b82f608') : undefined}
    onMouseLeave={isCallRequest ? e => (e.currentTarget.style.background = 'transparent') : undefined}
    >
      {/* Icône */}
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: isRapport ? '#f59e0b20' : isCallRequest ? '#3b82f620' : isCanceled ? '#ef444420' : isAccepted ? '#22c55e20' : isDeclined ? '#f9731620' : 'var(--surface-2)',
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
          <button
            type="button"
            onClick={onAction}
            style={{
              marginTop: 10, fontSize: 12, fontWeight: 700,
              background: accentColor, color: '#fff',
              border: 'none', borderRadius: 8, padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Remplir le rapport
          </button>
        )}
        {isCallRequest && (
          <a
            href="/client/calls"
            style={{
              display: 'inline-block', marginTop: 10, fontSize: 12, fontWeight: 700,
              background: accentColor, color: '#fff',
              border: 'none', borderRadius: 8, padding: '6px 14px',
              cursor: 'pointer', textDecoration: 'none',
            }}
          >
            Répondre →
          </a>
        )}
        {(isCanceled || isCoachResponse) && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            style={{
              marginTop: 10, fontSize: 12, fontWeight: 700,
              background: accentColor, color: '#fff',
              border: 'none', borderRadius: 8, padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            OK, compris
          </button>
        )}
      </div>
    </div>
    </WrapTag>
  );
}
