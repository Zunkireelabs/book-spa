import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchVoucherWallets } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_CONFIG = {
  unused:         { label: 'Not Claimed',       pill: 'bg-gray-100 text-gray-600',   icon: 'Circle' },
  partially_used: { label: 'Partially Claimed', pill: 'bg-warning/10 text-warning',  icon: 'CircleDashed' },
  fully_redeemed: { label: 'Claimed',            pill: 'bg-success/10 text-success', icon: 'CheckCircle2' },
};

// Wallet ("Worth Voucher") view — who issued it, from which branch, and the
// full claim breakdown (which branch claimed how much, and when) for every
// stored-value voucher, expandable per row. Standard fixed-service vouchers
// don't appear here — see "Voucher Issued" for the full list.
const VoucherWalletPanel = () => {
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await fetchVoucherWallets();
    if (fetchError) {
      setError(fetchError.message || 'Failed to load voucher wallets.');
      setLoading(false);
      return;
    }
    setWallets(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const totals = useMemo(() => wallets.reduce((acc, w) => ({
    issued: acc.issued + w.totalAmountIssued,
    claimed: acc.claimed + w.totalClaimed,
    remaining: acc.remaining + w.remainingBalance,
  }), { issued: 0, claimed: 0, remaining: 0 }), [wallets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = wallets;
    if (q) {
      rows = rows.filter((w) =>
        w.guestName.toLowerCase().includes(q) ||
        w.voucherCode.toLowerCase().includes(q) ||
        w.issuedBranchName.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => a.guestName.localeCompare(b.guestName));
  }, [wallets, search]);

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-surface rounded-spa-lg border border-border p-4 animate-pulse">
              <div className="h-3 bg-background rounded w-20 mb-2" />
              <div className="h-6 bg-background rounded w-24" />
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
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Wallet</h3>
        <p className="font-body text-sm text-text-secondary">
          {wallets.length} stored-value voucher{wallets.length !== 1 ? 's' : ''} · who issued it, which branch claimed, and what's left
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface rounded-spa-lg border border-border p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-primary/10">
              <Icon name="ArrowDownToLine" size={14} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">Total Issued</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-text-primary">{formatNPR(totals.issued)}</p>
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-warning/10">
              <Icon name="ArrowUpFromLine" size={14} className="text-warning" />
            </div>
            <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">Total Claimed</span>
          </div>
          <p className="font-heading font-heading-semibold text-xl text-warning">{formatNPR(totals.claimed)}</p>
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

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search by guest, voucher code, or branch..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-spa text-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <span className="font-caption font-caption-normal text-xs text-text-tertiary">
          {filtered.length} wallet{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Wallet table */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="Wallet" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body font-body-medium text-sm text-text-secondary">
              {wallets.length === 0 ? 'No wallet vouchers issued yet' : 'No wallets match your search'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="w-8 px-2 py-2.5" />
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Guest</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Voucher Code</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Issued Branch</th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Issued By</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Issued</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Claimed</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Remaining</th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => {
                  const cfg = STATUS_CONFIG[w.status] || STATUS_CONFIG.unused;
                  const isOpen = expanded.has(w.id);
                  const hasClaims = w.claims.length > 0;
                  return (
                    <React.Fragment key={w.id}>
                      <tr
                        onClick={() => hasClaims && toggleExpand(w.id)}
                        className={`border-b border-border last:border-0 spa-transition-fast ${
                          hasClaims ? 'cursor-pointer hover:bg-background/50' : ''
                        }`}
                      >
                        <td className="px-2 py-3 text-text-tertiary">
                          {hasClaims && <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={16} />}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-body font-body-medium text-sm text-text-primary">{w.guestName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-data font-data-normal text-xs text-text-secondary tracking-wide">{w.voucherCode}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-body font-body-normal text-sm text-text-secondary">{w.issuedBranchName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-body font-body-normal text-sm text-text-secondary">{w.issuedByName}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-data font-data-normal text-sm text-text-secondary">{formatNPR(w.totalAmountIssued)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-data font-data-medium text-sm text-warning">{formatNPR(w.totalClaimed)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-data font-data-medium text-sm text-primary">{formatNPR(w.remainingBalance)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${cfg.pill}`}>
                            <Icon name={cfg.icon} size={11} />
                            <span>{cfg.label}</span>
                          </span>
                        </td>
                      </tr>

                      {isOpen && w.claims.map((c) => (
                        <tr key={c.id} className="border-b border-border last:border-0 bg-background/30">
                          <td />
                          <td colSpan={8} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3 flex-wrap pl-4">
                              <div className="flex items-center gap-2 min-w-0">
                                <Icon name="Sparkles" size={13} className="text-text-tertiary flex-shrink-0" />
                                <span className="font-body font-body-medium text-sm text-text-primary">
                                  {c.serviceClaimed || 'Service not recorded'}
                                </span>
                                <span className="font-caption text-xs text-text-tertiary">
                                  {formatDate(c.redeemedDate)} · claimed at {c.branchName}
                                  {c.guestNameUsedBy ? ` · ${c.guestNameUsedBy}` : ''}
                                </span>
                              </div>
                              <span className="font-data text-sm text-warning flex-shrink-0">-{formatNPR(c.amountClaimed)}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-background border-t-2 border-border">
                  <td colSpan={5} className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-primary">{formatNPR(totals.issued)}</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-warning">{formatNPR(totals.claimed)}</td>
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

export default VoucherWalletPanel;
