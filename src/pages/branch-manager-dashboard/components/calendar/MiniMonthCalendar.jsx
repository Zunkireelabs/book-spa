import React, { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import Icon from '../../../../components/AppIcon';
import { getBookingDayCounts } from '../../../../services/api';
import { useBranch } from '../../../../contexts/BranchContext';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEAR_GRID_SIZE = 12;

const pad = (n) => String(n).padStart(2, '0');
// Normalised ISO date for a grid cell (month may be -1 / 12 for the leading / trailing other-month days).
const cellISO = (cell) => {
  const d = new Date(cell.year, cell.month, cell.day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Monday-first weeks covering the given month, including the leading and trailing other-month days.
function buildWeeks(viewYear, viewMonth) {
  const first = new Date(viewYear, viewMonth, 1);
  let startDay = first.getDay() - 1; // Monday = 0
  if (startDay < 0) startDay = 6;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
  const cells = [];
  for (let i = startDay - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, month: viewMonth - 1, year: viewYear, isOtherMonth: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, month: viewMonth, year: viewYear, isOtherMonth: false });
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) for (let d = 1; d <= remaining; d++) cells.push({ day: d, month: viewMonth + 1, year: viewYear, isOtherMonth: true });
  const result = [];
  for (let i = 0; i < cells.length; i += 7) result.push(cells.slice(i, i + 7));
  return result;
}
const gridRange = (viewYear, viewMonth) => {
  const weeks = buildWeeks(viewYear, viewMonth);
  return { start: cellISO(weeks[0][0]), end: cellISO(weeks[weeks.length - 1][6]) };
};
const bookingsLabel = (n) => `${n} booking${n === 1 ? '' : 's'}`;

const MiniMonthCalendar = ({ selectedDate, onDateSelect, branchId }) => {
  const { branchName } = useBranch();
  const selected = useMemo(() => new Date(selectedDate + 'T00:00:00'), [selectedDate]);
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  // 'days' -> clicking the header drills into 'months' -> drills into 'years'
  const [pickerMode, setPickerMode] = useState('days');
  const [yearRangeStart, setYearRangeStart] = useState(
    selected.getFullYear() - (selected.getFullYear() % YEAR_GRID_SIZE)
  );

  // Follow the selected date when it changes from outside (toolbar prev/next, Today)
  useEffect(() => {
    setViewMonth(selected.getMonth());
    setViewYear(selected.getFullYear());
    setPickerMode('days');
  }, [selected]);

  const today = useMemo(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  }, []);

  const weeks = useMemo(() => buildWeeks(viewYear, viewMonth), [viewMonth, viewYear]);

  // Booking counts per day for the visible grid (fail-open: null -> no counts, no footer). The previously loaded month stays
  // on screen while the next one loads, and the month beyond the one being viewed is prefetched in the travel direction.
  const [counts, setCounts] = useState(null);
  const dirRef = useRef(1);
  useEffect(() => {
    if (!branchId) { setCounts(null); return undefined; }
    let cancelled = false;
    const { start, end } = gridRange(viewYear, viewMonth);
    getBookingDayCounts(branchId, start, end).then((c) => { if (!cancelled) setCounts(c ? { start, end, data: c } : null); });
    const ahead = new Date(viewYear, viewMonth + dirRef.current, 1);
    const r = gridRange(ahead.getFullYear(), ahead.getMonth());
    getBookingDayCounts(branchId, r.start, r.end);
    return () => { cancelled = true; };
  }, [branchId, viewMonth, viewYear]);

  // Load bars are scaled to the busiest day of the visible month.
  const monthMax = useMemo(() => {
    if (!counts) return 0;
    return weeks.flat().filter((c) => !c.isOtherMonth).reduce((m, c) => Math.max(m, counts.data[cellISO(c)]?.total || 0), 0);
  }, [counts, weeks]);

  // Styled tooltip (ink, ~150ms open delay, instant when moving between cells), clamped inside the picker.
  const rootRef = useRef(null);
  const tipRef = useRef(null);
  const tipTimer = useRef(null);
  const [tip, setTip] = useState(null); // { cx, top, lines: [..] }
  const [tipLeft, setTipLeft] = useState(0);
  useEffect(() => () => clearTimeout(tipTimer.current), []);
  const showTip = (el, lines, immediate) => {
    clearTimeout(tipTimer.current);
    const open = () => {
      const root = rootRef.current?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (!root) return;
      setTip({ cx: r.left - root.left + r.width / 2, top: r.top - root.top, lines });
    };
    if (immediate || tip) open(); else tipTimer.current = setTimeout(open, 150);
  };
  const hideTip = () => { clearTimeout(tipTimer.current); setTip(null); };
  useLayoutEffect(() => {
    if (!tip || !tipRef.current || !rootRef.current) return;
    const w = tipRef.current.offsetWidth;
    const max = rootRef.current.offsetWidth;
    setTipLeft(Math.max(0, Math.min(tip.cx - w / 2, max - w)));
  }, [tip]);

  const todayISO = `${today.year}-${pad(today.month + 1)}-${pad(today.day)}`;

  const monthName = new Date(viewYear, viewMonth).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const prevMonth = () => {
    dirRef.current = -1;
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    dirRef.current = 1;
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const handleDateClick = (cell) => {
    const y = cell.month < 0 ? cell.year - 1 : cell.month > 11 ? cell.year + 1 : cell.year;
    const m = ((cell.month % 12) + 12) % 12;
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
    onDateSelect(dateStr);
  };

  const isToday = (cell) =>
    !cell.isOtherMonth && cell.day === today.day && cell.month === today.month && cell.year === today.year;

  const isSelected = (cell) =>
    !cell.isOtherMonth && cell.day === selected.getDate() && cell.month === selected.getMonth() && cell.year === selected.getFullYear();

  const headerLabel = pickerMode === 'years'
    ? `${yearRangeStart} – ${yearRangeStart + YEAR_GRID_SIZE - 1}`
    : pickerMode === 'months'
      ? String(viewYear)
      : monthName;

  const handleHeaderClick = () => {
    if (pickerMode === 'days') setPickerMode('months');
    else if (pickerMode === 'months') {
      setYearRangeStart(viewYear - (viewYear % YEAR_GRID_SIZE));
      setPickerMode('years');
    }
  };

  const handlePrevHeaderNav = () => {
    if (pickerMode === 'days') prevMonth();
    else if (pickerMode === 'months') setViewYear(viewYear - 1);
    else setYearRangeStart(yearRangeStart - YEAR_GRID_SIZE);
  };

  const handleNextHeaderNav = () => {
    if (pickerMode === 'days') nextMonth();
    else if (pickerMode === 'months') setViewYear(viewYear + 1);
    else setYearRangeStart(yearRangeStart + YEAR_GRID_SIZE);
  };

  const pickerCell = (active) =>
    `py-2.5 rounded-spa text-[13px] spa-transition-fast ${
      active ? 'bg-text-primary text-white font-semibold' : 'text-text-primary hover:bg-background'
    }`;

  return (
    <div ref={rootRef} className="select-none relative w-[336px] max-w-full">
      {/* Header navigation — label click drills days -> months -> years */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={handlePrevHeaderNav} className="p-1 rounded hover:bg-background spa-transition-fast" aria-label="Previous">
          <Icon name="ChevronLeft" size={14} className="text-text-secondary" />
        </button>
        <button
          onClick={handleHeaderClick}
          disabled={pickerMode === 'years'}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-background spa-transition-fast disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="font-heading font-heading-semibold text-sm text-text-primary">{headerLabel}</span>
          {pickerMode !== 'years' && <Icon name="ChevronDown" size={12} className="text-text-secondary" />}
        </button>
        <button onClick={handleNextHeaderNav} className="p-1 rounded hover:bg-background spa-transition-fast" aria-label="Next">
          <Icon name="ChevronRight" size={14} className="text-text-secondary" />
        </button>
      </div>

      {pickerMode === 'years' && (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: YEAR_GRID_SIZE }, (_, i) => yearRangeStart + i).map(y => (
            <button key={y} onClick={() => { setViewYear(y); setPickerMode('months'); }} className={pickerCell(y === viewYear)}>
              {y}
            </button>
          ))}
        </div>
      )}

      {pickerMode === 'months' && (
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((m, i) => (
            <button key={m} onClick={() => { setViewMonth(i); setPickerMode('days'); }} className={pickerCell(i === viewMonth)}>
              {m}
            </button>
          ))}
        </div>
      )}

      {pickerMode === 'days' && (
        <>
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d, i) => (
              <div key={i} className="text-center text-[10px] font-caption text-text-secondary font-semibold py-0.5">
                {d}
              </div>
            ))}
          </div>

          {/* Weeks */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 justify-items-center">
              {week.map((cell, ci) => {
                const todayCell = isToday(cell);
                const selectedCell = isSelected(cell);
                const iso = cellISO(cell);
                const info = counts && iso >= counts.start && iso <= counts.end ? (counts.data[iso] || { total: 0, pending: 0, cancelled: 0 }) : null;
                const dateLabel = new Date(cell.year, cell.month, cell.day);
                const lines = info
                  ? [
                      dateLabel.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
                      info.total ? bookingsLabel(info.total) : 'No bookings',
                      info.pending || info.cancelled ? [info.pending ? `${info.pending} pending` : null, info.cancelled ? `${info.cancelled} cancelled` : null].filter(Boolean).join(' · ') : null,
                    ]
                  : null;
                const aria = `${dateLabel.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}${info ? `, ${bookingsLabel(info.total)}` : ''}`;
                const fill = info && info.total > 0 && monthMax > 0 ? Math.max(4, Math.round(24 * info.total / monthMax)) : 0;
                const past = iso < todayISO;
                return (
                  <button
                    key={ci}
                    onClick={() => handleDateClick(cell)}
                    onPointerEnter={lines ? (e) => showTip(e.currentTarget, lines, false) : undefined}
                    onPointerLeave={hideTip}
                    onFocus={lines ? (e) => { if (e.currentTarget.matches(':focus-visible')) showTip(e.currentTarget, lines, true); } : undefined}
                    onBlur={hideTip}
                    aria-label={aria}
                    className={`
                      w-11 h-11 flex flex-col items-center justify-center text-sm font-medium leading-none rounded-spa spa-transition-fast
                      ${cell.isOtherMonth ? 'text-text-tertiary/60' : todayCell ? '' : past ? 'text-text-secondary' : 'text-text-primary'}
                      ${todayCell && !selectedCell ? 'text-primary font-semibold' : ''}
                      ${selectedCell ? 'bg-text-primary text-white font-semibold' : ''}
                      ${!todayCell && !selectedCell ? 'hover:bg-background' : ''}
                    `}
                  >
                    <span>{cell.day}</span>
                    {/* load bar: the slot is always reserved so cells never jump while loading; no track on empty days */}
                    <span className={`mt-1.5 h-[3px] w-6 rounded-full ${fill ? (selectedCell ? 'bg-white/25' : 'bg-border/60') : ''} ${cell.isOtherMonth ? 'opacity-50' : ''}`}>
                      {fill > 0 && <span className={`block h-full rounded-full ${selectedCell ? 'bg-white' : 'bg-text-secondary'}`} style={{ width: fill }} />}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {/* Legend; the row keeps its height while counts load so the picker doesn't grow */}
          <div className={`mt-2 pt-2 h-7 text-[11px] text-text-tertiary ${counts ? 'border-t border-border' : ''}`}>
            {counts ? `Bar shows bookings per day · ${branchName || 'Branch'}` : ''}
          </div>
        </>
      )}
      {tip && pickerMode === 'days' && (
        <div
          ref={tipRef}
          role="tooltip"
          className="absolute z-10 pointer-events-none whitespace-nowrap rounded-spa bg-text-primary text-white text-xs leading-snug px-2 py-1.5"
          style={{ left: tipLeft, top: tip.top, transform: 'translateY(calc(-100% - 4px))' }}
        >
          <div className="font-semibold">{tip.lines[0]}</div>
          <div>{tip.lines[1]}</div>
          {tip.lines[2] && <div className="text-white/70">{tip.lines[2]}</div>}
        </div>
      )}
    </div>
  );
};

export default MiniMonthCalendar;
