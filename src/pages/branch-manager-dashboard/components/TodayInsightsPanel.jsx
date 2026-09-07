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

const PAYMENT_SEGMENTS = [
  { key: 'cash', label: 'Cash', barClass: 'bg-primary', dotClass: 'bg-primary' },
  { key: 'card', label: 'Card', barClass: 'bg-accent', dotClass: 'bg-accent' },
  { key: 'digital', label: 'Digital', barClass: 'bg-secondary', dotClass: 'bg-secondary' },
  { key: 'wallet', label: 'Wallet', barClass: 'bg-gray-400', dotClass: 'bg-gray-400' },
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
      <div className="bg-surface border border-border rounded-spa-lg shadow-spa-resting p-4 sm:p-5 animate-pulse space-y-4">
        <div className="h-4 bg-gray-100 rounded w-32" />
        <div className="h-8 bg-gray-100 rounded w-48" />
        <div className="h-3 bg-gray-100 rounded w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-spa-lg p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
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

  const totalSales = Number(data.totalSales) || 0;
  const hasSales = totalSales > 0;

  const utilizationPercent = Math.max(0, Math.min(100, Number(data.staffUtilization.avgPercent) || 0));
  const therapistCount = data.staffUtilization.therapists.length;

  return (
    <div className="bg-surface border border-border rounded-spa-lg shadow-spa-resting divide-y divide-border">
      {/* Section 1 — Total Sales + payment mix */}
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Total Sales · {periodLabel(period)}
          </span>
        </div>
        <p className="text-2xl font-semibold text-gray-900">{formatNPR(totalSales)}</p>

        {hasSales ? (
          <div className="w-full h-2.5 rounded-full overflow-hidden bg-gray-100 flex">
            {PAYMENT_SEGMENTS.map(seg => {
              const value = Number(data[seg.key]) || 0;
              const pct = (value / totalSales) * 100;
              if (pct <= 0) return null;
              return <div key={seg.key} className={seg.barClass} style={{ width: `${pct}%` }} />;
            })}
          </div>
        ) : (
          <div className="w-full h-2.5 rounded-full bg-gray-100" />
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {PAYMENT_SEGMENTS.map(seg => (
            <div key={seg.key} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className={`w-2 h-2 rounded-full ${seg.dotClass}`} />
              <span>{seg.label} {formatNPR(data[seg.key], true)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2 — Sold vs Redeemed */}
      <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-3">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Sold (value in)</span>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Memberships</span>
            <span className="text-sm font-semibold text-gray-900">
              {data.membershipSold.count} · {formatNPR(data.membershipSold.value)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Gift Vouchers</span>
            <span className="text-sm font-semibold text-gray-900">
              {data.voucherDistributed.count} · {formatNPR(data.voucherDistributed.value)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Packages</span>
            <span className="text-sm font-semibold text-gray-900">
              {data.packageSold.count} · {formatNPR(data.packageSold.value)}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Redeemed (value used)</span>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Memberships</span>
            <span className="text-sm font-semibold text-gray-900">
              {data.membershipRedeemed.count} · {formatNPR(data.membershipRedeemed.value)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Gift Vouchers</span>
            <span className="text-sm font-semibold text-gray-900">
              {data.voucherClaimed.count} · {formatNPR(data.voucherClaimed.value)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Packages</span>
            <span className="text-sm font-semibold text-gray-900">
              {data.packageRedeemed.count} sessions
            </span>
          </div>
        </div>
      </div>

      {/* Section 3 — Therapist utilization */}
      <div className="p-4 sm:p-5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Therapist Utilization · {utilizationPercent}%
          </span>
          <span className="text-xs text-gray-500">
            {therapistCount} {therapistCount === 1 ? 'therapist' : 'therapists'}
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full bg-primary rounded-full" style={{ width: `${utilizationPercent}%` }} />
        </div>
      </div>
    </div>
  );
};

export default TodayInsightsPanel;
