'use client';

import { useEffect, useState } from 'react';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import Icon from '@/components/ui/Icon';
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
  // Reçoit l'objet call complet (pas juste client_id) — nécessaire côté élève où
  // client_id est identique pour tous les calls (l'élève lui-même) et où le vrai
  // "interlocuteur" à afficher dépend du call_type (coach vs prospect Calendly).
  getClient: (call: Call) => ClientLite | undefined;
  // Affiche une icône "Rejoindre" cliquable quand le call a un lien de visio.
  // Désactivé par défaut pour garder "Calls du jour" (accueils coach/élève) compact.
  showJoinButton?: boolean;
}

export default function CallStack({ calls, getClient, showJoinButton }: Props) {
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
        const client = getClient(call);
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
            <Avatar initials={client?.initials || getInitials(client?.name)} avatarUrl={client?.avatar_url} size={36} seed={client?.id} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{client?.name || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{call.topic || 'Call coaching'}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              {call.status === 'pending_acceptance' && (
                <span style={{ fontSize: 10, padding: '3px 8px', background: '#fef3c7', color: '#92400e', borderRadius: 20, fontWeight: 700, border: '1px solid #fde68a', whiteSpace: 'nowrap' }}>
                  Réponse en attente
                </span>
              )}
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{time}</div>
              {showJoinButton && (call.join_url || call.meet_link) && (
                <a
                  href={call.join_url || call.meet_link || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  aria-label="Rejoindre le call"
                  title="Rejoindre le call"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'var(--accent-brand)', color: '#fff', flexShrink: 0,
                  }}
                >
                  <Icon name="phone-call" size={13} />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
