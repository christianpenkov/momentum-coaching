'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon, { IconName } from '../ui/Icon';
import { useUser } from '@/lib/UserContext';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { useUnreadMessagesCount } from '@/lib/useUnreadMessagesCount';

const NAV: { href: string; icon: IconName; label: string; highlight?: boolean }[] = [
  { href: '/dashboard', icon: 'activity', label: 'Aujourd\'hui' },
  { href: '/analytics', icon: 'bar-chart', label: 'Analytics' },
  { href: '/clients', icon: 'users', label: 'Clients' },
  { href: '/messages', icon: 'message-circle', label: 'Messages' },
  { href: '/calls', icon: 'phone-call', label: 'Calls' },
  { href: '/calendar', icon: 'calendar', label: 'Calendrier' },
  { href: '/ressources', icon: 'folder', label: 'Ressources' },
  { href: '/ai', icon: 'sparkle', label: 'Assistant IA', highlight: true },
];

const NAV_BOTTOM: { href: string; icon: IconName; label: string }[] = [
  { href: '/settings', icon: 'settings', label: 'Réglages' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const { clients } = useSupabaseClients();
  const unreadCount = useUnreadMessagesCount();

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {NAV.map(({ href, icon, label, highlight }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link key={href} href={href} className={`nav-item${active ? ' active' : ''}`} style={highlight && !active ? { color: 'var(--accent)' } : undefined}>
              <Icon name={icon} size={16} />
              <span>{label}</span>
              {highlight && !active && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--accent)', color: 'var(--bg)', borderRadius: 4, padding: '1px 5px', marginLeft: 'auto' }}>IA</span>}
              {href === '/messages' && unreadCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--red)', color: '#fff', borderRadius: 999, minWidth: 16, height: 16, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <nav className="sidebar-nav sidebar-nav-bottom">
        {NAV_BOTTOM.map(({ href, icon, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} className={`nav-item${active ? ' active' : ''}`}>
              <Icon name={icon} size={16} />
              <span>{label}</span>
            </Link>
          );
        })}
        <div className="sidebar-coach-info">
          <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{user?.initials || '?'}</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{user?.full_name || user?.email || '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Coach · {clients.length} élève{clients.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </nav>
    </aside>
  );
}
