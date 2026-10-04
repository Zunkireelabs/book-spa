import React, { useState, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEAR_GRID_SIZE = 12;

const MiniMonthCalendar = ({ selectedDate, onDateSelect }) => {
  const selected = useMemo(() => new Date(selectedDate + 'T00:00:00'), [selectedDate]);
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  // 'days' -> clicking the header drills into 'months' -> drills into 'years'
  const [pickerMode, setPickerMode] = useState('days');
  const [yearRangeStart, setYearRangeStart] = useState(
    selected.getFullYear() - (selected.getFullYear() % YEAR_GRID_SIZE)
  );

  const today = useMemo(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  }, []);

  const weeks = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    // Monday = 0
    let startDay = first.getDay() - 1;
    if (startDay < 0) startDay = 6;

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells = [];

    // Previous month trailing days
    for (let i = startDay - 1; i >= 0; i--) {
      cells.push({ day: daysInPrevMonth - i, month: viewMonth - 1, year: viewYear, isOtherMonth: true });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, month: viewMonth, year: viewYear, isOtherMonth: false });
    }

    // Next month leading days
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        cells.push({ day: d, month: viewMonth + 1, year: viewYear, isOtherMonth: true });
      }
    }

    // Split into weeks
    const result = [];
    for (let i = 0; i < cells.length; i += 7) {
      result.push(cells.slice(i, i + 7));
    }
    return result;
  }, [viewMonth, viewYear]);

  const monthName = new Date(viewYear, viewMonth).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
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

  return (
    <div className="select-none w-[340px]">
      {/* Header navigation — drills days -> months -> years on label click */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={handlePrevHeaderNav} className="p-1.5 rounded hover:bg-background spa-transition-fast" aria-label="Previous">
          <Icon name="ChevronLeft" size={16} className="text-text-secondary" />
        </button>
        <button
          onClick={handleHeaderClick}
          disabled={pickerMode === 'years'}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-background spa-transition-fast disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="font-heading font-heading-semibold text-base text-text-primary">{headerLabel}</span>
          {pickerMode !== 'years' && <Icon name="ChevronDown" size={14} className="text-text-secondary" />}
        </button>
        <button onClick={handleNextHeaderNav} className="p-1.5 rounded hover:bg-background spa-transition-fast" aria-label="Next">
          <Icon name="ChevronRight" size={16} className="text-text-secondary" />
        </button>
      </div>

      {pickerMode === 'years' && (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: YEAR_GRID_SIZE }, (_, i) => yearRangeStart + i).map(y => (
            <button
              key={y}
              onClick={() => { setViewYear(y); setPickerMode('months'); }}
              className={`py-3 rounded-spa text-base spa-transition-fast ${
                y === viewYear ? 'bg-primary text-white font-semibold' : 'text-text-primary hover:bg-background'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      {pickerMode === 'months' && (
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((m, i) => (
            <button
              key={m}
              onClick={() => { setViewMonth(i); setPickerMode('days'); }}
              className={`py-3 rounded-spa text-base spa-transition-fast ${
                i === viewMonth ? 'bg-primary text-white font-semibold' : 'text-text-primary hover:bg-background'
              }`}
            >
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
              <div key={i} className="text-center text-xs font-caption text-text-secondary font-semibold py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Weeks */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
              {week.map((cell, ci) => {
                const todayCell = isToday(cell);
                const selectedCell = isSelected(cell);
                return (
                  <button
                    key={ci}
                    onClick={() => handleDateClick(cell)}
                    className={`
                      w-11 h-11 flex items-center justify-center text-base rounded-full spa-transition-fast
                      ${cell.isOtherMonth ? 'text-text-secondary/40' : 'text-text-primary'}
                      ${todayCell && !selectedCell ? 'bg-primary/10 text-primary font-semibold' : ''}
                      ${selectedCell ? 'bg-primary text-white font-semibold' : ''}
                      ${!todayCell && !selectedCell ? 'hover:bg-background' : ''}
                    `}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default MiniMonthCalendar;
