'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon, { IconName } from '../ui/Icon';
import Onboarding from '../ui/Onboarding';

const NAV: { href: string; icon: IconName; label: string; highlight?: boolean }[] = [
  { href: '/espace', icon: 'activity', label: 'Mon espace' },
  { href: '/espace/stats', icon: 'bar-chart', label: 'Mes stats' },
  { href: '/espace/messages', icon: 'message-circle', label: 'Messages' },
  { href: '/espace/calls', icon: 'phone-call', label: 'Prochain call' },
  { href: '/espace/calendar', icon: 'calendar', label: 'Calendrier' },
  { href: '/espace/resources', icon: 'folder', label: 'Ressources' },
  { href: '/espace/ai', icon: 'sparkle', label: 'Assistant IA', highlight: true },
];

const NAV_BOTTOM: { href: string; icon: IconName; label: string }[] = [
  { href: '/espace/settings', icon: 'settings', label: 'Réglages' },
];

export default function SidebarClient() {
  const pathname = usePathname();
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  return (
    <>
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {NAV.map(({ href, icon, label, highlight }) => {
          const active = pathname === href || (href !== '/espace' && pathname.startsWith(href));
          return (
            <Link key={href} href={href} className={`nav-item${active ? ' active' : ''}`} style={highlight && !active ? { color: 'var(--accent)' } : undefined}>
              <Icon name={icon} size={16} />
              <span>{label}</span>
              {highlight && !active && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--accent)', color: 'var(--bg)', borderRadius: 4, padding: '1px 5px', marginLeft: 'auto' }}>IA</span>}
            </Link>
          );
        })}
      </nav>

      <nav className="sidebar-nav sidebar-nav-bottom">
        <button
          type="button"
          className="nav-item"
          onClick={() => setOnboardingOpen(true)}
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
          <div className="avatar" style={{ width: 30, height: 30, fontSize: 11, background: 'var(--green)' }}>TM</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Thomas M.</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Élève · Semaine 8</div>
          </div>
        </div>
      </nav>
    </aside>
    <Onboarding open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
    </>
  );
}
