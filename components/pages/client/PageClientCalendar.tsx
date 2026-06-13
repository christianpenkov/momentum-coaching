'use client';
import PageLoader from '@/components/ui/PageLoader';

import { useState, useMemo, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { useClientSelfData } from '@/lib/supabase/useCoachData';
import { createClient } from '@/lib/supabase/client';
import type { Call } from '@/lib/supabase/types';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateKey(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

const DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

interface CalEvent {
  date: string;
  type: 'call' | 'deadline';
  label: string;
  time?: string;
  ready?: string;
  priority?: string;
}

export default function PageClientCalendar() {
  const { data: client, loading } = useClientSelfData();
  const [calls, setCalls] = useState<Call[]>([]);
  const [cursor, setCursor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(toDateKey(new Date()));
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [declineModal, setDeclineModal] = useState<{ callId: string; topic: string; scheduledAt: string } | null>(null);
  const [proposedAt, setProposedAt] = useState('');
  const supabase = createClient();

  useEffect(() => {
    if (!client) return;
    const load = async () => {
      // Calls Calendly : coach_id = profileId de l'élève
      const { data: integ } = await supabase.from('integrations')
        .select('connected_at').eq('profile_id', client.profile_id).eq('provider', 'calendly').maybeSingle();
      const connectedAt: string | null = integ?.connected_at ?? null;

      let calendlyQuery = supabase.from('calls').select('*')
        .eq('coach_id', client.profile_id)
        .not('calendly_event_uuid', 'is', null)
        .neq('status', 'cancelled')
        .neq('status', 'canceled')
        .order('scheduled_at', { ascending: true });
      if (connectedAt) calendlyQuery = calendlyQuery.gte('scheduled_at', connectedAt);
      const { data: calendlyCalls } = await calendlyQuery;

      // Calls Google Calendar : client_id = client.id
      const { data: googleCalls } = await supabase.from('calls').select('*')
        .eq('client_id', client.id)
        .is('calendly_event_uuid', null)
        .order('scheduled_at', { ascending: true });

      const all = [...(calendlyCalls || []), ...(googleCalls || [])];
      const seen = new Set<string>();
      setCalls(all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; }) as Call[]);
    };
    load();
  }, [client?.id]);

  async function handleAccept(callId: string) {
    setRespondingId(callId);
    const res = await fetch(`/api/calls/${callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'accepted' }),
    });
    if (res.ok) setCalls(prev => prev.map(c => c.id === callId ? { ...c, status: 'active' } : c));
    setRespondingId(null);
  }

  async function handleDecline(callId: string, proposed: string) {
    setRespondingId(callId);
    await fetch(`/api/calls/${callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'declined', proposedAt: proposed || undefined }),
    });
    setCalls(prev => prev.map(c => c.id === callId ? { ...c, status: 'declined' } : c));
    setRespondingId(null);
    setDeclineModal(null);
    setProposedAt('');
  }

  const pendingCalls = calls.filter(c => c.status === 'pending_acceptance');

  const events = useMemo<CalEvent[]>(() => {
    const evs: CalEvent[] = [];
    calls.forEach(call => {
      if (!call.scheduled_at) return;
      const d = new Date(call.scheduled_at);
      evs.push({
        date: toDateKey(d),
        type: 'call',
        label: call.topic || 'Call coaching',
        time: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        ready: call.ready,
      });
    });
    (client?.tasks || []).forEach(task => {
      if (!task.deadline || task.done) return;
      evs.push({
        date: task.deadline,
        type: 'deadline',
        label: task.label,
        priority: task.priority || undefined,
      });
    });
    return evs;
  }, [calls, client]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    events.forEach(ev => {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    });
    return map;
  }, [events]);

  const monthDays = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;
    const days: (Date | null)[] = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [cursor]);

  const todayKey = toDateKey(new Date());
  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];
  const isMobile = useIsMobile();

  if (loading) return <PageLoader />;

  const nextCall = calls.find(c => c.status === 'active' && c.scheduled_at && new Date(c.scheduled_at) >= new Date());

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mon calendrier</h1>
          <p className="page-sub">
            {calls.filter(c => c.scheduled_at && new Date(c.scheduled_at) >= new Date()).length} calls à venir
            · {(client?.tasks || []).filter(t => t.deadline && !t.done).length} deadlines
          </p>
        </div>
      </div>

      {/* Demandes de call en attente */}
      {pendingCalls.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            {pendingCalls.length} demande{pendingCalls.length > 1 ? 's' : ''} en attente
          </div>
          {pendingCalls.map(call => {
            const d = new Date(call.scheduled_at!);
            const dateStr = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
            const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return (
              <div key={call.id} className="card" style={{ borderLeft: '4px solid #f59e0b', padding: '16px 18px', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>TON COACH TE PROPOSE UN CALL</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', textTransform: 'capitalize' }}>{dateStr}</div>
                <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 2, marginBottom: 4 }}>
                  {timeStr}
                  {call.duration && <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>· {call.duration}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{call.topic || 'Call coaching'}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => handleAccept(call.id)}
                    disabled={respondingId === call.id}
                    style={{ flex: 1, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                  >
                    <Icon name="check" size={13} />
                    {respondingId === call.id ? '…' : 'Accepter'}
                  </button>
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={() => setDeclineModal({ callId: call.id, topic: call.topic || 'Call coaching', scheduledAt: call.scheduled_at! })}
                    disabled={respondingId === call.id}
                    style={{ flex: 1, fontSize: 13, color: 'var(--red)' }}
                  >
                    Refuser
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Prochain call banner */}
      {nextCall && (
        <div style={{
          background: 'var(--accent-soft)', border: '1px solid var(--accent)30',
          borderRadius: 12, padding: '14px 20px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 24 }}>📞</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Prochain call</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {new Date(nextCall.scheduled_at!).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' à '}
              {new Date(nextCall.scheduled_at!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              {nextCall.topic ? ` · ${nextCall.topic}` : ''}
            </div>
          </div>
          <span className={`pill pill-${nextCall.ready === 'ready' ? 'green' : 'amber'}`} style={{ fontSize: 11 }}>
            {nextCall.ready === 'ready' ? 'Prêt' : 'En attente'}
          </span>
        </div>
      )}

      {/* Vue liste mobile — événements à venir triés chronologiquement */}
      {isMobile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events
            .filter(ev => ev.date >= todayKey)
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, 20)
            .reduce((acc, ev) => {
              const last = acc[acc.length - 1];
              if (!last || last.date !== ev.date) acc.push({ date: ev.date, evs: [ev] });
              else last.evs.push(ev);
              return acc;
            }, [] as { date: string; evs: CalEvent[] }[])
            .map(({ date, evs }) => {
              const d = new Date(date + 'T12:00:00');
              const isToday = date === todayKey;
              const isTomorrow = date === (() => { const t = new Date(); t.setDate(t.getDate() + 1); return toDateKey(t); })();
              const label = isToday ? "Aujourd'hui" : isTomorrow ? 'Demain' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
              return (
                <div key={date}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: isToday ? 'var(--accent)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, paddingLeft: 2 }}>
                    {label}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {evs.map((ev, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: ev.type === 'call' ? 'var(--accent-soft)' : 'var(--surface)', border: `1px solid ${ev.type === 'call' ? 'var(--border)' : 'var(--border)'}` }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: ev.type === 'call' ? 'var(--accent)' : 'var(--amber-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ev.type === 'call' ? '#fff' : 'var(--amber)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {ev.type === 'call'
                              ? <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></>
                              : <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>
                            }
                          </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{ev.label}</div>
                          {ev.time && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ev.time}</div>}
                        </div>
                        {ev.type === 'call' && ev.ready && (
                          <span className={`pill pill-${ev.ready === 'ready' ? 'green' : 'amber'}`} style={{ fontSize: 10, flexShrink: 0 }}>
                            {ev.ready === 'ready' ? 'Prêt' : 'En attente'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          {events.filter(ev => ev.date >= todayKey).length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📅</div>
              Aucun événement à venir
            </div>
          )}
        </div>
      )}

      {/* Vue calendrier desktop */}
      {!isMobile && <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
        {/* Calendrier */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <button type="button" className="btn-ghost" style={{ padding: '6px 10px' }} onClick={() => { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); setCursor(d); }}>
              <Icon name="chevR" size={14} style={{ transform: 'scaleX(-1)' }} />
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
              {MONTHS_FR[cursor.getMonth()]} {cursor.getFullYear()}
            </span>
            <button type="button" className="btn-ghost" style={{ padding: '6px 10px' }} onClick={() => { const d = new Date(cursor); d.setMonth(d.getMonth() + 1); setCursor(d); }}>
              <Icon name="chevR" size={14} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
            {DAYS_FR.map(d => (
              <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {monthDays.map((day, i) => {
              if (!day) return <div key={`e-${i}`} style={{ minHeight: 72, borderRight: i % 7 !== 6 ? '1px solid var(--border)' : 'none', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }} />;
              const key = toDateKey(day);
              const dayEvents = eventsByDate[key] || [];
              const isToday = key === todayKey;
              const isSelected = key === selectedDay;
              return (
                <div key={key} onClick={() => setSelectedDay(key)} style={{
                  minHeight: 72, padding: '6px 8px',
                  borderRight: i % 7 !== 6 ? '1px solid var(--border)' : 'none',
                  borderBottom: '1px solid var(--border)',
                  background: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
                  cursor: 'pointer',
                }}>
                  <div style={{
                    fontSize: 12, fontWeight: isToday ? 800 : 500,
                    color: isToday ? 'white' : 'var(--accent)',
                    width: 22, height: 22, borderRadius: '50%',
                    background: isToday ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 3,
                  }}>{day.getDate()}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {dayEvents.slice(0, 2).map((ev, idx) => (
                      <div key={idx} style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 5px', borderRadius: 4,
                        background: ev.type === 'call' ? 'var(--accent)' : '#f5a62320',
                        color: ev.type === 'call' ? 'white' : 'var(--amber)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {ev.type === 'call' ? `📞 ${ev.time}` : `⏰ ${ev.label.slice(0, 14)}`}
                      </div>
                    ))}
                    {dayEvents.length > 2 && <div style={{ fontSize: 10, color: 'var(--muted)', paddingLeft: 5 }}>+{dayEvents.length - 2}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panneau latéral */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">
                {selectedDay
                  ? new Date(selectedDay + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                  : 'Sélectionne un jour'}
              </div>
              <div className="card-sub">{selectedEvents.length} événement{selectedEvents.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          {selectedEvents.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 0', textAlign: 'center' }}>Rien ce jour.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {selectedEvents.map((ev, i) => (
                <div key={i} style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: ev.type === 'call' ? 'var(--accent-soft)' : '#f5a62310',
                  border: `1px solid ${ev.type === 'call' ? 'var(--accent)30' : '#f5a62330'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 14 }}>{ev.type === 'call' ? '📞' : '⏰'}</span>
                    {ev.time && <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{ev.time}</span>}
                    {ev.type === 'call' && ev.ready && (
                      <span className={`pill pill-${ev.ready === 'ready' ? 'green' : 'amber'}`} style={{ fontSize: 10 }}>
                        {ev.ready === 'ready' ? 'Prêt' : 'En attente'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{ev.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>}

      {/* Modale refus avec créneau alternatif */}
      {declineModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) { setDeclineModal(null); setProposedAt(''); } }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 380, padding: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Refuser ce call</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
              {declineModal.topic} · {new Date(declineModal.scheduledAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              Proposer un autre créneau (optionnel)
            </label>
            <input
              className="input"
              type="text"
              placeholder="Ex : jeudi après 14h"
              value={proposedAt}
              onChange={e => setProposedAt(e.target.value)}
              style={{ width: '100%', marginBottom: 14 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" type="button" style={{ flex: 1 }} onClick={() => { setDeclineModal(null); setProposedAt(''); }}>
                Annuler
              </button>
              <button
                className="btn-primary"
                type="button"
                style={{ flex: 1, background: '#ef4444', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                onClick={() => handleDecline(declineModal.callId, proposedAt)}
                disabled={respondingId === declineModal.callId}
              >
                {respondingId === declineModal.callId ? '…' : 'Confirmer le refus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
