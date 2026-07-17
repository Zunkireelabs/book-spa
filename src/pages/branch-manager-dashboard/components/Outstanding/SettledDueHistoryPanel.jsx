import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import { getSettledDueHistory } from '../../../../services/api';
import { humanizePaymentMethod } from '../../../../services/paymentMethods';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDateOnly(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

const SettledDueHistoryPanel = ({ branchId }) => {
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
    const { data, error: err } = await getSettledDueHistory({ branchId, from: range.from, to: range.to });
    if (err) {
      setError(err.message || 'Failed to load settled history.');
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

  const presetItems = [
    { label: 'All Time', active: mode === 'all', onClick: () => setMode('all') },
    ...PERIOD_PRESETS.map((p) => ({
      label: p.label,
      active: mode === 'preset' && activePreset === p.id,
      onClick: () => { setMode('preset'); setActivePreset(p.id); },
    })),
  ];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.customerName || '').toLowerCase().includes(q) ||
      (r.customerPhone || '').toLowerCase().includes(q) ||
      (r.bookingNumber || '').toLowerCase().includes(q) ||
      (r.serviceName || '').toLowerCase().includes(q) ||
      (r.dueHolderName || '').toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  const totalSettled = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.finalAmount || 0), 0),
    [filtered]
  );

  const handleExportCSV = () => {
    if (!filtered.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Customer', 'Phone', 'Responsible Person', 'Booking #', 'Date', 'Service', 'Amount', 'Settled On', 'Paid Via'];
    let csv = header.join(',') + '\n';
    filtered.forEach((r) => {
      csv += [
        esc(r.customerName),
        esc(r.customerPhone),
        esc(r.dueHolderName),
        esc(r.bookingNumber),
        esc(formatDateOnly(r.date)),
        esc(r.serviceName),
        esc(r.finalAmount),
        esc(formatDateOnly(r.settledAt)),
        esc(r.paymentModes.map(humanizePaymentMethod).join(', ')),
      ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'settled-due-history.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Settled History</h3>
          <p className="font-body text-sm text-text-secondary">
            {loading
              ? 'Loading…'
              : `${formatNPR(totalSettled)} settled across ${filtered.length} booking${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {filtered.length > 0 && (
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-surface font-body font-body-medium text-sm text-text-secondary hover:bg-background spa-transition-fast flex-shrink-0"
          >
            <Icon name="Download" size={16} />
            <span>Export CSV</span>
          </button>
        )}
      </div>

      <FilterBar
        count={{ value: filtered.length, label: filtered.length === 1 ? 'Booking' : 'Bookings' }}
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search by person, customer, or booking…' }}
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

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">Loading settled history...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="History" size={32} className="text-text-secondary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">
              {rows.length === 0 ? 'No settled dues yet in this range.' : 'No results match the current filters.'}
            </p>
          </div>
        ) : (
          <div className={`overflow-x-auto ${filtered.length > 10 ? 'max-h-[640px] overflow-y-auto' : ''}`}>
            <table className="w-full">
              <thead className="sticky top-0 z-sticky-filter">
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Customer</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Responsible Person</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Settled On</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Paid Via</th>
                  <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.bookingId} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                    <td className="px-4 py-3">
                      <div className="font-body font-body-medium text-sm text-text-primary">{r.customerName}</div>
                      <div className="font-caption text-xs text-text-tertiary">{r.customerPhone || '—'}</div>
                      <div className="font-body text-xs text-text-secondary">
                        #{r.bookingNumber} · {r.serviceName} · {formatDateOnly(r.date)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body font-body-medium text-sm text-text-primary">{r.dueHolderName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body text-sm text-text-primary">{formatDateOnly(r.settledAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.paymentModes.map((m) => (
                          <span
                            key={m}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption bg-success/10 text-success"
                          >
                            {humanizePaymentMethod(m)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-data text-sm text-text-primary">
                      {formatNPR(r.finalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettledDueHistoryPanel;
