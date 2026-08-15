'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon, { IconName } from '../ui/Icon';
import Avatar, { getInitials } from '../ui/Avatar';
import { useUser } from '@/lib/UserContext';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { useUnreadMessagesCount } from '@/lib/useUnreadMessagesCount';
import { useOnboardingWizard } from '@/components/onboarding/OnboardingWizardContext';

const NAV: { href: string; icon: IconName; label: string; highlight?: boolean }[] = [
  { href: '/dashboard', icon: 'activity', label: 'Aujourd\'hui' },
  { href: '/analytics', icon: 'bar-chart', label: 'Stats Clients' },
  { href: '/clients', icon: 'users', label: 'Clients' },
  { href: '/pipeline', icon: 'target', label: 'Pipeline' },
  { href: '/liens', icon: 'link', label: 'Mes liens' },
  { href: '/mes-stats', icon: 'trending-up', label: 'Mes Stats' },
  { href: '/messages', icon: 'message-circle', label: 'Messages' },
  { href: '/calls', icon: 'phone-call', label: 'Calls' },
  { href: '/calendar', icon: 'calendar', label: 'Calendrier' },
  { href: '/tasks', icon: 'task-check', label: 'Tâches' },
  { href: '/ressources', icon: 'folder', label: 'Ressources' },
  // Assistant IA temporairement masqué de la nav — page/route conservées.
  // { href: '/ai', icon: 'sparkle', label: 'Assistant IA', highlight: true },
];

const NAV_BOTTOM: { href: string; icon: IconName; label: string }[] = [
  { href: '/settings', icon: 'settings', label: 'Réglages' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const { clients } = useSupabaseClients();
  const unreadCount = useUnreadMessagesCount();
  const { openWizard } = useOnboardingWizard();

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {NAV.map(({ href, icon, label, highlight }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link key={href} href={href} className={`nav-item${active ? ' active' : ''}`} style={highlight && !active ? { color: 'var(--accent-brand)' } : undefined}>
              <Icon name={icon} size={16} />
              <span>{label}</span>
              {highlight && !active && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--accent-brand)', color: '#fff', borderRadius: 4, padding: '1px 5px', marginLeft: 'auto' }}>IA</span>}
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
        <button
          type="button"
          className="nav-item"
          onClick={openWizard}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
        >
          <Icon name="help" size={16} />
          <span>Guide de démarrage</span>
        </button>
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
          <Avatar initials={user?.initials || getInitials(user?.full_name)} avatarUrl={user?.avatar_url} size={30} seed={user?.id} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{user?.full_name || user?.email || '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Coach · {clients.length} élève{clients.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </nav>
    </aside>
  );
}
