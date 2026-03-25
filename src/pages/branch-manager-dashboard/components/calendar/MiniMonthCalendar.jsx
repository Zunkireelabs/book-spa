import React, { useState, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const MiniMonthCalendar = ({ selectedDate, onDateSelect }) => {
  const selected = useMemo(() => new Date(selectedDate + 'T00:00:00'), [selectedDate]);
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const [viewYear, setViewYear] = useState(selected.getFullYear());

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

  return (
    <div className="select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-background spa-transition-fast">
          <Icon name="ChevronLeft" size={14} className="text-text-secondary" />
        </button>
        <span className="font-heading font-heading-semibold text-sm text-text-primary">{monthName}</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-background spa-transition-fast">
          <Icon name="ChevronRight" size={14} className="text-text-secondary" />
        </button>
      </div>

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
        <div key={wi} className="grid grid-cols-7">
          {week.map((cell, ci) => {
            const todayCell = isToday(cell);
            const selectedCell = isSelected(cell);
            return (
              <button
                key={ci}
                onClick={() => handleDateClick(cell)}
                className={`
                  w-7 h-7 flex items-center justify-center text-xs rounded-full spa-transition-fast
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
    </div>
  );
};

export default MiniMonthCalendar;
