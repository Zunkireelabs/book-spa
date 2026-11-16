import React from 'react';
import Icon from '../../../components/AppIcon';
import TimeBoxInput from '../../../components/ui/TimeBoxInput';

// No breaks concept here — branch_working_hours (migration-308) has no sibling breaks
// table, unlike therapist_working_hours. Toggle-per-day + two time inputs only.
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
          <div key={row.dayOfWeek} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3">
            <button
              type="button"
              onClick={() => toggleWorking(row)}
              title={open ? 'Mark as closed' : 'Mark as open'}
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center spa-transition-fast ${open ? 'bg-primary' : 'bg-border'}`}
            >
              {open && <Icon name="Check" size={14} className="text-white" />}
            </button>
            <span className="w-24 flex-shrink-0 font-body font-body-medium text-sm text-text-primary">{row.dayLabel}</span>
            {open ? (
              <div className="flex items-center gap-2">
                <TimeBoxInput value={row.startTime} onChange={(v) => updateRow(row.dayOfWeek, { startTime: v })} />
                <span className="font-caption text-xs text-text-tertiary">to</span>
                <TimeBoxInput value={row.endTime} onChange={(v) => updateRow(row.dayOfWeek, { endTime: v })} />
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
