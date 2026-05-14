'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon, { IconName } from '../ui/Icon';

const NAV: { href: string; icon: IconName; label: string }[] = [
  { href: '/dashboard', icon: 'activity', label: 'Aujourd\'hui' },
  { href: '/analytics', icon: 'bar-chart', label: 'Analytics' },
  { href: '/clients', icon: 'users', label: 'Clients' },
  { href: '/messages', icon: 'message-circle', label: 'Messages' },
  { href: '/calls', icon: 'phone-call', label: 'Calls' },
  { href: '/resources', icon: 'folder', label: 'Ressources' },
];

const NAV_BOTTOM: { href: string; icon: IconName; label: string }[] = [
  { href: '/settings', icon: 'settings', label: 'Réglages' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {NAV.map(({ href, icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link key={href} href={href} className={`nav-item${active ? ' active' : ''}`}>
              <Icon name={icon} size={16} />
              <span>{label}</span>
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
          <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>ML</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Marc Laurent</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Coach · 12 élèves</div>
          </div>
        </div>
      </nav>
    </aside>
  );
}
