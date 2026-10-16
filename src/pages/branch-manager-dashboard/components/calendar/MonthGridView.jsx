import React, { useMemo } from 'react';
import { formatClockTime } from './timeFormat';

const STATUS_DOT = {
  'Pending':     'bg-amber-500',
  'Confirmed':   'bg-blue-500',
  'In-Progress': 'bg-primary',
  'Completed':   'bg-success',
  'Cancelled':   'bg-error',
  'No Show':     'bg-gray-400',
};

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MAX_CHIPS_PER_DAY = 3;

function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysToStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toLocalISO(d);
}

// Month grid view — a navigation/overview surface, not a management one: day
// cells show a handful of booking chips (click -> open that booking) and the
// date itself (click -> jump to Day view). No drag-and-drop, no per-staff
// columns, no attendance — those stay Day/Week-only.
const MonthGridView = ({ currentDate, bookings = [], branchHours, hideSensitive, use24h = false, onDayClick, onBookingClick }) => {
  const todayStr = toLocalISO(new Date());

  const weeks = useMemo(() => {
    const d = new Date(currentDate + 'T00:00:00');
    const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    const gridStart = addDaysToStr(toLocalISO(firstOfMonth), -firstOfMonth.getDay());
    const rows = [];
    let cursor = gridStart;
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let i = 0; i < 7; i++) {
        row.push(cursor);
        cursor = addDaysToStr(cursor, 1);
      }
      rows.push(row);
      // Stop once we've rendered a full row that's entirely past the month
      // and the month is already covered — avoids a trailing all-next-month
      // 6th row for months that only need 5.
      const lastInRow = row[6];
      if (new Date(lastInRow + 'T00:00:00') > d && new Date(lastInRow + 'T00:00:00').getMonth() !== d.getMonth() && rows.length >= 5) {
        const anyInMonth = row.some(ds => new Date(ds + 'T00:00:00').getMonth() === d.getMonth());
        if (!anyInMonth) break;
      }
    }
    return rows;
  }, [currentDate]);

  const bookingsByDate = useMemo(() => {
    const map = {};
    for (const b of bookings) {
      if (!b.date) continue;
      (map[b.date] ||= []).push(b);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    }
    return map;
  }, [bookings]);

  const viewedMonth = new Date(currentDate + 'T00:00:00').getMonth();

  return (
    <div className="h-full flex flex-col overflow-auto">
      <div className="grid grid-cols-7 border-b border-border flex-shrink-0">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="px-3 py-2 text-center font-body font-body-medium text-xs sm:text-sm text-text-secondary">
            {label}
          </div>
        ))}
      </div>
      <div className="flex-1 grid" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(100px, 1fr))` }}>
        {weeks.map((row, ri) => (
          <div key={ri} className="grid grid-cols-7 border-b border-border last:border-b-0">
            {row.map(dateStr => {
              const inMonth = new Date(dateStr + 'T00:00:00').getMonth() === viewedMonth;
              const isToday = dateStr === todayStr;
              const dayBookings = bookingsByDate[dateStr] || [];
              const overflow = dayBookings.length - MAX_CHIPS_PER_DAY;
              return (
                <button
                  type="button"
                  key={dateStr}
                  onClick={() => onDayClick?.(dateStr)}
                  className={`flex flex-col items-stretch text-left p-1.5 border-r border-border last:border-r-0 spa-transition-fast hover:bg-background ${
                    isToday ? 'bg-primary/5' : inMonth ? 'bg-surface' : 'bg-background/60'
                  }`}
                >
                  <span className={`self-end text-xs sm:text-sm font-data ${
                    isToday ? 'font-data-medium text-primary' : inMonth ? 'text-text-primary' : 'text-text-tertiary'
                  }`}>
                    {Number(dateStr.slice(8, 10))}
                  </span>
                  <div className="mt-1 space-y-0.5 overflow-hidden flex-1">
                    {dayBookings.slice(0, MAX_CHIPS_PER_DAY).map((b, i) => (
                      <div
                        key={b.bookingId || b.id || i}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); onBookingClick?.(b); }}
                        className="flex items-center gap-1 px-1 py-0.5 rounded bg-background text-left hover:bg-primary/10 spa-transition-fast"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[b.status] || 'bg-gray-400'}`} />
                        <span className="font-caption text-[10px] text-text-primary truncate">
                          {formatClockTime(b.startTime, use24h)} {hideSensitive ? '•••••' : (b.customerName || b.serviceName)}
                        </span>
                      </div>
                    ))}
                    {overflow > 0 && (
                      <p className="font-caption text-[10px] text-text-tertiary pl-1">+{overflow} more</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default MonthGridView;
