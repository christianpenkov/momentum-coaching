'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import Avatar from '@/components/ui/Avatar';
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

// duration est toujours stocké au format "{N} min" — jamais "1h30" ou autre format
// (même convention que components/pages/coach/PageCalls.tsx).
function callEndTime(call: Call): number {
  const start = call.scheduled_at ? new Date(call.scheduled_at).getTime() : 0;
  const mins = call.duration ? parseInt(call.duration, 10) || 0 : 0;
  return start + mins * 60_000;
}

export default function CallStack({ calls, getClient }: Props) {
  // Recalcule le call "actif" chaque minute, pour que la transition se joue
  // automatiquement à l'heure de fin réelle sans action utilisateur.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const sorted = [...calls].sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const activeIndex = sorted.findIndex(c => callEndTime(c) >= nowTick);
  const active = activeIndex === -1 ? null : sorted[activeIndex];
  const previous = activeIndex > 0 ? sorted[activeIndex - 1] : null;

  if (sorted.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>Aucun call prévu aujourd'hui.</div>;
  }

  if (!active) {
    return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>Tous les calls du jour sont terminés.</div>;
  }

  const activeClient = getClient(active.client_id);
  const time = active.scheduled_at
    ? new Date(active.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div style={{ position: 'relative', paddingTop: previous ? 22 : 0 }}>
      <AnimatePresence mode="popLayout">
        {previous && (
          <motion.div
            key={`prev-${previous.id}`}
            initial={false}
            animate={{ opacity: 0.55, y: -14, scale: 0.92, rotateX: 35, filter: 'blur(3px)' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              transformOrigin: 'top center', transformPerspective: 600,
              pointerEvents: 'none',
            }}
          >
            <CallRow call={previous} client={getClient(previous.client_id)} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="popLayout">
        <motion.div
          key={active.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <CallRow call={active} client={activeClient} time={time} highlight />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function CallRow({ call, client, time, highlight }: {
  call: Call;
  client: ClientLite | undefined;
  time?: string;
  highlight?: boolean;
}) {
  const displayTime = time ?? (call.scheduled_at
    ? new Date(call.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', margin: '0 -8px',
      borderRadius: 10,
      background: highlight ? 'var(--accent-brand-soft)' : 'transparent',
      border: highlight ? '1px solid var(--accent-brand)' : '1px solid transparent',
    }}>
      <Avatar initials={client?.initials || '??'} avatarUrl={client?.avatar_url} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{client?.name || '—'}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{call.topic || 'Call coaching'}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{displayTime}</div>
      </div>
      {client && (
        <Link href={`/clients/${client.id}/brief`} className="btn-ghost" style={{ fontSize: 11, marginLeft: 4 }}>
          Brief
        </Link>
      )}
    </div>
  );
}
