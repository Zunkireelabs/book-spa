import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { getTipsSummary, markTipsDistributed, isOverallBranch } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'allTime', label: 'All-time' },
];

// Running Tip totals (collected vs pending vs already-distributed to staff) —
// not revenue, deliberately separate from RevenueCards. "Distributed" means a
// manager/admin has confirmed the cash was actually handed to staff
// (markTipsDistributed, migration-241 RPC) — the running "pending" figure is
// how much has been collected but not yet confirmed handed out.
const TipsSummaryCard = ({ branchId, userRole = 'staff' }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [distributing, setDistributing] = useState(false);
  const canDistribute = ['admin', 'manager'].includes(userRole) && !isOverallBranch(branchId);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    const result = await getTipsSummary(branchId);
    if (result.error) {
      setError(result.error.message || 'Failed to load tips.');
      setLoading(false);
      return;
    }
    setData(result.data);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleDistribute = async () => {
    if (!canDistribute || !data?.today) return;
    setDistributing(true);
    const result = await markTipsDistributed(branchId);
    setDistributing(false);
    if (!result.error) await load();
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 lg:p-5 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-24 mb-3" />
        <div className="h-6 bg-gray-100 rounded w-32" />
      </div>
    );
  }

  if (error || !data) return null;

  const allTimePending = data.allTime.pending;

  return (
    <div className="bg-white rounded-lg border border-gray-200 border-dashed p-3 sm:p-4 lg:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Icon name="Banknote" size={16} className="text-gray-500" />
          </div>
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Tips — Not Revenue, Passed to Staff
          </span>
        </div>
        {canDistribute && allTimePending > 0 && (
          <button
            onClick={handleDistribute}
            disabled={distributing}
            className="text-xs font-medium text-primary hover:underline disabled:opacity-50 flex-shrink-0"
          >
            {distributing ? 'Marking...' : `Mark ${formatNPR(allTimePending)} distributed`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {PERIODS.map(({ key, label }) => {
          const period = data[key];
          return (
            <div key={key} className="min-w-0">
              <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide truncate">{label}</p>
              <p className="text-sm sm:text-base font-semibold text-gray-900">{formatNPR(period.total)}</p>
              {period.pending > 0 && (
                <p className="text-[10px] sm:text-xs text-warning">{formatNPR(period.pending)} pending</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Who received it — all-time, so it's clear not just how much but WHO
          collected it and how much of THEIRS is still pending distribution. */}
      {data.byStaff.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 items-center">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide">Staff</span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wide text-right">Total</span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wide text-right">Distributed</span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wide text-right">Pending</span>
            {data.byStaff.map((s) => (
              <React.Fragment key={s.id || 'unspecified'}>
                <span className="text-xs text-gray-900 truncate">{s.name}</span>
                <span className="text-xs text-gray-900 text-right">{formatNPR(s.total)}</span>
                <span className="text-xs text-gray-500 text-right">{formatNPR(s.distributed)}</span>
                <span className={`text-xs text-right ${s.pending > 0 ? 'text-warning font-medium' : 'text-gray-400'}`}>
                  {formatNPR(s.pending)}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TipsSummaryCard;
