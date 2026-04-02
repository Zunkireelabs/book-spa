import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { getRevenueIntelligence } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

function computeDelta(today, yesterday) {
  if (!yesterday || yesterday === 0) {
    return today > 0 ? { value: '+100%', type: 'positive' } : { value: '—', type: 'neutral' };
  }
  const pct = ((today - yesterday) / yesterday) * 100;
  if (pct > 0) return { value: `+${pct.toFixed(1)}%`, type: 'positive' };
  if (pct < 0) return { value: `${pct.toFixed(1)}%`, type: 'negative' };
  return { value: '0%', type: 'neutral' };
}

const PERIOD_CONFIG = [
  { key: 'today', label: 'Today', icon: 'CalendarCheck' },
  { key: 'yesterday', label: 'Yesterday', icon: 'CalendarMinus' },
  { key: 'weekToDate', label: 'Week to Date', icon: 'CalendarRange' },
  { key: 'monthToDate', label: 'Month to Date', icon: 'CalendarDays' },
];

const RevenueCards = ({ branchId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadRevenue = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const result = await getRevenueIntelligence({ branchId });

    if (result.error) {
      setError(result.error.message || 'Failed to load revenue data.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadRevenue(); }, [loadRevenue]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-24 mb-3" />
            <div className="h-7 bg-gray-100 rounded w-32 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-20" />
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
        <button onClick={loadRevenue} className="ml-auto text-sm font-medium text-red-600 underline">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  // Compute deltas: today vs yesterday
  const netDelta = computeDelta(data.today.netRevenue, data.yesterday.netRevenue);
  const bookingsDelta = computeDelta(data.today.paidBookings, data.yesterday.paidBookings);

  return (
    <div className="space-y-3">
      {/* Revenue Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {PERIOD_CONFIG.map((period) => {
          const periodData = data[period.key];
          if (!periodData) return null;

          const isToday = period.key === 'today';

          return (
            <div
              key={period.key}
              className={`bg-white rounded-lg border p-5 ${
                isToday ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    isToday ? 'bg-blue-50' : 'bg-gray-100'
                  }`}>
                    <Icon name={period.icon} size={16} className={isToday ? 'text-blue-600' : 'text-gray-500'} />
                  </div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {period.label}
                  </span>
                </div>
                {isToday && netDelta.type !== 'neutral' && (
                  <span className={`inline-flex items-center space-x-0.5 text-xs font-medium ${
                    netDelta.type === 'positive' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    <Icon name={netDelta.type === 'positive' ? 'TrendingUp' : 'TrendingDown'} size={12} />
                    <span>{netDelta.value}</span>
                  </span>
                )}
              </div>

              {/* Net Revenue (primary figure) */}
              <div className="mb-3">
                <p className="text-xl font-semibold text-gray-900">
                  {formatNPR(periodData.netRevenue)}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Net Revenue
                </p>
              </div>

              {/* Breakdown */}
              <div className="space-y-1.5 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Gross</span>
                  <span className="text-xs text-gray-900">
                    {formatNPR(periodData.grossRevenue)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Discounts</span>
                  <span className={`text-xs ${
                    periodData.totalDiscount > 0 ? 'text-red-600' : 'text-gray-900'
                  }`}>
                    {periodData.totalDiscount > 0 ? '-' : ''}{formatNPR(periodData.totalDiscount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Paid</span>
                  <span className="text-xs text-gray-900">
                    {periodData.paidBookings} {periodData.paidBookings === 1 ? 'booking' : 'bookings'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Today vs Yesterday delta summary */}
      {(netDelta.type !== 'neutral' || bookingsDelta.type !== 'neutral') && (
        <div className="flex items-center space-x-4 px-1">
          <span className="text-[11px] text-gray-400">
            vs Yesterday:
          </span>
          <span className={`inline-flex items-center space-x-1 text-[11px] font-medium ${
            netDelta.type === 'positive' ? 'text-green-600' : netDelta.type === 'negative' ? 'text-red-600' : 'text-gray-400'
          }`}>
            <Icon name={netDelta.type === 'positive' ? 'TrendingUp' : netDelta.type === 'negative' ? 'TrendingDown' : 'Minus'} size={10} />
            <span>{netDelta.value} revenue</span>
          </span>
          <span className={`inline-flex items-center space-x-1 text-[11px] font-medium ${
            bookingsDelta.type === 'positive' ? 'text-green-600' : bookingsDelta.type === 'negative' ? 'text-red-600' : 'text-gray-400'
          }`}>
            <Icon name={bookingsDelta.type === 'positive' ? 'TrendingUp' : bookingsDelta.type === 'negative' ? 'TrendingDown' : 'Minus'} size={10} />
            <span>{bookingsDelta.value} bookings</span>
          </span>
        </div>
      )}
    </div>
  );
};

export default RevenueCards;
