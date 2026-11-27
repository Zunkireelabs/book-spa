import React from 'react';
import Icon from '../../../components/AppIcon';
import TimeBoxInput from '../../../components/ui/TimeBoxInput';
import { formatClockNow } from '../../../utils/clockTime';

// No breaks concept here — branch_working_hours (migration-308) has no sibling breaks
// table, unlike therapist_working_hours. Toggle-per-day + two time inputs only.
// B7: on an open day the closing time must be after the opening time (the database refuses it too: chk_branch_working_hours_times).
export const closesBeforeOpens = (row) => !row.isDayOff && !!row.startTime && !!row.endTime && row.endTime <= row.startTime;

// One-line summary for the Locations list. Rows are Monday-first (dayOfWeek 0 = Mon). Same hours on every open day reads
// "Mon–Sat · 10:00 AM–6:00 PM" (consecutive days collapse to a range); differing hours read "Mon–Sat · hours vary".
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const summarizeHours = (rows) => {
  const open = (rows || []).filter(r => !r.isDayOff && r.startTime && r.endTime);
  if (open.length === 0) return 'Hours not set';
  const ranges = [];
  open.forEach(r => {
    const last = ranges[ranges.length - 1];
    if (last && last.end === r.dayOfWeek - 1) last.end = r.dayOfWeek;
    else ranges.push({ start: r.dayOfWeek, end: r.dayOfWeek });
  });
  const days = ranges.map(g => (g.start === g.end ? SHORT_DAYS[g.start] : `${SHORT_DAYS[g.start]}–${SHORT_DAYS[g.end]}`)).join(', ');
  const key = (r) => `${r.startTime}-${r.endTime}`;
  const same = open.every(r => key(r) === key(open[0]));
  return same ? `${days} · ${formatClockNow(open[0].startTime.slice(0, 5))}–${formatClockNow(open[0].endTime.slice(0, 5))}` : `${days} · hours vary`;
};

const BranchHoursEditor = ({ rows, onChange }) => {
  const updateRow = (dayOfWeek, patch) => {
    onChange(rows.map(r => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r)));
  };

  const toggleWorking = (row) => {
    const nowOpen = row.isDayOff;
    updateRow(row.dayOfWeek, nowOpen
      ? { isDayOff: false, startTime: row.startTime || '10:00', endTime: row.endTime || '18:00' }
      : { isDayOff: true });
  };

  return (
    <div className="divide-y divide-border">
      {rows.map(row => {
        const open = !row.isDayOff;
        return (
          <div key={row.dayOfWeek} className="py-3 first:pt-0 last:pb-0 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={() => toggleWorking(row)}
              title={open ? 'Mark as closed' : 'Mark as open'}
              aria-pressed={open}
              aria-label={`${row.dayLabel}: ${open ? 'open' : 'closed'}`}
              className={`flex-shrink-0 w-7 h-7 max-lg:w-11 max-lg:h-11 rounded-full flex items-center justify-center spa-transition-fast ${open ? 'bg-primary' : 'bg-border'}`}
            >
              {open && <Icon name="Check" size={14} className="text-white" />}
            </button>
            <span className="w-24 flex-shrink-0 font-body font-body-medium text-sm text-text-primary">{row.dayLabel}</span>
            {open ? (
              <div className="flex flex-wrap items-center gap-2">
                <TimeBoxInput value={row.startTime} onChange={(v) => updateRow(row.dayOfWeek, { startTime: v })} />
                <span className="font-caption text-xs text-text-tertiary">to</span>
                <TimeBoxInput value={row.endTime} onChange={(v) => updateRow(row.dayOfWeek, { endTime: v })} />
                {closesBeforeOpens(row) && <span role="alert" className="font-caption text-xs text-error" data-hours-error>Closes before it opens</span>}
              </div>
            ) : (
              <span className="font-caption text-sm text-text-tertiary">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default BranchHoursEditor;
