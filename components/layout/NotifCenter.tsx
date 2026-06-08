'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { AppNotif } from '@/lib/useNotifications';
import RapportModal from '@/components/ui/RapportModal';

interface Props {
  notifs: AppNotif[];
  onClose: () => void;
  onRapportDone: () => void;
}

export default function NotifCenter({ notifs, onClose, onRapportDone }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [rapportNotif, setRapportNotif] = useState<AppNotif | null>(null);

  // Ferme si clic dehors
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

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

function NotifItem({ notif, onAction }: { notif: AppNotif; onAction: () => void }) {
  const isRapport = notif.type === 'rapport_call';

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
        background: isRapport ? '#f59e0b20' : 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={isRapport ? 'video' : 'bell'} size={16} />
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
              background: '#f59e0b', color: '#fff',
              border: 'none', borderRadius: 8, padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Remplir le rapport
          </button>
        )}
      </div>
    </div>
  );
}
