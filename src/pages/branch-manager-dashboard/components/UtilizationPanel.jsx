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
        <span className="text-xs text-gray-900 truncate max-w-[120px]">{label}</span>
        <span className="text-xs text-gray-500">
          {formatMinutes(bookedMinutes)} / {formatMinutes(totalMinutes)}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <div className="text-right">
        <span className={`text-[11px] font-medium ${
          percent >= 80 ? 'text-green-600' : percent >= 40 ? 'text-blue-600' : 'text-gray-400'
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
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-32 mb-4" />
            <div className="space-y-3">
              <div className="h-2 bg-gray-100 rounded w-full" />
              <div className="h-2 bg-gray-100 rounded w-3/4" />
              <div className="h-2 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-red-600 flex-shrink-0" />
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={loadData} className="ml-auto text-sm font-medium text-red-600 underline">
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
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <Icon name="DoorOpen" size={16} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-900">Room Utilization</h3>
              <p className="text-[11px] text-gray-400">
                {summary.roomCount} active rooms
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-gray-900">{summary.avgRoomUtilization}%</p>
            <p className="text-[11px] text-gray-400">avg</p>
          </div>
        </div>

        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {roomUtilization.length > 0 ? (
            roomUtilization.map(r => (
              <BarRow
                key={r.id}
                label={r.name}
                percent={r.percent}
                bookedMinutes={r.bookedMinutes}
                totalMinutes={r.totalMinutes}
                color="bg-blue-500"
              />
            ))
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">No active rooms</p>
          )}
        </div>
      </div>

      {/* Therapist Utilization */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
              <Icon name="Users" size={16} className="text-purple-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-900">Therapist Utilization</h3>
              <p className="text-[11px] text-gray-400">
                {summary.therapistCount} active therapists
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-gray-900">{summary.avgTherapistUtilization}%</p>
            <p className="text-[11px] text-gray-400">avg</p>
          </div>
        </div>

        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {therapistUtilization.length > 0 ? (
            therapistUtilization.map(t => (
              <BarRow
                key={t.id}
                label={t.name}
                percent={t.percent}
                bookedMinutes={t.bookedMinutes}
                totalMinutes={t.totalMinutes}
                color="bg-purple-500"
              />
            ))
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">No active therapists</p>
          )}
        </div>
      </div>

      {/* Hourly Distribution + Summary */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
              <Icon name="Clock" size={16} className="text-green-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-900">Hourly Load</h3>
              <p className="text-[11px] text-gray-400">
                {data.operatingHours}
              </p>
            </div>
          </div>
          {summary.totalBookings > 0 && (
            <div className="text-right">
              <p className="text-lg font-semibold text-gray-900">{formatHour(summary.peakHour)}</p>
              <p className="text-[11px] text-gray-400">peak</p>
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
                  className={`w-full rounded-t transition-all duration-300 ${
                    isPeak ? 'bg-green-500' : count > 0 ? 'bg-green-200' : 'bg-gray-100'
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
              <span className={`text-[9px] ${
                h === summary.peakHour && hourlyDistribution[h] > 0
                  ? 'text-green-600 font-medium'
                  : 'text-gray-400'
              }`}>
                {h}
              </span>
            </div>
          ))}
        </div>

        {/* Summary stats */}
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Total Booked</span>
            <span className="text-xs text-gray-900">
              {formatMinutes(summary.totalBookedMinutes)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Idle Capacity</span>
            <span className={`text-xs ${
              summary.idleMinutes > summary.totalBookedMinutes ? 'text-amber-600' : 'text-gray-900'
            }`}>
              {formatMinutes(summary.idleMinutes)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Bookings</span>
            <span className="text-xs text-gray-900">
              {summary.totalBookings}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UtilizationPanel;
