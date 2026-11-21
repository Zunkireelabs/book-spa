import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../AppIcon';
import MiniMonthCalendar from '../../pages/branch-manager-dashboard/components/calendar/MiniMonthCalendar';
import { todayStr } from '../../pages/branch-manager-dashboard/components/calendar/calendarDates';
import { format12h, parseTimeInput, buildTimeOptions, formatDateChip } from '../../utils/timeInput';

// ONE date chip + time field row (ZNLY-324), used by New booking (QuickCreatePanel) and Edit details (BookingActionModal).
// Date: a chip that opens the month calendar. Time: a typable field with a 15-minute list.
// `time` is "HH:MM" ('' while the typed text is incomplete); the typed text lives here and re-syncs when `time` changes from outside.
const DateTimeRow = ({ date, time, onDateChange, onTimeChange, branchHours, timeRingClass = '', timeFieldAttr }) => {
  const [dateOpen, setDateOpen] = useState(false);
  const dateRef = useRef(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const timeRef = useRef(null);
  const listRef = useRef(null);
  const [timeText, setTimeText] = useState(time ? format12h(time) : '');

  useEffect(() => {
    if ((parseTimeInput(timeText) ?? '') !== (time || '')) setTimeText(time ? format12h(time) : '');
  }, [time]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dateOpen) return undefined;
    const onDown = (e) => { if (dateRef.current && !dateRef.current.contains(e.target)) setDateOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setDateOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [dateOpen]);

  useEffect(() => {
    if (!timeOpen) return undefined;
    const onDown = (e) => { if (timeRef.current && !timeRef.current.contains(e.target)) setTimeOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [timeOpen]);

  useEffect(() => {
    if (timeOpen && listRef.current) listRef.current.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [timeOpen]);

  const options = useMemo(() => buildTimeOptions(branchHours, time), [branchHours, time]);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="relative" ref={dateRef}>
        <button
          type="button"
          onClick={() => setDateOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={dateOpen}
          aria-label="Date"
          className="field-text w-full h-9 pl-8 pr-2 flex items-center text-[13px] font-body text-text-primary bg-surface border border-border rounded-spa hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-left"
        >
          <Icon name="Calendar" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <span className="truncate">{formatDateChip(date)}</span>
        </button>
        {dateOpen && (
          <div className="absolute left-0 top-full mt-1 bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown p-3">
            <MiniMonthCalendar
              selectedDate={date || todayStr()}
              onDateSelect={(d) => { onDateChange(d); setDateOpen(false); }}
            />
          </div>
        )}
      </div>
      <div className={`relative ${timeRingClass}`} {...(timeFieldAttr ? { 'data-qc-field': timeFieldAttr } : {})} ref={timeRef}>
        <Icon name="Clock" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          aria-label="Time"
          value={timeText}
          onChange={(e) => {
            // Reflect whatever is typed; commit only once it parses to a valid time.
            const raw = e.target.value;
            setTimeText(raw);
            onTimeChange(parseTimeInput(raw) ?? '');
          }}
          onFocus={(e) => { e.target.select(); setTimeOpen(true); }}
          onBlur={() => { setTimeText(time ? format12h(time) : ''); }}
          placeholder="--:--"
          autoComplete="off"
          className="w-full h-9 pl-8 pr-2 text-[13px] font-body text-text-primary bg-surface border border-border rounded-spa focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        {timeOpen && (
          <div ref={listRef} className="absolute top-full left-0 mt-1 w-28 max-h-48 overflow-y-auto bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown">
            {options.map((t) => (
              <button
                key={t}
                type="button"
                data-selected={t === time}
                onClick={() => { onTimeChange(t); setTimeText(format12h(t)); setTimeOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-[13px] font-body cursor-pointer hover:bg-background ${t === time ? 'bg-background font-body-medium text-text-primary' : 'text-text-primary'}`}
              >
                {format12h(t)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DateTimeRow;
