import React from 'react';
import Icon from '../../../components/AppIcon';

// Storage/display only — see migration-275's header comment: deliberately
// not wired into booking-slot availability/conflict checks.
const WorkingHoursSection = ({ rows, onChange }) => {
  const updateRow = (dayOfWeek, patch) => {
    onChange(rows.map(r => r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r));
  };

  const toggleWorking = (row) => {
    const nowWorking = row.isDayOff;
    updateRow(row.dayOfWeek, {
      isDayOff: !nowWorking,
      ...(nowWorking ? { startTime: row.startTime || '09:00', endTime: row.endTime || '17:00' } : {}),
    });
  };

  return (
    <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-4">
      <div>
        <h3 className="font-heading font-heading-semibold text-base text-text-primary">Normal Working Hours</h3>
        <p className="font-caption text-xs text-text-secondary mt-0.5">
          For reference only — not used to restrict bookings.
        </p>
      </div>

      <div className="divide-y divide-border">
        {rows.map(row => {
          const working = !row.isDayOff;
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

                <div
                  className={`grid transition-all duration-200 ease-out ${
                    working ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'
                  }`}
                  style={{ gridTemplateColumns: working ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={row.startTime || ''}
                        onChange={(e) => updateRow(row.dayOfWeek, { startTime: e.target.value })}
                        className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <span className="font-caption text-xs text-text-tertiary">to</span>
                      <input
                        type="time"
                        value={row.endTime || ''}
                        onChange={(e) => updateRow(row.dayOfWeek, { endTime: e.target.value })}
                        className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>
                </div>

                {!working && (
                  <span className="font-caption text-sm text-text-tertiary">Not working on this day</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WorkingHoursSection;
