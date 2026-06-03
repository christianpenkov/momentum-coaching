'use client';

import { usePathname } from 'next/navigation';
import Image from 'next/image';
import Icon from '../ui/Icon';
import { useUser } from '@/lib/UserContext';

export default function TopBar() {
  const pathname = usePathname();
  const isCoach = !pathname.startsWith('/client');
  const { user } = useUser();
  const initials = user?.initials || '';
  const name = user?.full_name || user?.email || '';

  return (
    <div className="topbar">
      <div className="topbar-brand">
        <Image src="/logo-momentum.png" alt="Momentum" width={62} height={62} style={{ flexShrink: 0, objectFit: 'contain' }} />
        <span className="topbar-logo">Momentum</span>
        <span className="topbar-tagline">{isCoach ? 'Espace coach' : 'Espace élève'}</span>
      </div>

      <div className="topbar-right">
        <button className="icon-btn" title="Notifications" type="button">
          <Icon name="bell" size={16} />
        </button>
        <div className="avatar" style={{ width: 30, height: 30, fontSize: 11, cursor: 'pointer' }} title={name}>
          {initials || '?'}
        </div>
      </div>
    </div>
  );
}
