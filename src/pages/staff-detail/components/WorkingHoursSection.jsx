import React from 'react';
import Icon from '../../../components/AppIcon';
import TimeBoxInput from '../../../components/ui/TimeBoxInput';

// Display only. These hours and breaks are shown on the staff calendar as
// per-column shading (see calendar/CalendarGrid's roster overlay, resolved via
// services/rosterSchedule), but they are still NOT read by booking-slot
// availability or conflict checks — a booking can be made outside them.
const WorkingHoursSection = ({ rows, onChange }) => {
  const updateRow = (dayOfWeek, patch) => {
    onChange(rows.map(r => r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r));
  };

  const toggleWorking = (row) => {
    const nowWorking = row.isDayOff;
    updateRow(row.dayOfWeek, {
      isDayOff: !nowWorking,
      ...(nowWorking
        ? { startTime: row.startTime || '09:00', endTime: row.endTime || '17:00' }
        : { breaks: [] }),
    });
  };

  const addBreak = (row) => {
    const start = row.startTime || '09:00';
    const end = row.endTime || '17:00';
    const existing = row.breaks || [];
    const lastEnd = existing.length > 0 ? existing[existing.length - 1].endTime : null;

    let breakStart = lastEnd || '13:00';
    let breakEnd = addOneHour(breakStart);
    if (breakStart < start || breakEnd > end) {
      breakStart = start;
      breakEnd = end;
    }

    updateRow(row.dayOfWeek, { breaks: [...existing, { name: '', startTime: breakStart, endTime: breakEnd }] });
  };

  const removeBreak = (row, index) => {
    updateRow(row.dayOfWeek, { breaks: row.breaks.filter((_, i) => i !== index) });
  };

  const updateBreak = (row, index, patch) => {
    updateRow(row.dayOfWeek, {
      breaks: row.breaks.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    });
  };

  return (
    <div>
      <div className="divide-y divide-border">
        {rows.map(row => {
          const working = !row.isDayOff;
          const breaks = row.breaks || [];
          return (
            <div key={row.dayOfWeek} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggleWorking(row)}
                  title={working ? 'Mark as not working' : 'Mark as working'}
                  className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center spa-transition-fast ${
                    working ? 'bg-primary' : 'bg-border'
                  }`}
                >
                  {working && <Icon name="Check" size={14} className="text-white" />}
                </button>
                <span className="w-24 flex-shrink-0 font-body font-body-medium text-sm text-text-primary">{row.dayLabel}</span>

                {working ? (
                  <div key={`${row.dayOfWeek}-on`} className="space-y-2 animate-settle-in origin-left">
                    <div className="flex items-center gap-2">
                      <TimeBoxInput
                        value={row.startTime}
                        onChange={(v) => updateRow(row.dayOfWeek, { startTime: v })}
                      />
                      <span className="font-caption text-xs text-text-tertiary">to</span>
                      <TimeBoxInput
                        value={row.endTime}
                        onChange={(v) => updateRow(row.dayOfWeek, { endTime: v })}
                      />

                      <button
                        type="button"
                        onClick={() => addBreak(row)}
                        className="font-caption text-xs text-primary hover:underline underline-offset-2 spa-transition-fast"
                      >
                        + break
                      </button>
                    </div>

                    {breaks.map((brk, index) => (
                      <div key={index} className="flex items-center gap-2 animate-settle-in origin-left">
                        <input
                          type="text"
                          placeholder="Break name"
                          value={brk.name}
                          onChange={(e) => updateBreak(row, index, { name: e.target.value })}
                          className="w-32 px-2 py-1.5 rounded-spa border border-border bg-surface font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <TimeBoxInput
                          value={brk.startTime}
                          onChange={(v) => updateBreak(row, index, { startTime: v })}
                        />
                        <span className="font-caption text-xs text-text-tertiary">to</span>
                        <TimeBoxInput
                          value={brk.endTime}
                          onChange={(v) => updateBreak(row, index, { endTime: v })}
                        />
                        <button
                          type="button"
                          onClick={() => removeBreak(row, index)}
                          title="Remove break"
                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-error/70 hover:text-error hover:bg-error/10 spa-transition-fast"
                        >
                          <Icon name="Trash2" size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span key={`${row.dayOfWeek}-off`} className="font-caption text-sm text-text-tertiary animate-fade-in">
                    Not working on this day
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function addOneHour(time) {
  const [h, m] = time.split(':').map(Number);
  const next = (h + 1) % 24;
  return `${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default WorkingHoursSection;
