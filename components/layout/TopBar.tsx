'use client';

import { useRouter, usePathname } from 'next/navigation';
import Icon from '../ui/Icon';

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const isCoach = !pathname.startsWith('/espace');

  return (
    <div className="topbar">
      <div className="topbar-brand">
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, flexShrink: 0 }}>
          {/* Halo ambiant CSS — pas de clip */}
          <span style={{
            position: 'absolute',
            inset: -10,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(160,160,155,0.45) 0%, rgba(160,160,155,0.12) 50%, transparent 72%)',
            pointerEvents: 'none',
          }} />
          <svg width="36" height="36" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="16" y="16" width="168" height="168" rx="38" fill="#EBEBEB"/>
            <circle cx="100" cy="100" r="56" stroke="#2E2E2E" strokeWidth="8" fill="none"/>
            <circle cx="100" cy="100" r="34" stroke="#2E2E2E" strokeWidth="8" fill="none"/>
            <circle cx="100" cy="100" r="12" fill="#2E2E2E"/>
          </svg>
        </span>
        <span className="topbar-logo">ORBIT</span>
        <span className="topbar-tagline">Plateforme coaching</span>
      </div>

      <div className="view-switcher">
        <button
          className={`view-btn${isCoach ? ' active' : ''}`}
          onClick={() => router.push('/dashboard')}
          type="button"
        >
          <Icon name="star" size={13} />
          Coach
        </button>
        <button
          className={`view-btn${!isCoach ? ' active' : ''}`}
          onClick={() => router.push('/espace')}
          type="button"
        >
          <Icon name="users" size={13} />
          Élève
        </button>
      </div>

      <div className="topbar-right">
        <button className="icon-btn" title="Notifications" type="button">
          <Icon name="bell" size={16} />
        </button>
        <button className="icon-btn" title="Aide" type="button">
          <Icon name="help" size={16} />
        </button>
        <div className="avatar" style={{ width: 30, height: 30, fontSize: 11, cursor: 'pointer' }}>
          ML
        </div>
      </div>
    </div>
  );
}
