'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useEscapeKey } from '@/lib/useEscapeKey';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { AppNotif } from '@/lib/useNotifications';
import RapportModal from '@/components/ui/RapportModal';
import SessionRapportModal from '@/components/ui/SessionRapportModal';
import { createClient } from '@/lib/supabase/client';

interface Props {
  notifs: AppNotif[];
  onClose: () => void;
  onRapportDone: () => void;
  onRefresh: () => void;
}

type RespondState = 'idle' | 'accepting' | 'declining' | 'done' | 'stale';

export default function NotifCenter({ notifs, onClose, onRapportDone, onRefresh }: Props) {
  useEscapeKey(onClose);
  const ref = useRef<HTMLDivElement>(null);
  const [rapportNotif, setRapportNotif] = useState<AppNotif | null>(null);
  const [sessionRapportNotif, setSessionRapportNotif] = useState<AppNotif | null>(null);

  async function dismissCanceled(dbId: string) {
    const supabase = createClient();
    await supabase.from('client_notifications').update({ read_at: new Date().toISOString() }).eq('id', dbId);
    onRefresh();
  }

  // Ferme si clic dehors — désactivé si une modale rapport est ouverte
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (rapportNotif || sessionRapportNotif) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, rapportNotif, sessionRapportNotif]);

  function handleRapportDone() {
    setRapportNotif(null);
    onRapportDone();
  }

  function handleSessionRapportDone() {
    setSessionRapportNotif(null);
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
                  if (notif.type === 'session_rapport') setSessionRapportNotif(notif);
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

      {sessionRapportNotif?.type === 'session_rapport' && sessionRapportNotif.callId && (
        <SessionRapportModal
          callId={sessionRapportNotif.callId}
          studentName={sessionRapportNotif.inviteeName ?? null}
          scheduledAt={sessionRapportNotif.scheduledAt ?? null}
          topic={sessionRapportNotif.topic ?? null}
          onClose={handleSessionRapportDone}
        />
      )}
    </>,
    document.body
  );
}

function NotifItem({ notif, onAction, onDismiss, onRefresh }: { notif: AppNotif; onAction: () => void; onDismiss?: () => void; onRefresh: () => void }) {
  const [respondState, setRespondState] = useState<RespondState>('idle');
  const isRapport = notif.type === 'rapport_call';
  const isSessionRapport = notif.type === 'session_rapport';
  const isCallRequest = notif.type === 'call_request';
  const isCanceled = notif.type === 'call_canceled';
  const isRescheduled = notif.type === 'call_rescheduled';
  const isAccepted = notif.type === 'call_accepted';
  const isDeclined = notif.type === 'call_declined';
  const isRapportReady = notif.type === 'rapport_ready';
  const isCoachResponse = isAccepted || isDeclined;
  const accentColor = (isRapport || isSessionRapport || isRapportReady) ? 'var(--accent-brand)' : isCanceled ? '#ef4444' : isRescheduled ? '#f59e0b' : isAccepted ? '#22c55e' : isDeclined ? '#f97316' : 'var(--accent)';

  async function handleAccept() {
    if (!notif.callId) return;
    setRespondState('accepting');
    const res = await fetch(`/api/calls/${notif.callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'accepted' }),
    });
    setRespondState(res.ok ? 'done' : 'stale');
    onRefresh();
  }

  async function handleDecline() {
    if (!notif.callId) return;
    setRespondState('declining');
    const res = await fetch(`/api/calls/${notif.callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'declined' }),
    });
    setRespondState(res.ok ? 'done' : 'stale');
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
        background: (isRapport || isSessionRapport || isRapportReady) ? 'var(--accent-brand-soft)' : isCallRequest ? 'var(--surface-2)' : isCanceled ? '#ef444420' : isAccepted ? '#22c55e20' : isDeclined ? '#f9731620' : 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={isCanceled || isDeclined ? 'x' : isCallRequest ? 'calendar' : (isRapport || isSessionRapport || isRapportReady) ? 'video' : isAccepted ? 'check' : 'bell'} size={16} />
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Badge de type — mêmes couleurs que la carte de l'accueil coach (PageToday),
            pour que ce soit lu comme le même objet d'un écran à l'autre. Ici il lève une
            ambiguïté réelle : la cloche est le seul écran où un rapport de coaching et un
            rapport de vente s'empilent dans la même liste, et les titres seuls
            ("Rapport de session" / "Rapport de call") se ressemblent trop pour trancher. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{notif.title}</div>
          {(isRapport || isSessionRapport) && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, flexShrink: 0,
              background: isSessionRapport ? 'var(--surface-2)' : 'var(--accent-brand-soft)',
              color: isSessionRapport ? 'var(--accent)' : 'var(--accent-brand)',
            }}>
              {isSessionRapport ? 'Coaching' : 'Prospect'}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{notif.body}</div>
        {notif.scheduledAt && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {new Date(notif.scheduledAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}
            {new Date(notif.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
        {(isRapport || isSessionRapport) && (
          <button type="button" onClick={onAction}
            style={{ marginTop: 10, fontSize: 12, fontWeight: 700, background: accentColor, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
            Remplir le rapport
          </button>
        )}
        {isCallRequest && respondState !== 'done' && respondState !== 'stale' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={handleAccept} disabled={respondState !== 'idle'}
              style={{ fontSize: 12, fontWeight: 700, background: 'var(--accent-brand)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
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
        {isCallRequest && respondState === 'stale' && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Déjà traité ailleurs</div>
        )}
        {(isCanceled || isCoachResponse || isRapportReady) && onDismiss && (
          <button type="button" onClick={onDismiss}
            style={{ marginTop: 10, fontSize: 12, fontWeight: 700, background: accentColor, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>
            OK, compris
          </button>
        )}
      </div>
    </div>
  );
}
