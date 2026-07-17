'use client';

import { usePathname } from 'next/navigation';
import Image from 'next/image';
import Icon from '../ui/Icon';
import { useUser } from '@/lib/UserContext';
import { useState } from 'react';
import { useNotifications } from '@/lib/useNotifications';
import NotifCenter from './NotifCenter';
import { useGlobalCoachPresence } from '@/lib/GlobalPresenceContext';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

export default function TopBar() {
  const pathname = usePathname();
  const isCoach = !pathname.startsWith('/client/') && pathname !== '/client';
  const { user } = useUser();
  const initials = user?.initials || '';
  const name = user?.full_name || user?.email || '';

  const [notifOpen, setNotifOpen] = useState(false);
  const { notifs, refresh } = useNotifications(user?.id ?? null, !isCoach);

  return (
    <div className="topbar">
      <div className="topbar-brand">
        <Image src="/logo-momentum.png" alt="Momentum" width={44} height={44} style={{ flexShrink: 0, objectFit: 'contain' }} />
        <span className="topbar-logo">Momentum</span>
        <span className="topbar-tagline">{isCoach ? 'Espace coach' : 'Espace élève'}</span>
        {isCoach && <OnlineIndicator />}
      </div>

      <div className="topbar-right">
        <button
          className="icon-btn"
          title={notifs.length > 0 ? `${notifs.length} notification${notifs.length > 1 ? 's' : ''}` : 'Notifications'}
          type="button"
          onClick={() => setNotifOpen(v => !v)}
          style={{ position: 'relative' }}
        >
          <Icon name="bell" size={16} />
          {notifs.length > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 2,
              minWidth: 16, height: 16, borderRadius: 8,
              background: '#f59e0b', color: '#fff',
              fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, padding: '0 3px',
            }}>
              {notifs.length}
            </span>
          )}
        </button>

        <div className="avatar" style={{ width: 30, height: 30, fontSize: 11, cursor: 'pointer' }} title={name}>
          {initials || '?'}
        </div>
      </div>

      {notifOpen && (
        <NotifCenter
          notifs={notifs}
          onClose={() => setNotifOpen(false)}
          onRapportDone={() => { refresh(); setNotifOpen(false); }}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

// Indicateur "N en ligne" — dérivé de la présence globale déjà maintenue par
// GlobalPresenceCoachProvider (un canal Realtime par élève, monté une seule fois dans le
// layout coach). On ne crée jamais de canal supplémentaire ici, seulement une lecture agrégée.
function OnlineIndicator() {
  const { clients } = useSupabaseClients();
  const { isClientOnline } = useGlobalCoachPresence();
  const onlineCount = clients.filter(c => isClientOnline(c.id)).length;
  if (onlineCount === 0) return null;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--accent-brand)', fontWeight: 500, marginLeft: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-brand)', animation: 'pulse 2.2s ease-in-out infinite' }} />
      {onlineCount} en ligne
    </span>
  );
}
