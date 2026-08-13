'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useMemo, useState } from 'react';
import { useClientSelfData } from '@/lib/supabase/useCoachData';
import { useClientAllCalls } from '@/lib/supabase/useClientAllCalls';
import { toDateKey } from '@/lib/calendarGrid';
import MonthCalendarGrid from '@/components/ui/MonthCalendarGrid';
import CallStack from '@/components/ui/CallStack';
import { getInitials } from '@/components/ui/Avatar';
import type { Call } from '@/lib/supabase/types';

function isCoachingCall(call: { call_type?: string | null } | null | undefined) {
  return call?.call_type === 'google';
}

export default function PageClientCalendarMobile() {
  const { data: client, loading } = useClientSelfData();
  const { calls, loading: callsLoading } = useClientAllCalls(
    client && client.profile_id ? { id: client.id, profile_id: client.profile_id } : null
  );
  const [cursor, setCursor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  function getCallCounterpart(call: Call) {
    if (isCoachingCall(call)) {
      return { id: 'coach', name: client!.coachFullName || client!.coachName || 'Coach', initials: null, avatar_url: client!.coachAvatarUrl };
    }
    const name = call.invitee_name || 'Prospect';
    return { id: call.id, name, initials: getInitials(name), avatar_url: null };
  }

  const callsByDate = useMemo(() => {
    const map: Record<string, Call[]> = {};
    calls.forEach(call => {
      if (!call.scheduled_at) return;
      const key = toDateKey(new Date(call.scheduled_at));
      if (!map[key]) map[key] = [];
      map[key].push(call);
    });
    return map;
  }, [calls]);

  const selectedCalls = selectedDay ? (callsByDate[selectedDay] || []) : [];

  if (loading || callsLoading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>;

  return (
    <div className="page-content" style={{ maxWidth: 480, width: '100%', margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendrier</h1>
        </div>
      </div>

      <MonthCalendarGrid
        cursor={cursor}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        onPrevMonth={() => { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); setCursor(d); }}
        onNextMonth={() => { const d = new Date(cursor); d.setMonth(d.getMonth() + 1); setCursor(d); }}
        callsByDate={callsByDate}
      />

      {selectedDay && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedDay(null); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 480, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
            </div>
            <div className="card-title" style={{ marginBottom: 4, textTransform: 'capitalize' }}>
              {new Date(selectedDay + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            {selectedCalls.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 0', textAlign: 'center' }}>Rien ce jour.</div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <CallStack calls={selectedCalls} getClient={getCallCounterpart} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
