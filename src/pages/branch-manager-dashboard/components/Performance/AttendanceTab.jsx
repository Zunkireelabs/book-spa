import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import { getTherapistAttendanceDetail } from '../../../../services/api';

const STATUS_COLORS = {
  'On time': 'bg-success/10 text-success',
  Late: 'bg-warning/10 text-warning',
  'Early departure': 'bg-warning/10 text-warning',
  Absent: 'bg-error/10 text-error',
  Leave: 'bg-primary/10 text-primary',
  'Annual Leave': 'bg-primary/10 text-primary',
  'Sick Leave': 'bg-primary/10 text-primary',
  'Day Off': 'bg-accent/10 text-accent',
  '1st-Half Day': 'bg-accent/10 text-accent',
  '2nd-Half Day': 'bg-accent/10 text-accent',
};

function StatCard({ icon, iconBg, iconColor, label, value }) {
  return (
    <div className="bg-surface rounded-spa-lg border border-border p-4 flex items-center space-x-3">
      <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon name={icon} size={18} className={iconColor} />
      </div>
      <div className="min-w-0">
        <p className="font-heading font-heading-semibold text-lg text-text-primary truncate">{value}</p>
        <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">{label}</p>
      </div>
    </div>
  );
}

function formatPrettyDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const AttendanceTab = ({ therapistId, branchId, range }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId || !therapistId) return;
    setLoading(true);
    setError(null);

    const result = await getTherapistAttendanceDetail({ branchId, therapistId, ...range });

    if (result.error) {
      setError(result.error.message || 'Failed to load attendance detail.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId, therapistId, range]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-20 bg-background rounded-spa-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  const shiftHistory = data?.shiftHistory || [];

  if (!data || shiftHistory.length === 0) {
    return (
      <div className="p-12 text-center bg-surface rounded-spa-lg border border-border">
        <Icon name="Clock" size={32} className="text-text-tertiary mx-auto mb-3" />
        <p className="font-body text-sm text-text-tertiary">No attendance records for this period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard icon="Calendar" iconBg="bg-background" iconColor="text-text-secondary" label="Scheduled hours" value={`${data.scheduledHours}h`} />
        <StatCard icon="Clock" iconBg="bg-primary/10" iconColor="text-primary" label="Actual worked" value={`${data.actualWorkedHours}h`} />
        <StatCard icon="AlertTriangle" iconBg="bg-warning/10" iconColor="text-warning" label="Late arrivals" value={data.lateArrivals} />
        <StatCard icon="LogOut" iconBg="bg-warning/10" iconColor="text-warning" label="Early departures" value={data.earlyDepartures} />
        <StatCard icon="Plus" iconBg="bg-success/10" iconColor="text-success" label="Extra hours" value={`${data.extraHours}h`} />
        <StatCard icon="ClipboardList" iconBg="bg-accent/10" iconColor="text-accent" label="Partial shifts" value={data.partialShifts} />
      </div>

      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="bg-background/50 border-b border-border">
                <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Scheduled</th>
                <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Check-in</th>
                <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Check-out</th>
                <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Worked</th>
                <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shiftHistory.map((row) => (
                <tr key={row.date} className="hover:bg-background/30 spa-transition-fast">
                  <td className="px-4 py-3">
                    <span className="font-data font-data-normal text-sm text-text-primary">{formatPrettyDate(row.date)}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="font-data font-data-normal text-sm text-text-secondary">{row.scheduledHours}h</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="font-data font-data-normal text-sm text-text-secondary">{row.checkIn || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="font-data font-data-normal text-sm text-text-secondary">{row.checkOut || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="font-data font-data-normal text-sm text-text-secondary">{row.workedHours != null ? `${row.workedHours}h` : '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-caption font-caption-medium ${STATUS_COLORS[row.status] || 'bg-background text-text-secondary'}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile card stack */}
        <div className="md:hidden divide-y divide-border">
          {shiftHistory.map((row) => (
            <div key={row.date} className="p-4 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-data font-data-normal text-sm text-text-primary">{formatPrettyDate(row.date)}</span>
                <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-caption font-caption-medium ${STATUS_COLORS[row.status] || 'bg-background text-text-secondary'}`}>
                  {row.status}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-tertiary">
                <span>Sched {row.scheduledHours}h</span>
                <span>{row.checkIn || '—'} → {row.checkOut || '—'}</span>
                <span>{row.workedHours != null ? `${row.workedHours}h worked` : '—'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AttendanceTab;
