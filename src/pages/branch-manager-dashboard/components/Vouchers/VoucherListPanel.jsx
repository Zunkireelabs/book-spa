import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchVouchers } from '../../../../services/api';
import VoucherDetailModal from './VoucherDetailModal';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_CONFIG = {
  unused:          { label: 'Not Claimed',      pill: 'bg-gray-100 text-gray-600',    icon: 'Circle' },
  partially_used:  { label: 'Partially Claimed', pill: 'bg-warning/10 text-warning',  icon: 'CircleDashed' },
  fully_redeemed:  { label: 'Claimed',           pill: 'bg-success/10 text-success',  icon: 'CheckCircle2' },
};

const SUMMARY_FILTERS = [
  { key: 'all',             label: 'Total',            icon: 'Ticket',        color: 'text-text-primary', bg: 'bg-background' },
  { key: 'unused',          label: 'Not Claimed',      icon: 'Circle',        color: 'text-text-secondary', bg: 'bg-gray-50' },
  { key: 'partially_used',  label: 'Partially Claimed', icon: 'CircleDashed', color: 'text-warning',      bg: 'bg-warning/5' },
  { key: 'fully_redeemed',  label: 'Claimed',           icon: 'CheckCircle2', color: 'text-success',      bg: 'bg-success/5' },
];

// Alphabetical (by guest name) list of every issued voucher, each with a live
// Claimed / Partially Claimed / Not Claimed pill computed from voucher_claims
// (via the voucher_balances view) — replaces the "Vouchers Issued" +
// "Balance Tracking" sheets from the old Excel workbook.
const VoucherListPanel = () => {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await fetchVouchers();
    if (fetchError) {
      setError(fetchError.message || 'Failed to load vouchers.');
      setLoading(false);
      return;
    }
    setVouchers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const summary = useMemo(() => ({
    all: vouchers.length,
    unused: vouchers.filter((v) => v.status === 'unused').length,
    partially_used: vouchers.filter((v) => v.status === 'partially_used').length,
    fully_redeemed: vouchers.filter((v) => v.status === 'fully_redeemed').length,
  }), [vouchers]);

  const totals = useMemo(() => ({
    issued: vouchers.reduce((sum, v) => sum + v.totalAmountIssued, 0),
    claimed: vouchers.reduce((sum, v) => sum + v.totalClaimed, 0),
    outstanding: vouchers.reduce((sum, v) => sum + v.remainingBalance, 0),
  }), [vouchers]);

  const filtered = useMemo(() => {
    let rows = vouchers;
    if (statusFilter !== 'all') rows = rows.filter((v) => v.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((v) =>
        v.guestName.toLowerCase().includes(q) ||
        v.voucherCode.toLowerCase().includes(q) ||
        v.voucherTypeName.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => a.guestName.localeCompare(b.guestName));
  }, [vouchers, search, statusFilter]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-surface rounded-spa-lg border border-border p-4 animate-pulse">
              <div className="h-3 bg-background rounded w-16 mb-2" />
              <div className="h-6 bg-background rounded w-10" />
            </div>
          ))}
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-8 animate-pulse">
          <div className="h-4 bg-background rounded w-48 mb-4" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-10 bg-background rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Vouchers</h3>
        <p className="font-body text-sm text-text-secondary">
          {vouchers.length} voucher{vouchers.length !== 1 ? 's' : ''} issued · {formatNPR(totals.issued)} issued · {formatNPR(totals.claimed)} claimed
        </p>
      </div>

      {/* Summary filter cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SUMMARY_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={`text-left rounded-spa-lg border p-4 spa-transition-fast ${
              statusFilter === f.key ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/30'
            } ${f.bg}`}
          >
            <div className="flex items-center space-x-2 mb-2">
              <Icon name={f.icon} size={14} className={f.color} />
              <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">{f.label}</span>
            </div>
            <p className={`font-heading font-heading-semibold text-xl ${f.color}`}>{summary[f.key]}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search by guest, voucher code, or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-spa text-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        {statusFilter !== 'all' && (
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-spa bg-primary/10 text-primary text-xs font-caption font-caption-medium spa-transition-fast hover:bg-primary/20"
          >
            <span>{STATUS_CONFIG[statusFilter]?.label || statusFilter}</span>
            <Icon name="X" size={12} />
          </button>
        )}
        <span className="font-caption font-caption-normal text-xs text-text-tertiary">
          {filtered.length} voucher{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Voucher list */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="Ticket" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body font-body-medium text-sm text-text-secondary">
              {vouchers.length === 0 ? 'No vouchers issued yet' : 'No vouchers match your search'}
            </p>
            {vouchers.length === 0 && (
              <p className="font-caption text-xs text-text-tertiary mt-1">
                Issue one from "All Voucher" to get started.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Guest</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Voucher Code</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Type</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Branch</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Expiry</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Issued</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Remaining</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => {
                  const cfg = STATUS_CONFIG[v.status] || STATUS_CONFIG.unused;
                  return (
                    <tr
                      key={v.id}
                      onClick={() => setSelectedId(v.id)}
                      className="border-b border-border last:border-0 hover:bg-background/50 cursor-pointer spa-transition-fast"
                    >
                      <td className="px-4 py-3">
                        <span className="font-body font-body-medium text-sm text-text-primary">{v.guestName}</span>
                        {v.isWallet && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium bg-primary/10 text-primary">
                            Wallet
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-data font-data-normal text-xs text-text-secondary tracking-wide">{v.voucherCode}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-body font-body-normal text-sm text-text-secondary">{v.voucherTypeName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-body font-body-normal text-sm text-text-secondary">{v.branchName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-caption text-xs text-text-tertiary">{formatDate(v.expiryDate)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-data font-data-normal text-sm text-text-secondary">{formatNPR(v.totalAmountIssued)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-data font-data-medium text-sm text-primary">{formatNPR(v.remainingBalance)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${cfg.pill}`}>
                          <Icon name={cfg.icon} size={11} />
                          <span>{cfg.label}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-background border-t-2 border-border">
                  <td colSpan={5} className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{formatNPR(totals.issued)}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-primary">{formatNPR(totals.outstanding)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {selectedId && (
        <VoucherDetailModal
          voucherId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={loadData}
        />
      )}
    </div>
  );
};

export default VoucherListPanel;
