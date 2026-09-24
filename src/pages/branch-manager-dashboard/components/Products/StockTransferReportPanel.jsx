import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import { useBranch } from '../../../../contexts/BranchContext';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import { fetchProductStockTransfers } from '../../../../services/api';

function formatDateTime(d) {
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// The full, searchable history behind the small "Recent activity" list
// inside the Receive/Transfer Stock modal (which only ever shows the last
// 10 for one product). Every transfer already shows on both sides — the
// "From" and "To" branches are just columns on the same row, not separate
// records — so switching the branch selector (top nav) here filters to
// "this branch was either side of it," same as the modal's per-product
// history does.
const StockTransferReportPanel = () => {
  const { branchId, branchName, isOverall } = useBranch();
  const today = getTodayISO();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [mode, setMode] = useState('preset');
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
    const { data, error: err } = await fetchProductStockTransfers({
      limit: 1000,
      branchId: isOverall ? null : branchId,
      from: range.from,
      to: range.to,
    });
    if (err) {
      setError(err.message || 'Failed to load stock transfers.');
    } else {
      setTransfers(data || []);
    }
    setLoading(false);
  }, [branchId, isOverall, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const handleCustomApply = () => {
    if (!customFrom) return;
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setMode('custom');
  };

  const totals = useMemo(() => {
    const units = transfers.reduce((sum, t) => sum + t.quantity, 0);
    const received = isOverall ? null : transfers.filter((t) => t.to_branch_id === branchId).reduce((sum, t) => sum + t.quantity, 0);
    const sent = isOverall ? null : transfers.filter((t) => t.from_branch_id === branchId).reduce((sum, t) => sum + t.quantity, 0);
    return { count: transfers.length, units, received, sent };
  }, [transfers, isOverall, branchId]);

  const handleExportCSV = () => {
    if (!transfers.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Product', 'From', 'To', 'Quantity', 'Note', 'By', 'Date'];
    let csv = header.join(',') + '\n';
    transfers.forEach((t) => {
      csv += [
        esc(t.products?.name), esc(t.from_branch?.name || 'New stock'), esc(t.to_branch?.name),
        esc(t.quantity), esc(t.note || ''), esc(t.users?.full_name || ''), esc(formatDateTime(t.created_at)),
      ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'stock-transfers-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const presetItems = [
    { label: 'All Time', active: mode === 'all', onClick: () => setMode('all') },
    ...PERIOD_PRESETS.map((p) => ({
      label: p.label,
      active: isPreset && activePreset === p.id,
      onClick: () => { setMode('preset'); setActivePreset(p.id); },
    })),
  ];

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading stock transfers...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Stock Transfers</h3>
          <p className="font-body text-sm text-text-secondary">
            {totals.count} transfer{totals.count !== 1 ? 's' : ''} · {totals.units} unit{totals.units !== 1 ? 's' : ''} moved
            {isOverall ? ' — all branches' : ` — ${branchName}`}
          </p>
        </div>
        {transfers.length > 0 && (
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-surface font-body font-body-medium text-sm text-text-secondary hover:bg-background spa-transition-fast flex-shrink-0"
          >
            <Icon name="Download" size={16} />
            <span>Export CSV</span>
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <FilterBar
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
      />

      {/* Summary cards */}
      <div className={`grid grid-cols-1 gap-3 ${isOverall ? 'sm:grid-cols-2' : 'sm:grid-cols-4'}`}>
        <div className="bg-surface border border-border rounded-spa p-4">
          <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Transfers</p>
          <p className="font-data text-xl text-text-primary">{totals.count}</p>
        </div>
        <div className="bg-surface border border-border rounded-spa p-4">
          <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Units Moved</p>
          <p className="font-data text-xl text-text-primary">{totals.units}</p>
        </div>
        {!isOverall && (
          <>
            <div className="bg-surface border border-border rounded-spa p-4">
              <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Received</p>
              <p className="font-data text-xl text-success">+{totals.received}</p>
            </div>
            <div className="bg-surface border border-border rounded-spa p-4">
              <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Sent Out</p>
              <p className="font-data text-xl text-text-primary">-{totals.sent}</p>
            </div>
          </>
        )}
      </div>

      {/* Full transfer list */}
      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Product</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">From</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">To</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Qty</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">By</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Date</th>
            </tr>
          </thead>
          <tbody>
            {transfers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  No stock transfers in this period.
                </td>
              </tr>
            ) : (
              transfers.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-body text-sm text-text-primary">{t.products?.name}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary">{t.from_branch?.name || 'New stock'}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary">{t.to_branch?.name}</td>
                  <td className="px-4 py-3 font-data text-sm text-text-primary">+{t.quantity}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary hidden md:table-cell">{t.users?.full_name || '—'}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary">{formatDateTime(t.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StockTransferReportPanel;
