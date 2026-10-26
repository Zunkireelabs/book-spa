import React from 'react';
import WorkingHoursSection from '../components/WorkingHoursSection';
import { Note, Loading, Problem } from './ui';
import { changedHourDays } from '../profileModel';
import { formatMinutes, dayWorkingMinutes, DB_DOW_LABELS } from '../../../utils/staffDay';
import { SHADE_STYLES } from '../../../services/availabilityShading';

const short = (t) => String(t || '').slice(0, 5);

const dayParts = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return { day: d.getUTCDate(), month: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase(), weekday: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) };
};

// "Mon 10:00 – 19:00 · lunch 13:00–14:00 · 8 h", one row per day, then the week's total.
const HoursView = ({ rows }) => {
  const total = rows.reduce((n, r) => n + dayWorkingMinutes(r), 0);
  const days = rows.filter((r) => !r.isDayOff).length;
  return (
    <div className="mt-3">
      {rows.map((r) => {
        const working = !r.isDayOff && r.startTime && r.endTime;
        const breaks = r.breaks || [];
        return (
          <div key={r.dayOfWeek} className={`grid grid-cols-[56px_1fr_auto] gap-3 py-2.5 border-b border-border/60 text-sm items-baseline ${working ? '' : 'text-text-secondary'}`}>
            <span className="font-medium">{DB_DOW_LABELS[r.dayOfWeek].slice(0, 3)}</span>
            <span className="tabular-nums">
              {working ? <>{short(r.startTime)} – {short(r.endTime)}{breaks.length > 0 && <span style={{ color: SHADE_STYLES.break.color }}> · {breaks.map((b) => `${(b.name || 'break').toLowerCase()} ${short(b.startTime)}–${short(b.endTime)}`).join(', ')}</span>}</> : 'Day off'}
            </span>
            <span className="text-right text-text-secondary tabular-nums">{working ? formatMinutes(dayWorkingMinutes(r)) : ''}</span>
          </div>
        );
      })}
      <div className="flex justify-between pt-3 text-sm"><span className="text-text-secondary">{days} working day{days === 1 ? '' : 's'} · breaks taken off</span><b className="font-semibold tabular-nums">{formatMinutes(total)}</b></div>
    </div>
  );
};

const HoursSection = ({
  editing, rows, savedRows, onChange, readOnly, overrides, overridesLoading, overridesError, canOpenRoster, openRoster, isCreate, hidden = false,
}) => {
  if (hidden) return <div className="mt-4"><Note icon="Lock">Working hours aren't shown to view-only accounts.</Note></div>;
  return (
    <div>
      {editing ? (
        <div className="mt-4">
          <WorkingHoursSection rows={rows} onChange={onChange} readOnly={readOnly} changedDays={changedHourDays(savedRows, rows)} />
          <div className="mt-4"><Note icon="AlertTriangle">Hours and breaks are for planning and attendance. Bookings can still be made during them; that rule is unchanged.</Note></div>
        </div>
      ) : <HoursView rows={rows} />}

      {!isCreate && (
        <div className="mt-6">
          <div className="flex items-baseline gap-2 text-sm font-medium text-text-primary">
            <span>Date changes · from the roster</span>
            {canOpenRoster && <button type="button" onClick={openRoster} className="ml-auto text-xs font-medium text-primary hover:underline">Open roster</button>}
          </div>
          {overridesLoading ? <Loading /> : overridesError ? <Problem message={overridesError} /> : overrides.length === 0 ? (
            <p className="mt-2 text-sm text-text-secondary">No date changes coming up.</p>
          ) : overrides.map((o) => {
            const p = dayParts(o.date);
            return (
              <div key={o.date} className="flex items-center gap-3 py-2.5 border-b border-border/60">
                <div className="w-11 text-center"><b className="block text-base font-semibold leading-tight">{p.day}</b><span className="text-xs font-semibold tracking-wide text-text-secondary">{p.month}</span></div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">{p.weekday} · {o.isDayOff ? 'Day off' : `${short(o.startTime)} – ${short(o.endTime)}`}</p>
                  <p className="text-xs text-text-secondary">{o.isDayOff ? 'Instead of the usual hours' : `${formatMinutes(dayWorkingMinutes(o))} that day, instead of the usual hours`}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HoursSection;
