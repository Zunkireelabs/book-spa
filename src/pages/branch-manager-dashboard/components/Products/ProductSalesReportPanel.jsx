import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import FilterBar from '../../../../components/ui/FilterBar';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import { fetchProductSales, refundProductSale } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Sales trends + the ability to undo a sale — the two gaps that made
// "you can sell, but can't see trends or fix a mistake" no longer true.
// Aggregates are computed client-side from the org's product_sales rows
// (already RLS-scoped) — no new backend aggregation needed at this scale.
const ProductSalesReportPanel = () => {
  const today = getTodayISO();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [mode, setMode] = useState('all');
  const [activePreset, setActivePreset] = useState('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const [confirmRefund, setConfirmRefund] = useState(null);
  const [refunding, setRefunding] = useState(false);
  const [refundReason, setRefundReason] = useState('');

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
    const { data, error: err } = await fetchProductSales({ limit: 1000, from: range.from, to: range.to });
    if (err) {
      setError(err.message || 'Failed to load sales.');
    } else {
      setSales(data || []);
    }
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const handleCustomApply = () => {
    if (!customFrom) return;
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setMode('custom');
  };

  const activeSales = sales.filter((s) => !s.refunded_at);

  const totals = useMemo(() => {
    const revenue = activeSales.reduce((sum, s) => sum + Number(s.total_amount), 0);
    const units = activeSales.reduce((sum, s) => sum + s.quantity, 0);
    return { revenue, units, count: activeSales.length };
  }, [activeSales]);

  const topProducts = useMemo(() => {
    const byProduct = {};
    activeSales.forEach((s) => {
      if (!byProduct[s.product_name]) byProduct[s.product_name] = { name: s.product_name, revenue: 0, units: 0 };
      byProduct[s.product_name].revenue += Number(s.total_amount);
      byProduct[s.product_name].units += s.quantity;
    });
    return Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [activeSales]);

  const handleExportCSV = () => {
    if (!sales.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Product', 'Qty', 'Amount', 'Payment', 'Customer', 'Sold By', 'Date', 'Refunded'];
    let csv = header.join(',') + '\n';
    sales.forEach((s) => {
      csv += [
        esc(s.product_name), esc(s.quantity), esc(s.total_amount), esc(s.payment_mode),
        esc(s.customers?.full_name || ''), esc(s.users?.full_name || ''), esc(formatDate(s.created_at)),
        esc(s.refunded_at ? 'Yes' : 'No'),
      ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'product-sales-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRefund = async () => {
    if (!confirmRefund) return;
    setRefunding(true);
    const result = await refundProductSale({ saleId: confirmRefund.id, reason: refundReason.trim() || null });
    if (result.error) {
      setError(result.error.message || 'Refund failed.');
    } else {
      await load();
    }
    setConfirmRefund(null);
    setRefundReason('');
    setRefunding(false);
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
        <p className="font-body text-sm text-text-secondary">Loading sales report...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Sales Report</h3>
          <p className="font-body text-sm text-text-secondary">
            {formatNPR(totals.revenue)} across {totals.count} sale{totals.count !== 1 ? 's' : ''}
          </p>
        </div>
        {sales.length > 0 && (
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface border border-border rounded-spa p-4">
          <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Revenue</p>
          <p className="font-data text-xl text-text-primary">{formatNPR(totals.revenue)}</p>
        </div>
        <div className="bg-surface border border-border rounded-spa p-4">
          <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Units Sold</p>
          <p className="font-data text-xl text-text-primary">{totals.units}</p>
        </div>
        <div className="bg-surface border border-border rounded-spa p-4">
          <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Sales</p>
          <p className="font-data text-xl text-text-primary">{totals.count}</p>
        </div>
      </div>

      {/* Top products */}
      {topProducts.length > 0 && (
        <div className="bg-surface border border-border rounded-spa overflow-hidden">
          <div className="px-4 py-3 bg-background border-b border-border">
            <p className="font-body font-body-medium text-sm text-text-primary">Top Products</p>
          </div>
          <table className="w-full">
            <tbody>
              {topProducts.map((p, i) => (
                <tr key={p.name} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 font-data text-xs text-text-tertiary w-6">{i + 1}</td>
                  <td className="px-4 py-2.5 font-body text-sm text-text-primary">{p.name}</td>
                  <td className="px-4 py-2.5 font-body text-sm text-text-secondary text-right">{p.units} sold</td>
                  <td className="px-4 py-2.5 font-data text-sm text-text-primary text-right">{formatNPR(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Full sales list */}
      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Product</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Qty</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Amount</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">Payment</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">Customer</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Date</th>
              <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  No sales in this period.
                </td>
              </tr>
            ) : (
              sales.map((s) => (
                <tr key={s.id} className={`border-b border-border last:border-b-0 ${s.refunded_at ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-body text-sm text-text-primary">{s.product_name}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary">{s.quantity}</td>
                  <td className="px-4 py-3 font-data text-sm text-text-primary">{formatNPR(s.total_amount)}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary hidden md:table-cell">{s.payment_mode}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary hidden md:table-cell">{s.customers?.full_name || '—'}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary">{formatDate(s.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      {s.refunded_at ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption bg-error/10 text-error" title={s.refund_reason || ''}>
                          Refunded
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmRefund(s)}
                          className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                          title="Refund"
                        >
                          <Icon name="Undo2" size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Refund Confirmation Dialog */}
      {confirmRefund && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !refunding && setConfirmRefund(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="Undo2" size={20} className="text-error" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Refund this sale?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmRefund.product_name}" × {confirmRefund.quantity} — {formatNPR(confirmRefund.total_amount)}. This marks the sale as refunded and cannot be undone.
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">
                Reason <span className="text-text-tertiary font-normal">(optional)</span>
              </label>
              <input
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g. Customer changed their mind"
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmRefund(null)} disabled={refunding}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleRefund} loading={refunding}>Refund</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductSalesReportPanel;
