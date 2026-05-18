'use client';

import { useState, useMemo } from 'react';
import Icon from '@/components/ui/Icon';
import { useClientSelfData } from '@/lib/supabase/useCoachData';
import { createClient } from '@/lib/supabase/client';
import { useEffect } from 'react';
import type { Call } from '@/lib/supabase/types';

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
  const supabase = createClient();

  useEffect(() => {
    if (!client) return;
    supabase.from('calls').select('*').eq('client_id', client.id)
      .order('scheduled_at', { ascending: true })
      .then(({ data }) => setCalls(data || []));
  }, [client?.id]);

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

  if (loading) {
    return (
      <div className="page-content">
        <div className="page-header"><h1 className="page-title">Calendrier</h1></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 13, paddingTop: 40, justifyContent: 'center' }}>
          <Icon name="refresh-cw" size={16} /> Chargement…
        </div>
      </div>
    );
  }

  const nextCall = calls.find(c => c.scheduled_at && new Date(c.scheduled_at) >= new Date());

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
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
      </div>
    </div>
  );
}
