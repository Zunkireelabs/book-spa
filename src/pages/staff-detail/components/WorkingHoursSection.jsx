import React from 'react';
import Icon from '../../../components/AppIcon';

// Storage/display only — see migration-269's header comment: deliberately
// not wired into booking-slot availability/conflict checks.
const WorkingHoursSection = ({ rows, onChange }) => {
  const updateRow = (dayOfWeek, patch) => {
    onChange(rows.map(r => r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r));
  };

  return (
    <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-4">
      <div>
        <h3 className="font-heading font-heading-semibold text-base text-text-primary">Normal Working Hours</h3>
        <p className="font-caption text-xs text-text-secondary mt-0.5">
          For reference only — not used to restrict bookings.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.dayOfWeek} className="flex items-center gap-3 py-1.5">
            <span className="w-24 flex-shrink-0 font-body font-body-medium text-sm text-text-primary">{row.dayLabel}</span>

            <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer">
              <input
                type="checkbox"
                checked={row.isDayOff}
                onChange={(e) => updateRow(row.dayOfWeek, {
                  isDayOff: e.target.checked,
                  ...(e.target.checked ? {} : { startTime: row.startTime || '09:00', endTime: row.endTime || '17:00' }),
                })}
                className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
              />
              <span className="font-caption text-xs text-text-secondary">Day off</span>
            </label>

            {row.isDayOff ? (
              <span className="font-caption text-xs text-text-tertiary">—</span>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={row.startTime || ''}
                  onChange={(e) => updateRow(row.dayOfWeek, { startTime: e.target.value })}
                  className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <Icon name="ArrowRight" size={14} className="text-text-tertiary" />
                <input
                  type="time"
                  value={row.endTime || ''}
                  onChange={(e) => updateRow(row.dayOfWeek, { endTime: e.target.value })}
                  className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default WorkingHoursSection;
