import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchPackages } from '../../../../services/api';
import PackageDetailModal from './PackageDetailModal';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_CONFIG = {
  unused:          { label: 'Not Started',      pill: 'bg-gray-100 text-gray-600',    icon: 'Circle' },
  partially_used:  { label: 'In Progress',       pill: 'bg-warning/10 text-warning',  icon: 'CircleDashed' },
  fully_redeemed:  { label: 'Completed',         pill: 'bg-success/10 text-success',  icon: 'CheckCircle2' },
  expired:         { label: 'Expired',           pill: 'bg-error/10 text-error',      icon: 'AlertCircle' },
};

const SUMMARY_FILTERS = [
  { key: 'all',             label: 'Total',        icon: 'Layers',       color: 'text-text-primary', bg: 'bg-background' },
  { key: 'unused',          label: 'Not Started',  icon: 'Circle',       color: 'text-text-secondary', bg: 'bg-gray-50' },
  { key: 'partially_used',  label: 'In Progress',  icon: 'CircleDashed', color: 'text-warning',      bg: 'bg-warning/5' },
  { key: 'fully_redeemed',  label: 'Completed',    icon: 'CheckCircle2', color: 'text-success',      bg: 'bg-success/5' },
  { key: 'expired',         label: 'Expired',      icon: 'AlertCircle',  color: 'text-error',        bg: 'bg-error/5' },
];

// Alphabetical (by guest name) list of every issued package, each with a live
// Completed / In Progress / Not Started / Expired pill computed from
// package_redemptions (via the package_balances view) — the packages
// counterpart of VoucherListPanel, replacing the old "Annual Package
// Details" / "Membership Details" Excel workbooks.
const PackageListPanel = () => {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await fetchPackages();
    if (fetchError) {
      setError(fetchError.message || 'Failed to load packages.');
      setLoading(false);
      return;
    }
    setPackages(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const summary = useMemo(() => ({
    all: packages.length,
    unused: packages.filter((p) => p.status === 'unused').length,
    partially_used: packages.filter((p) => p.status === 'partially_used').length,
    fully_redeemed: packages.filter((p) => p.status === 'fully_redeemed').length,
    expired: packages.filter((p) => p.status === 'expired').length,
  }), [packages]);

  const filtered = useMemo(() => {
    let rows = packages;
    if (statusFilter !== 'all') rows = rows.filter((p) => p.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((p) =>
        p.guestName.toLowerCase().includes(q) ||
        (p.guestInfo || '').toLowerCase().includes(q) ||
        p.packageTypeName.toLowerCase().includes(q) ||
        p.serviceName.toLowerCase().includes(q) ||
        p.issuedByName.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => a.guestName.localeCompare(b.guestName));
  }, [packages, search, statusFilter]);

  // Matches whatever's currently visible (search + status filter) — the
  // Total row would otherwise silently disagree with the rows above it.
  const totals = useMemo(() => ({
    paid: filtered.reduce((sum, p) => sum + p.paidAmount, 0),
    sessionsTotal: filtered.reduce((sum, p) => sum + p.sessionsTotal, 0),
    sessionsUsed: filtered.reduce((sum, p) => sum + p.sessionsUsed, 0),
    sessionsRemaining: filtered.reduce((sum, p) => sum + p.sessionsRemaining, 0),
  }), [filtered]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
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
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Packages</h3>
        <p className="font-body text-sm text-text-secondary">
          {filtered.length} package{filtered.length !== 1 ? 's' : ''} issued · {totals.sessionsUsed}/{totals.sessionsTotal} sessions used · {formatNPR(totals.paid)} collected
        </p>
      </div>

      {/* Summary filter cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
            placeholder="Search by guest, guest info, package type, or service..."
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
          {filtered.length} package{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Package list */}
      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="Layers" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body font-body-medium text-sm text-text-secondary">
              {packages.length === 0 ? 'No packages issued yet' : 'No packages match your search'}
            </p>
            {packages.length === 0 && (
              <p className="font-caption text-xs text-text-tertiary mt-1">
                Issue one from "All Packages" to get started.
              </p>
            )}
          </div>
        ) : (
          <div className={`overflow-x-auto ${filtered.length > 10 ? 'max-h-[640px] overflow-y-auto' : ''}`}>
            <table className="w-full">
              <thead className="sticky top-0 z-sticky-filter">
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary">Guest Name</th>
                  <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary">Guest Info</th>
                  <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary">Package Type</th>
                  <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary">Service</th>
                  <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Branch</th>
                  <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Issued By</th>
                  <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Expiry</th>
                  <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Last Used</th>
                  <th className="text-right px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Paid</th>
                  <th className="text-right px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Sessions</th>
                  <th className="text-right px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.unused;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className="border-b border-border last:border-0 hover:bg-background/50 cursor-pointer spa-transition-fast"
                    >
                      <td className="px-2.5 py-1.5">
                        <span className="font-body font-body-medium text-xs text-text-primary">{p.guestName}</span>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span className="font-body font-body-normal text-xs text-text-secondary">{p.guestInfo || '—'}</span>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span className="font-body font-body-normal text-xs text-text-secondary">{p.packageTypeName}</span>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span className="font-body font-body-normal text-xs text-text-secondary">{p.serviceName}</span>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="font-body font-body-normal text-xs text-text-secondary">{p.branchName}</span>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="font-body font-body-normal text-xs text-text-secondary">{p.issuedByName}</span>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="font-caption text-[11px] text-text-tertiary">{formatDate(p.expiryDate)}</span>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="font-caption text-[11px] text-text-tertiary">{formatDate(p.lastRedeemedDate)}</span>
                      </td>
                      <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                        <span className="font-data font-data-normal text-xs text-text-secondary">{formatNPR(p.paidAmount)}</span>
                      </td>
                      <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                        <span className="font-data font-data-medium text-xs text-primary">{p.sessionsRemaining}/{p.sessionsTotal}</span>
                        {p.sessionsUsed > 0 && (
                          <p className="font-caption text-[9px] text-text-tertiary mt-0.5">
                            Used {p.sessionsUsed}{p.lastRedeemedDate ? ` · ${formatDate(p.lastRedeemedDate)}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                        <span className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[9px] font-caption font-caption-medium ${cfg.pill}`}>
                          <Icon name={cfg.icon} size={10} />
                          <span>{cfg.label}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-sticky-filter">
                <tr className="bg-background border-t-2 border-border">
                  <td colSpan={8} className="px-2.5 py-2 font-body font-body-semibold text-xs text-text-primary">Total</td>
                  <td className="px-2.5 py-2 text-right font-data font-data-semibold text-xs text-text-primary whitespace-nowrap">{formatNPR(totals.paid)}</td>
                  <td className="px-2.5 py-2 text-right font-data font-data-semibold text-xs text-primary whitespace-nowrap">{totals.sessionsRemaining}/{totals.sessionsTotal}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {selectedId && (
        <PackageDetailModal
          packageId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={loadData}
        />
      )}
    </div>
  );
};

export default PackageListPanel;
