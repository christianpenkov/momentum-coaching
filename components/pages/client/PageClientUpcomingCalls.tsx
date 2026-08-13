'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useMemo } from 'react';
import { useClientSelfData } from '@/lib/supabase/useCoachData';
import { useClientAllCalls } from '@/lib/supabase/useClientAllCalls';
import { toDateKey } from '@/lib/calendarGrid';
import CallStack from '@/components/ui/CallStack';
import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import type { Call } from '@/lib/supabase/types';

function isCoachingCall(call: { call_type?: string | null } | null | undefined) {
  return call?.call_type === 'google';
}

function daysUntil(dateStr: string) {
  const now = new Date();
  const target = new Date(dateStr);
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

export default function PageClientUpcomingCalls() {
  const { data: client, loading } = useClientSelfData();
  const { calls, loading: callsLoading } = useClientAllCalls(
    client && client.profile_id ? { id: client.id, profile_id: client.profile_id } : null
  );

  function getCallCounterpart(call: Call) {
    if (isCoachingCall(call)) {
      return { id: 'coach', name: client!.coachFullName || client!.coachName || 'Coach', initials: null, avatar_url: client!.coachAvatarUrl };
    }
    const name = call.invitee_name || 'Prospect';
    return { id: call.id, name, initials: getInitials(name), avatar_url: null };
  }

  const todayKey = toDateKey(new Date());

  // Liste groupée par jour : garde tous les calls du jour même passés (cohérence
  // visuelle avec "Aujourd'hui"), mais le nextCall du bandeau doit être strictement
  // à venir — sinon un call de 22h déjà passé reste affiché comme "prochain call"
  // toute la journée au lieu de sauter au suivant réellement futur.
  const upcomingCalls = useMemo(() => {
    return calls
      .filter(c => c.scheduled_at && toDateKey(new Date(c.scheduled_at)) >= todayKey)
      .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  }, [calls, todayKey]);

  const nextCall = useMemo(() => {
    const now = Date.now();
    return calls
      .filter(c => c.scheduled_at && new Date(c.scheduled_at).getTime() >= now)
      .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0] ?? null;
  }, [calls]);

  const groups = useMemo(() => {
    const tomorrowKey = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return toDateKey(t); })();
    return upcomingCalls.reduce((acc, call) => {
      const key = toDateKey(new Date(call.scheduled_at!));
      const last = acc[acc.length - 1];
      if (!last || last.key !== key) {
        const d = new Date(key + 'T12:00:00');
        const label = key === todayKey ? "Aujourd'hui" : key === tomorrowKey ? 'Demain' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        acc.push({ key, label, calls: [call] });
      } else {
        last.calls.push(call);
      }
      return acc;
    }, [] as { key: string; label: string; calls: Call[] }[]);
  }, [upcomingCalls, todayKey]);

  if (loading || callsLoading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>;

  return (
    <div className="page-content" style={{ maxWidth: 560, width: '100%', margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Calls</h1>
          <p className="page-sub">{upcomingCalls.length} call{upcomingCalls.length !== 1 ? 's' : ''} à venir</p>
        </div>
      </div>

      {nextCall && (
        <div style={{
          background: 'var(--accent-soft)', border: '1px solid var(--accent)30',
          borderRadius: 12, padding: '14px 20px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar
              initials={getCallCounterpart(nextCall).initials || getInitials(getCallCounterpart(nextCall).name)}
              avatarUrl={getCallCounterpart(nextCall).avatar_url}
              size={40}
              seed={getCallCounterpart(nextCall).id}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Prochain call</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {new Date(nextCall.scheduled_at!).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                {' à '}
                {new Date(nextCall.scheduled_at!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                {nextCall.topic ? ` · ${nextCall.topic}` : ''}
              </div>
            </div>
            <span className="pill pill-green" style={{ fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}>
              {(() => {
                const d = daysUntil(nextCall.scheduled_at!);
                if (d <= 0) return "Aujourd'hui";
                if (d === 1) return 'Demain';
                return `J-${d}`;
              })()}
            </span>
          </div>
          {(nextCall.join_url || nextCall.meet_link) && (
            <a
              href={nextCall.join_url || nextCall.meet_link || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary-brand"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, marginTop: 12, padding: '10px 16px' }}
            >
              <Icon name="phone-call" size={14} />
              Rejoindre le call
            </a>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📞</div>
          Aucun call à venir
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map(({ key, label, calls: groupCalls }) => (
            <div key={key} className="card">
              <div className="eyebrow-lg" style={{ color: key === todayKey ? 'var(--accent)' : 'var(--muted)', marginBottom: 4 }}>
                {label}
              </div>
              <CallStack calls={groupCalls} getClient={getCallCounterpart} showJoinButton />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
