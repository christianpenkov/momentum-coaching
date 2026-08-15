'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUnreadMessagesCount } from '@/lib/useUnreadMessagesCount';

const MORE_ROUTES = ['/client/liens', '/client/taches', '/client/ressources', '/client/settings', '/client/calendar-mobile'];

const NAV = [
  {
    href: '/client',
    label: 'Accueil',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    href: '/client/messages',
    label: 'Messages',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    href: '/client/calls',
    label: 'Calls',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    ),
  },
];

export default function BottomNav({ onMoreClick }: { onMoreClick: () => void }) {
  const pathname = usePathname();
  const unreadCount = useUnreadMessagesCount();
  const isMoreActive = MORE_ROUTES.some(r => pathname.startsWith(r));

  return (
    <nav className="bottom-nav" role="navigation" aria-label="Navigation principale">
      {NAV.map(item => {
        const isActive = item.href === '/client'
          ? pathname === '/client'
          : pathname.startsWith(item.href);
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
            {item.href === '/client/messages' && unreadCount > 0 && (
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
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
          <circle cx="5" cy="12" r="1.6" />
        </svg>
        <span className="bnav-label">Plus</span>
      </button>
    </nav>
  );
}
