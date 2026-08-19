import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import { getReferralWalletReport } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_STYLES = {
  credited: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  void: 'bg-gray-100 text-gray-500',
};

// Flat, one-row-per-referral Referral Wallet ledger: who referred whom, how
// much wallet credit they were granted, whether they've spent any of it, when,
// and what's left. Distinct from CustomerReferralsReportPanel (grouped by
// referrer, no spend detail) — this is the money-tracking view.
const ReferralWalletPanel = ({ branchId }) => {
  const today = getTodayISO();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [mode, setMode] = useState('all'); // 'all' | 'preset' | 'custom'
  const [activePreset, setActivePreset] = useState('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const isPreset = mode === 'preset';

  const range = useMemo(() => {
    if (mode === 'all') return { from: undefined, to: undefined };
    if (mode === 'custom' && appliedFrom) {
      return { from: appliedFrom, to: appliedTo || today };
    }
    const r = getPeriodRange(activePreset);
    return { from: r.startDate, to: r.endDate };
  }, [mode, activePreset, appliedFrom, appliedTo, today]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await getReferralWalletReport({ branchId, from: range.from, to: range.to });
    if (err) {
      setError(err.message || 'Failed to load referral wallets.');
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, [branchId, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const handleCustomApply = () => {
    if (!customFrom) return;
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setMode('custom');
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.referrerName.toLowerCase().includes(q) ||
      r.referredCustomerName.toLowerCase().includes(q) ||
      (r.bookingNumber || '').toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  const totals = useMemo(() => filtered.reduce((acc, r) => ({
    granted: acc.granted + r.walletAmount,
    used: acc.used + r.usedAmount,
    remaining: acc.remaining + (r.remainingAmount || 0),
  }), { granted: 0, used: 0, remaining: 0 }), [filtered]);

  const presetItems = [
    { label: 'All Time', active: mode === 'all', onClick: () => setMode('all') },
    ...PERIOD_PRESETS.map((p) => ({
      label: p.label,
      active: isPreset && activePreset === p.id,
      onClick: () => { setMode('preset'); setActivePreset(p.id); },
    })),
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Referral Wallet</h3>
        <p className="font-body text-sm text-text-secondary">
          {loading ? 'Loading…' : `${filtered.length} referral${filtered.length !== 1 ? 's' : ''} · who referred whom, how much they got, and what's left`}
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface rounded-spa-lg border border-border p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/10">
              <Icon name="ArrowDownToLine" size={14} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">Total Granted</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-text-primary">{formatNPR(totals.granted)}</p>
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-warning/10">
              <Icon name="ArrowUpFromLine" size={14} className="text-warning" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">Total Used</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-warning">{formatNPR(totals.used)}</p>
        </div>
        <div className="bg-primary/5 rounded-spa-lg border border-primary/20 p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/15">
              <Icon name="Wallet" size={14} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-primary uppercase tracking-wide">Remaining</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-primary">{formatNPR(totals.remaining)}</p>
        </div>
      </div>

      {/* Filters */}
      <FilterBar
        count={{ value: filtered.length, label: filtered.length === 1 ? 'Referral' : 'Referrals' }}
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search by referrer, referred customer, or booking…' }}
        presets={presetItems}
        dateRange={{
          from: customFrom,
          onFromChange: setCustomFrom,
          to: customTo,
          onToChange: setCustomTo,
          max: today,
          onApply: handleCustomApply,
          applyDisabled: !customFrom || !customDirty,
          applyActive: mode === 'custom',
        }}
        hasActiveFilters={searchQuery.trim().length > 0}
        onClear={() => setSearchQuery('')}
      />

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">Loading referral wallets...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="Wallet" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">
              {rows.length === 0 ? 'No customer referrals logged in this period.' : 'No referrals match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Referred By</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Referred To</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Granted</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Used</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Used On</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Remaining</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.referralId} className="border-b border-border last:border-0 spa-transition-fast hover:bg-background/50">
                    <td className="px-4 py-3">
                      <span className="font-body font-body-medium text-sm text-text-primary">{r.referrerName}</span>
                      {r.referrerPhone && <span className="block font-caption text-xs text-text-tertiary">{r.referrerPhone}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body font-body-normal text-sm text-text-secondary">{r.referredCustomerName}</span>
                      {r.bookingNumber && (
                        <span className="block font-caption text-xs text-text-tertiary">
                          #{r.bookingNumber} · {formatDate(r.bookingDate)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-normal text-sm text-text-secondary">{formatNPR(r.walletAmount)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.used ? (
                        <span className="font-data font-data-medium text-sm text-warning">{formatNPR(r.usedAmount)}</span>
                      ) : (
                        <span className="font-data text-sm text-text-tertiary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body text-sm text-text-secondary">{r.used ? formatDate(r.usedAt) : '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-data font-data-medium text-sm text-primary">
                        {r.remainingAmount != null ? formatNPR(r.remainingAmount) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLES[r.rewardStatus] || STATUS_STYLES.pending}`}>
                        {r.rewardStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-background border-t-2 border-border">
                  <td colSpan={2} className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{formatNPR(totals.granted)}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-warning">{formatNPR(totals.used)}</td>
                  <td />
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-primary">{formatNPR(totals.remaining)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReferralWalletPanel;
