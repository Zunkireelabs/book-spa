import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { getTodayInsights } from '../../../services/api';
import { PERIOD_PRESETS } from '../../../utils/periodPresets';

const PERIOD_LABELS = { ...Object.fromEntries(PERIOD_PRESETS.map(p => [p.id, p.label])), daily: 'Today' };
function periodLabel(period) {
  if (!period || period.key === 'daily') return 'Today';
  if (period.key === 'custom') return `${period.from} – ${period.to}`;
  return PERIOD_LABELS[period.key] || 'Selected Period';
}

function formatNPR(amount, compact = false) {
  const num = Number(amount);
  if (compact && num >= 100000) {
    return `NPR ${(num / 1000).toFixed(0)}K`;
  }
  return `NPR ${num.toLocaleString('en-IN')}`;
}

const PAYMENT_TILES = [
  { key: 'cash', label: 'Cash', icon: 'Banknote' },
  { key: 'card', label: 'Card', icon: 'CreditCard' },
  { key: 'digital', label: 'Digital', icon: 'Smartphone' },
  { key: 'wallet', label: 'Wallet', icon: 'Wallet' },
];

const TodayInsightsPanel = ({ branchId, period }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadInsights = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);

    const result = await getTodayInsights(branchId, period?.from, period?.to);

    if (result.error) {
      setError(result.error.message || "Failed to load today's insights.");
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId, period?.from, period?.to]);

  useEffect(() => { loadInsights(); }, [loadInsights]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 lg:p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-16 sm:w-24 mb-2 sm:mb-3" />
            <div className="h-6 sm:h-7 bg-gray-100 rounded w-20 sm:w-32 mb-2" />
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
        <button onClick={loadInsights} className="sm:ml-auto text-xs sm:text-sm font-medium text-red-600 underline self-start sm:self-auto">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-2 sm:space-y-3">
      {/* Total Sales — primary highlighted tile */}
      <div className="bg-white rounded-lg border border-primary/30 ring-1 ring-primary/10 p-3 sm:p-4 lg:p-5">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <Icon name="TrendingUp" size={16} className="text-primary" />
          </div>
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Sales — {periodLabel(period)}</span>
        </div>
        <p className="text-xl sm:text-2xl font-semibold text-gray-900">{formatNPR(data.totalSales)}</p>
      </div>

      {/* Payment method breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        {PAYMENT_TILES.map(tile => (
          <div key={tile.key} className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 lg:p-5">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-gray-100 rounded-md sm:rounded-lg flex items-center justify-center flex-shrink-0">
                <Icon name={tile.icon} size={14} className="sm:w-4 sm:h-4 text-gray-600" />
              </div>
              <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
                {tile.label}
              </span>
            </div>
            <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900">
              <span className="sm:hidden">{formatNPR(data[tile.key], true)}</span>
              <span className="hidden sm:inline">{formatNPR(data[tile.key])}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Membership / Voucher / Utilization activity */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 lg:p-5">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
            <div className="w-6 h-6 sm:w-8 sm:h-8 bg-gray-100 rounded-md sm:rounded-lg flex items-center justify-center flex-shrink-0">
              <Icon name="Award" size={14} className="sm:w-4 sm:h-4 text-gray-600" />
            </div>
            <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
              Membership Redeemed
            </span>
          </div>
          <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900">
            <span className="sm:hidden">{formatNPR(data.membershipRedeemed.value, true)}</span>
            <span className="hidden sm:inline">{formatNPR(data.membershipRedeemed.value)}</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.membershipRedeemed.count} {data.membershipRedeemed.count === 1 ? 'redemption' : 'redemptions'}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 lg:p-5">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
            <div className="w-6 h-6 sm:w-8 sm:h-8 bg-gray-100 rounded-md sm:rounded-lg flex items-center justify-center flex-shrink-0">
              <Icon name="Gift" size={14} className="sm:w-4 sm:h-4 text-gray-600" />
            </div>
            <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
              Voucher Claimed
            </span>
          </div>
          <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900">
            <span className="sm:hidden">{formatNPR(data.voucherClaimed.value, true)}</span>
            <span className="hidden sm:inline">{formatNPR(data.voucherClaimed.value)}</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.voucherClaimed.count} {data.voucherClaimed.count === 1 ? 'claim' : 'claims'}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 lg:p-5">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
            <div className="w-6 h-6 sm:w-8 sm:h-8 bg-gray-100 rounded-md sm:rounded-lg flex items-center justify-center flex-shrink-0">
              <Icon name="Ticket" size={14} className="sm:w-4 sm:h-4 text-gray-600" />
            </div>
            <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
              Voucher Distributed
            </span>
          </div>
          <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900">
            <span className="sm:hidden">{formatNPR(data.voucherDistributed.value, true)}</span>
            <span className="hidden sm:inline">{formatNPR(data.voucherDistributed.value)}</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.voucherDistributed.count} {data.voucherDistributed.count === 1 ? 'voucher' : 'vouchers'}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 lg:p-5">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
            <div className="w-6 h-6 sm:w-8 sm:h-8 bg-gray-100 rounded-md sm:rounded-lg flex items-center justify-center flex-shrink-0">
              <Icon name="Users" size={14} className="sm:w-4 sm:h-4 text-gray-600" />
            </div>
            <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
              Staff Utilization
            </span>
          </div>
          <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900">
            {data.staffUtilization.avgPercent}%
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.staffUtilization.therapists.length} {data.staffUtilization.therapists.length === 1 ? 'therapist' : 'therapists'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default TodayInsightsPanel;
