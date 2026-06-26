'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon, { IconName } from '../ui/Icon';
import Onboarding from '../ui/Onboarding';
import { useUser } from '@/lib/UserContext';
import { createClient } from '@/lib/supabase/client';

const NAV: { href: string; icon: IconName; label: string; highlight?: boolean }[] = [
  { href: '/client', icon: 'activity', label: 'Mon espace' },
  { href: '/client/stats', icon: 'bar-chart', label: 'Mes stats' },
  { href: '/client/pipeline', icon: 'trending-up', label: 'Pipeline Leads' },
  { href: '/client/messages', icon: 'message-circle', label: 'Messages' },
  { href: '/client/calls', icon: 'phone-call', label: 'Prochain call' },
  { href: '/client/calendar', icon: 'calendar', label: 'Calendrier' },
  { href: '/client/ressources', icon: 'folder', label: 'Ressources' },
];

const NAV_BOTTOM: { href: string; icon: IconName; label: string }[] = [
  { href: '/client/liens', icon: 'link', label: 'Gérer mes liens' },
  { href: '/client/settings', icon: 'settings', label: 'Réglages' },
];

export default function SidebarClient() {
  const pathname = usePathname();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const { user } = useUser();
  const [week, setWeek] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase.from('clients').select('week').eq('profile_id', user.id).single()
      .then(({ data }) => { if (data) setWeek(data.week); });
  }, [user?.id]);

  return (
    <>
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {NAV.map(({ href, icon, label, highlight }) => {
          const active = pathname === href || (href !== '/client' && pathname.startsWith(href));
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
          <div className="avatar" style={{ width: 30, height: 30, fontSize: 11, background: 'var(--green)' }}>
            {user?.initials || '??'}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{user?.full_name || '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Élève{week ? ` · Semaine ${week}` : ''}</div>
          </div>
        </div>
      </nav>
    </aside>
    <Onboarding open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
    </>
  );
}
