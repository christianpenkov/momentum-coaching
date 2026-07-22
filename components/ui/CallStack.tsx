'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import { isCallReallyOver } from '@/lib/sessionRapport';
import type { Call } from '@/lib/supabase/types';

interface ClientLite {
  id: string;
  name: string;
  initials: string | null;
  avatar_url?: string | null;
}

interface Props {
  calls: Call[];
  getClient: (clientId: string | null) => ClientLite | undefined;
}

export default function CallStack({ calls, getClient }: Props) {
  // Recalcule quel call est "actif" chaque minute, pour que l'encadré se déplace
  // au bon call sans action utilisateur.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const sorted = [...calls].sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());

  if (sorted.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>Aucun call prévu aujourd'hui.</div>;
  }

  const activeIndex = sorted.findIndex(c => !isCallReallyOver(c, nowTick));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map((call, i) => {
        const isPast = activeIndex !== -1 ? i < activeIndex : true;
        const isActive = i === activeIndex;
        const client = getClient(call.client_id);
        const time = call.scheduled_at
          ? new Date(call.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          : '—';
        return (
          <div key={call.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', margin: '0 -8px',
            borderRadius: 10,
            opacity: isPast ? 0.8 : 1,
            background: isActive ? 'var(--accent-brand-soft)' : 'transparent',
            border: isActive ? '1px solid var(--accent-brand)' : '1px solid transparent',
          }}>
            <Avatar initials={client?.initials || '??'} avatarUrl={client?.avatar_url} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{client?.name || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{call.topic || 'Call coaching'}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{time}</div>
            </div>
            {client && (
              <Link href={`/clients/${client.id}/brief`} className="btn-ghost" style={{ fontSize: 11, marginLeft: 4 }}>
                Brief
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
