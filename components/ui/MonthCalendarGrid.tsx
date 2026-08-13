'use client';

import Icon from '@/components/ui/Icon';
import { toDateKey, DAYS_FR, MONTHS_FR, monthDays } from '@/lib/calendarGrid';
import type { Call } from '@/lib/supabase/types';

interface Props {
  cursor: Date;
  selectedDay: string | null;
  onSelectDay: (key: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  callsByDate: Record<string, Call[]>;
}

export default function MonthCalendarGrid({ cursor, selectedDay, onSelectDay, onPrevMonth, onNextMonth, callsByDate }: Props) {
  const days = monthDays(cursor);
  const todayKey = toDateKey(new Date());

  return (
    <div className="mini-month-grid">
      <div className="mini-month-grid-header">
        <button type="button" className="btn-ghost" style={{ padding: '6px 10px' }} onClick={onPrevMonth} aria-label="Mois précédent">
          <Icon name="chevR" size={14} style={{ transform: 'scaleX(-1)' }} />
        </button>
        <span className="mini-month-grid-title">{MONTHS_FR[cursor.getMonth()]} {cursor.getFullYear()}</span>
        <button type="button" className="btn-ghost" style={{ padding: '6px 10px' }} onClick={onNextMonth} aria-label="Mois suivant">
          <Icon name="chevR" size={14} />
        </button>
      </div>
      <div className="mini-month-grid-dow">
        {DAYS_FR.map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="mini-month-grid-body">
        {days.map((day, i) => {
          if (!day) return <div key={`e-${i}`} className="mini-month-cell empty" />;
          const key = toDateKey(day);
          const hasCall = (callsByDate[key]?.length ?? 0) > 0;
          const isToday = key === todayKey;
          const isSelected = key === selectedDay;
          return (
            <div
              key={key}
              className={`mini-month-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => onSelectDay(key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectDay(key); } }}
            >
              <div className="mini-month-cell-num">{day.getDate()}</div>
              {hasCall && <div className="mini-month-cell-dot" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
