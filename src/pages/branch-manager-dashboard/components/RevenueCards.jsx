import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { getRevenueIntelligence } from '../../../services/api';

function formatNPR(amount, compact = false) {
  const num = Number(amount);
  if (compact && num >= 100000) {
    return `NPR ${(num / 1000).toFixed(0)}K`;
  }
  return `NPR ${num.toLocaleString('en-IN')}`;
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
  { key: 'today', label: 'Today', shortLabel: 'Today', icon: 'CalendarCheck' },
  { key: 'yesterday', label: 'Yesterday', shortLabel: 'Yest.', icon: 'CalendarMinus' },
  { key: 'weekToDate', label: 'Week to Date', shortLabel: 'WTD', icon: 'CalendarRange' },
  { key: 'monthToDate', label: 'Month to Date', shortLabel: 'MTD', icon: 'CalendarDays' },
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 lg:p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-16 sm:w-24 mb-2 sm:mb-3" />
            <div className="h-6 sm:h-7 bg-gray-100 rounded w-20 sm:w-32 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-14 sm:w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <Icon name="AlertCircle" size={18} className="text-red-600 flex-shrink-0" />
          <p className="text-xs sm:text-sm text-red-600">{error}</p>
        </div>
        <button onClick={loadRevenue} className="sm:ml-auto text-xs sm:text-sm font-medium text-red-600 underline self-start sm:self-auto">
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
    <div className="space-y-2 sm:space-y-3">
      {/* Revenue Cards - 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        {PERIOD_CONFIG.map((period) => {
          const periodData = data[period.key];
          if (!periodData) return null;

          const isToday = period.key === 'today';

          return (
            <div
              key={period.key}
              className={`bg-white rounded-lg border p-3 sm:p-4 lg:p-5 ${
                isToday ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'
              }`}
            >
              {/* Header - Responsive */}
              <div className="flex items-start sm:items-center justify-between mb-2 sm:mb-3 gap-1">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isToday ? 'bg-blue-50' : 'bg-gray-100'
                  }`}>
                    <Icon name={period.icon} size={14} className={`sm:w-4 sm:h-4 ${isToday ? 'text-blue-600' : 'text-gray-500'}`} />
                  </div>
                  {/* Short label on mobile, full on desktop */}
                  <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
                    <span className="sm:hidden">{period.shortLabel}</span>
                    <span className="hidden sm:inline">{period.label}</span>
                  </span>
                </div>
                {isToday && netDelta.type !== 'neutral' && (
                  <span className={`inline-flex items-center gap-0.5 text-[10px] sm:text-xs font-medium flex-shrink-0 ${
                    netDelta.type === 'positive' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    <Icon name={netDelta.type === 'positive' ? 'TrendingUp' : 'TrendingDown'} size={12} className="sm:w-3 sm:h-3" />
                    <span className="hidden sm:inline">{netDelta.value}</span>
                  </span>
                )}
              </div>

              {/* Net Revenue (primary figure) */}
              <div className="mb-2 sm:mb-3">
                {/* Compact format on mobile for large numbers */}
                <p className="text-base sm:text-lg lg:text-xl font-semibold text-gray-900">
                  <span className="sm:hidden">{formatNPR(periodData.netRevenue, true)}</span>
                  <span className="hidden sm:inline">{formatNPR(periodData.netRevenue)}</span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Net Revenue
                </p>
              </div>

              {/* Breakdown - Hidden on mobile, shown on sm+ */}
              <div className="hidden sm:block space-y-1.5 pt-2 border-t border-gray-100">
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

              {/* Mobile: Compact breakdown - just paid count */}
              <div className="sm:hidden pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Paid</span>
                  <span className="text-xs text-gray-900 font-medium">
                    {periodData.paidBookings}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Today vs Yesterday delta summary - Responsive */}
      {(netDelta.type !== 'neutral' || bookingsDelta.type !== 'neutral') && (
        <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 px-1">
          <span className="text-xs text-gray-400">
            vs Yesterday:
          </span>
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
            netDelta.type === 'positive' ? 'text-green-600' : netDelta.type === 'negative' ? 'text-red-600' : 'text-gray-400'
          }`}>
            <Icon name={netDelta.type === 'positive' ? 'TrendingUp' : netDelta.type === 'negative' ? 'TrendingDown' : 'Minus'} size={12} />
            <span>{netDelta.value} <span className="hidden sm:inline">revenue</span></span>
          </span>
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
            bookingsDelta.type === 'positive' ? 'text-green-600' : bookingsDelta.type === 'negative' ? 'text-red-600' : 'text-gray-400'
          }`}>
            <Icon name={bookingsDelta.type === 'positive' ? 'TrendingUp' : bookingsDelta.type === 'negative' ? 'TrendingDown' : 'Minus'} size={12} />
            <span>{bookingsDelta.value} <span className="hidden sm:inline">bookings</span></span>
          </span>
        </div>
      )}
    </div>
  );
};

export default RevenueCards;
