'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUnreadMessagesCount } from '@/lib/useUnreadMessagesCount';

const MORE_ROUTES = ['/calendar', '/ressources', '/settings'];

const NAV = [
  {
    href: '/dashboard',
    label: 'Aujourd\'hui',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    href: '/clients',
    label: 'Clients',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/messages',
    label: 'Messages',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: '/calls',
    label: 'Calls',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    ),
  },
];

export default function BottomNavCoach({ onMoreClick }: { onMoreClick: () => void }) {
  const pathname = usePathname();
  const unreadCount = useUnreadMessagesCount();
  const isMoreActive = MORE_ROUTES.some(r => pathname.startsWith(r));

  return (
    <nav className="bottom-nav bottom-nav-coach" role="navigation" aria-label="Navigation principale coach">
      {NAV.map(item => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`bottom-nav-item${isActive ? ' active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            style={{ position: 'relative' }}
          >
            {item.icon}
            <span className="bnav-label">{item.label}</span>
            {item.href === '/messages' && unreadCount > 0 && (
              <span style={{ position: 'absolute', top: 2, right: '30%', width: 8, height: 8, borderRadius: '50%', background: 'var(--red)' }} />
            )}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMoreClick}
        className={`bottom-nav-item${isMoreActive ? ' active' : ''}`}
        aria-current={isMoreActive ? 'page' : undefined}
        style={{ background: 'none', border: 'none', font: 'inherit', margin: 0, appearance: 'none' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
        <span className="bnav-label">Plus</span>
      </button>
    </nav>
  );
}
