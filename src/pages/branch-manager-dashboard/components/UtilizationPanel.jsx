import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { getUtilizationIntelligence } from '../../../services/api';

function formatMinutes(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatHour(h) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function BarRow({ label, percent, bookedMinutes, totalMinutes, color }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-body text-xs text-text-primary truncate max-w-[120px]">{label}</span>
        <span className="font-data font-data-normal text-xs text-text-secondary">
          {formatMinutes(bookedMinutes)} / {formatMinutes(totalMinutes)}
        </span>
      </div>
      <div className="h-2 bg-background rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full spa-transition-slow ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <div className="text-right">
        <span className={`font-data font-data-medium text-[11px] ${
          percent >= 80 ? 'text-success' : percent >= 40 ? 'text-primary' : 'text-text-tertiary'
        }`}>
          {percent}%
        </span>
      </div>
    </div>
  );
}

const UtilizationPanel = ({ branchId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const result = await getUtilizationIntelligence({ branchId });

    if (result.error) {
      setError(result.error.message || 'Failed to load utilization data.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="bg-surface rounded-spa-lg border border-border p-5 animate-pulse">
            <div className="h-4 bg-background rounded w-32 mb-4" />
            <div className="space-y-3">
              <div className="h-2 bg-background rounded w-full" />
              <div className="h-2 bg-background rounded w-3/4" />
              <div className="h-2 bg-background rounded w-1/2" />
            </div>
          </div>
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

  if (!data) return null;

  const { roomUtilization, therapistUtilization, hourlyDistribution, summary } = data;

  // Compute hourly chart data — only operating hours
  const openHour = Math.floor(data.operatingMinutes > 0 ? parseInt(data.operatingHours.split('–')[0]) : 9);
  const closeHour = Math.floor(data.operatingMinutes > 0 ? parseInt(data.operatingHours.split('–')[1]) : 21);
  const operatingHours = [];
  for (let h = openHour; h < closeHour; h++) {
    operatingHours.push(h);
  }
  const maxHourlyCount = Math.max(...operatingHours.map(h => hourlyDistribution[h]), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Room Utilization */}
      <div className="bg-surface rounded-spa-lg border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon name="DoorOpen" size={16} className="text-primary" />
            </div>
            <div>
              <h3 className="font-body font-body-medium text-sm text-text-primary">Room Utilization</h3>
              <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">
                {summary.roomCount} active rooms
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-heading font-heading-semibold text-lg text-text-primary">{summary.avgRoomUtilization}%</p>
            <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">avg</p>
          </div>
        </div>

        <div className="space-y-3">
          {roomUtilization.length > 0 ? (
            roomUtilization.map(r => (
              <BarRow
                key={r.id}
                label={r.name}
                percent={r.percent}
                bookedMinutes={r.bookedMinutes}
                totalMinutes={r.totalMinutes}
                color="bg-primary"
              />
            ))
          ) : (
            <p className="font-body text-xs text-text-tertiary text-center py-4">No active rooms</p>
          )}
        </div>
      </div>

      {/* Therapist Utilization */}
      <div className="bg-surface rounded-spa-lg border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Icon name="Users" size={16} className="text-accent" />
            </div>
            <div>
              <h3 className="font-body font-body-medium text-sm text-text-primary">Therapist Utilization</h3>
              <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">
                {summary.therapistCount} active therapists
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-heading font-heading-semibold text-lg text-text-primary">{summary.avgTherapistUtilization}%</p>
            <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">avg</p>
          </div>
        </div>

        <div className="space-y-3">
          {therapistUtilization.length > 0 ? (
            therapistUtilization.map(t => (
              <BarRow
                key={t.id}
                label={t.name}
                percent={t.percent}
                bookedMinutes={t.bookedMinutes}
                totalMinutes={t.totalMinutes}
                color="bg-accent"
              />
            ))
          ) : (
            <p className="font-body text-xs text-text-tertiary text-center py-4">No active therapists</p>
          )}
        </div>
      </div>

      {/* Hourly Distribution + Summary */}
      <div className="bg-surface rounded-spa-lg border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <Icon name="Clock" size={16} className="text-success" />
            </div>
            <div>
              <h3 className="font-body font-body-medium text-sm text-text-primary">Hourly Load</h3>
              <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">
                {data.operatingHours}
              </p>
            </div>
          </div>
          {summary.totalBookings > 0 && (
            <div className="text-right">
              <p className="font-heading font-heading-semibold text-lg text-text-primary">{formatHour(summary.peakHour)}</p>
              <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">peak</p>
            </div>
          )}
        </div>

        {/* Vertical bar chart */}
        <div className="flex items-end space-x-1 h-24 mb-3">
          {operatingHours.map(h => {
            const count = hourlyDistribution[h];
            const heightPct = maxHourlyCount > 0 ? (count / maxHourlyCount) * 100 : 0;
            const isPeak = h === summary.peakHour && count > 0;
            return (
              <div key={h} className="flex-1 flex flex-col items-center justify-end h-full">
                <div
                  className={`w-full rounded-t spa-transition-slow ${
                    isPeak ? 'bg-success' : count > 0 ? 'bg-success/40' : 'bg-background'
                  }`}
                  style={{ height: `${Math.max(heightPct, 4)}%`, minHeight: '2px' }}
                  title={`${formatHour(h)}: ${count} booking${count !== 1 ? 's' : ''}`}
                />
              </div>
            );
          })}
        </div>

        {/* Hour labels */}
        <div className="flex space-x-1 mb-4">
          {operatingHours.map(h => (
            <div key={h} className="flex-1 text-center">
              <span className={`font-caption text-[9px] ${
                h === summary.peakHour && hourlyDistribution[h] > 0
                  ? 'text-success font-caption-medium'
                  : 'text-text-tertiary font-caption-normal'
              }`}>
                {h}
              </span>
            </div>
          ))}
        </div>

        {/* Summary stats */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-body text-xs text-text-secondary">Total Booked</span>
            <span className="font-data font-data-normal text-xs text-text-primary">
              {formatMinutes(summary.totalBookedMinutes)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-body text-xs text-text-secondary">Idle Capacity</span>
            <span className={`font-data font-data-normal text-xs ${
              summary.idleMinutes > summary.totalBookedMinutes ? 'text-warning' : 'text-text-primary'
            }`}>
              {formatMinutes(summary.idleMinutes)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-body text-xs text-text-secondary">Bookings</span>
            <span className="font-data font-data-normal text-xs text-text-primary">
              {summary.totalBookings}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UtilizationPanel;
