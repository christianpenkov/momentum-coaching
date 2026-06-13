'use client';
import PageLoader from '@/components/ui/PageLoader';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import Icon from '@/components/ui/Icon';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import type { Call } from '@/lib/supabase/types';

type ViewMode = 'month' | 'week';

interface CalEvent {
  date: string; // YYYY-MM-DD
  type: 'call' | 'deadline';
  label: string;
  clientName: string;
  clientInitials: string;
  clientId: string;
  time?: string;
  meta?: string;
  ready?: string;
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateKey(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

const DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function PageCalendar() {
  const { clients, calls, loading } = useSupabaseClients();
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(toDateKey(new Date()));

  // Construire tous les événements
  const events = useMemo<CalEvent[]>(() => {
    const evs: CalEvent[] = [];

    // Calls depuis Supabase
    calls.forEach(call => {
      if (!call.scheduled_at) return;
      const d = new Date(call.scheduled_at);
      const client = clients.find(c => c.id === call.client_id);
      evs.push({
        date: toDateKey(d),
        type: 'call',
        label: call.topic || 'Call coaching',
        clientName: client?.name || call.invitee_name || '—',
        clientInitials: client?.initials || (call.invitee_name ? call.invitee_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() : '?'),
        clientId: call.client_id || '',
        time: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        ready: call.ready,
      });
    });

    // Deadlines des tâches
    clients.forEach(client => {
      client.tasks.forEach(task => {
        if (!task.deadline || task.done) return;
        evs.push({
          date: task.deadline,
          type: 'deadline',
          label: task.label,
          clientName: client.name,
          clientInitials: client.initials || client.name.slice(0, 2).toUpperCase(),
          clientId: client.id,
          meta: task.priority || undefined,
        });
      });
    });

    return evs;
  }, [calls, clients]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    events.forEach(ev => {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    });
    return map;
  }, [events]);

  // Calcul des jours du mois
  const monthDays = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    // Lundi = 0
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const days: (Date | null)[] = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [cursor]);

  // Semaine courante
  const weekDays = useMemo(() => {
    const d = new Date(cursor);
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
    d.setDate(d.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(d);
      day.setDate(d.getDate() + i);
      return day;
    });
  }, [cursor]);

  const todayKey = toDateKey(new Date());
  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  function navigate(dir: 1 | -1) {
    const d = new Date(cursor);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + 7 * dir);
    setCursor(d);
  }

  if (loading) return <PageLoader />;

  const label = view === 'month'
    ? `${MONTHS_FR[cursor.getMonth()]} ${cursor.getFullYear()}`
    : `${weekDays[0].getDate()} – ${weekDays[6].getDate()} ${MONTHS_FR[weekDays[6].getMonth()]} ${weekDays[6].getFullYear()}`;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendrier</h1>
          <p className="page-sub">{events.filter(e => e.type === 'call').length} calls · {events.filter(e => e.type === 'deadline').length} deadlines</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['month', 'week'] as ViewMode[]).map(v => (
              <button key={v} type="button"
                className={view === v ? 'btn-primary' : 'btn-ghost'}
                style={{ fontSize: 12, padding: '6px 12px' }}
                onClick={() => setView(v)}>
                {v === 'month' ? 'Mois' : 'Semaine'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        {/* Calendrier */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <button type="button" className="btn-ghost" style={{ padding: '6px 10px' }} onClick={() => navigate(-1)}>
              <Icon name="chevR" size={14} style={{ transform: 'scaleX(-1)' }} />
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{label}</span>
            <button type="button" className="btn-ghost" style={{ padding: '6px 10px' }} onClick={() => navigate(1)}>
              <Icon name="chevR" size={14} />
            </button>
          </div>

          {/* Jours de la semaine */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
            {DAYS_FR.map(d => (
              <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Grille mois */}
          {view === 'month' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {monthDays.map((day, i) => {
                if (!day) return <div key={`empty-${i}`} style={{ minHeight: 80, borderRight: i % 7 !== 6 ? '1px solid var(--border)' : 'none', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }} />;
                const key = toDateKey(day);
                const dayEvents = eventsByDate[key] || [];
                const isToday = key === todayKey;
                const isSelected = key === selectedDay;
                return (
                  <div key={key}
                    onClick={() => setSelectedDay(key)}
                    style={{
                      minHeight: 80, padding: '6px 8px',
                      borderRight: i % 7 !== 6 ? '1px solid var(--border)' : 'none',
                      borderBottom: '1px solid var(--border)',
                      background: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}>
                    <div style={{
                      fontSize: 12, fontWeight: isToday ? 800 : 500,
                      color: isToday ? 'white' : 'var(--accent)',
                      width: 22, height: 22, borderRadius: '50%',
                      background: isToday ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 4,
                    }}>{day.getDate()}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {dayEvents.slice(0, 3).map((ev, idx) => (
                        <div key={idx} style={{
                          fontSize: 10, fontWeight: 600,
                          padding: '2px 5px', borderRadius: 4,
                          background: ev.type === 'call' ? 'var(--accent)' : '#f5a62320',
                          color: ev.type === 'call' ? 'white' : 'var(--amber)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {ev.type === 'call' ? `📞 ${ev.clientName}` : `⏰ ${ev.label.slice(0, 18)}`}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div style={{ fontSize: 10, color: 'var(--muted)', paddingLeft: 5 }}>+{dayEvents.length - 3}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Vue semaine */}
          {view === 'week' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {weekDays.map((day, i) => {
                const key = toDateKey(day);
                const dayEvents = eventsByDate[key] || [];
                const isToday = key === todayKey;
                const isSelected = key === selectedDay;
                return (
                  <div key={key}
                    onClick={() => setSelectedDay(key)}
                    style={{
                      minHeight: 160, padding: '10px 8px',
                      borderRight: i !== 6 ? '1px solid var(--border)' : 'none',
                      background: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
                      cursor: 'pointer',
                    }}>
                    <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{DAYS_FR[i]}</span>
                      <span style={{
                        fontSize: 14, fontWeight: isToday ? 800 : 600,
                        color: isToday ? 'white' : 'var(--accent)',
                        width: 24, height: 24, borderRadius: '50%',
                        background: isToday ? 'var(--accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{day.getDate()}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {dayEvents.map((ev, idx) => (
                        <div key={idx} style={{
                          fontSize: 11, fontWeight: 600,
                          padding: '4px 7px', borderRadius: 6,
                          background: ev.type === 'call' ? 'var(--accent)' : '#f5a62318',
                          color: ev.type === 'call' ? 'white' : 'var(--amber)',
                        }}>
                          {ev.type === 'call' && ev.time && <span style={{ opacity: 0.8, marginRight: 4 }}>{ev.time}</span>}
                          {ev.type === 'call' ? ev.clientName : ev.label.slice(0, 20)}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Panneau latéral — événements du jour sélectionné */}
        <div>
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
              <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 0', textAlign: 'center' }}>
                Aucun événement ce jour.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                {selectedEvents
                  .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
                  .map((ev, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '10px 12px', borderRadius: 10,
                      background: ev.type === 'call' ? 'var(--accent-soft)' : '#f5a62310',
                      border: `1px solid ${ev.type === 'call' ? 'var(--accent)30' : '#f5a62330'}`,
                    }}>
                      <div style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                        {ev.type === 'call' ? '📞' : '⏰'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <Avatar initials={ev.clientInitials} size={20} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{ev.clientName}</span>
                          {ev.time && <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{ev.time}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{ev.label}</div>
                        {ev.type === 'call' && ev.ready && (
                          <span className={`pill pill-${ev.ready === 'ready' ? 'green' : 'amber'}`} style={{ fontSize: 10, marginTop: 4, display: 'inline-block' }}>
                            {ev.ready === 'ready' ? 'Prêt' : ev.ready === 'partial' ? 'Partiel' : 'En attente'}
                          </span>
                        )}
                        {ev.type === 'deadline' && ev.meta && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, marginTop: 4, display: 'inline-block',
                            background: ev.meta === 'high' ? '#ef444420' : ev.meta === 'medium' ? '#f5a62320' : '#22c55e20',
                            color: ev.meta === 'high' ? 'var(--red)' : ev.meta === 'medium' ? 'var(--amber)' : 'var(--green)',
                          }}>
                            {ev.meta === 'high' ? 'Haute' : ev.meta === 'medium' ? 'Moyenne' : 'Basse'}
                          </span>
                        )}
                      </div>
                      <Link href={`/clients/${ev.clientId}`} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }}>
                        <Icon name="chevR" size={12} />
                      </Link>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Prochains calls */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <div className="card-title">Prochains calls</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {calls
                .filter(c => c.scheduled_at && new Date(c.scheduled_at) >= new Date())
                .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
                .slice(0, 5)
                .map(call => {
                  const client = clients.find(c => c.id === call.client_id);
                  const d = new Date(call.scheduled_at!);
                  return (
                    <div key={call.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar initials={client?.initials || '??'} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{client?.name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à {d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <span className={`pill pill-${call.ready === 'ready' ? 'green' : 'amber'}`} style={{ fontSize: 10 }}>
                        {call.ready === 'ready' ? 'Prêt' : 'Partiel'}
                      </span>
                    </div>
                  );
                })}
              {calls.filter(c => c.scheduled_at && new Date(c.scheduled_at) >= new Date()).length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Aucun call planifié.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
