'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import Icon from '../ui/Icon';
import { createClient } from '@/lib/supabase/client';

export default function TopBar() {
  const pathname = usePathname();
  const isCoach = !pathname.startsWith('/client');
  const [initials, setInitials] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
      const fullName = profile?.full_name || user.email || '';
      setName(fullName);
      const parts = fullName.trim().split(' ');
      setInitials(parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : fullName.slice(0, 2).toUpperCase());
    }
    load();
  }, []);

  return (
    <div className="topbar">
      <div className="topbar-brand">
        <Image src="/logo-momentum.png" alt="Momentum" width={44} height={44} style={{ flexShrink: 0, objectFit: 'contain' }} />
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
