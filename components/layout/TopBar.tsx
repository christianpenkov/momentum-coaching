'use client';

import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import Icon from '../ui/Icon';

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const isCoach = !pathname.startsWith('/espace');

  return (
    <div className="topbar">
      <div className="topbar-brand">
        <Image src="/logo.svg" alt="ORBIT" width={28} height={28} style={{ flexShrink: 0 }} />
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
