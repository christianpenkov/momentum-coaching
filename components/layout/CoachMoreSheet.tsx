'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon, { IconName } from '../ui/Icon';

const MORE_NAV: { href: string; icon: IconName; label: string }[] = [
  { href: '/analytics', icon: 'bar-chart', label: 'Analytics' },
  { href: '/calendar', icon: 'calendar', label: 'Calendrier' },
  { href: '/ressources', icon: 'folder', label: 'Ressources' },
  { href: '/ai', icon: 'sparkle', label: 'Assistant IA' },
  { href: '/settings', icon: 'settings', label: 'Réglages' },
];

export default function CoachMoreSheet({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1999, background: 'rgba(0,0,0,0.25)' }} onClick={onClose} />
      <div
        ref={sheetRef}
        style={{
          position: 'fixed',
          left: 0, right: 0, bottom: 0,
          zIndex: 2000,
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        <div style={{ padding: '4px 8px 8px' }}>
          {MORE_NAV.map(({ href, icon, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={`nav-item${active ? ' active' : ''}`}
                style={{ padding: '14px 12px', fontSize: 15 }}
              >
                <Icon name={icon} size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>,
    document.body
  );
}
