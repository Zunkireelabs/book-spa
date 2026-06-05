import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import FilterBar from '../../../components/ui/FilterBar';
import { fetchAllDiscounts } from '../../../services/api';

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
];

const STATUS_BADGE = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-success/10 text-success',
};

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const DiscountsPanel = ({ branchId }) => {
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    const result = await fetchAllDiscounts(branchId);
    if (result.error) {
      setError(result.error.message || 'Failed to load discounts.');
    } else {
      setDiscounts(result.data || []);
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== 'all';

  const filtered = useMemo(() => {
    return discounts.filter((d) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q
        || (d.customerName || '').toLowerCase().includes(q)
        || (d.bookingNumber || '').toLowerCase().includes(q)
        || (d.requestedByName || '').toLowerCase().includes(q)
        || (d.approvedByName || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || d.discountStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [discounts, searchQuery, statusFilter]);

  const totalDiscount = useMemo(
    () => filtered.reduce((sum, d) => sum + (d.discountAmount || 0), 0),
    [filtered]
  );

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-6 animate-pulse">
        <div className="h-4 bg-background rounded w-48 mb-4" />
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-12 bg-background rounded" />)}
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-heading font-heading-semibold text-xl text-text-primary">Discounts</h2>
          <p className="font-body text-sm text-text-secondary">
            All discounts given, with who requested and who approved them.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="font-heading font-heading-semibold text-lg text-text-primary">
              NPR {totalDiscount.toLocaleString('en-IN')}
            </p>
            <p className="font-caption text-[11px] text-text-tertiary">Total discount ({filtered.length})</p>
          </div>
          <button onClick={loadData} className="p-2 rounded-lg hover:bg-gray-100 transition-colors" title="Refresh">
            <Icon name="RefreshCw" size={16} className="text-text-tertiary" />
          </button>
        </div>
      </div>

      <FilterBar
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search client, booking, or staff…' }}
        filters={[{ value: statusFilter, onChange: setStatusFilter, options: STATUS_FILTER_OPTIONS }]}
        resultCount={hasActiveFilters ? { filtered: filtered.length, total: discounts.length } : undefined}
        hasActiveFilters={hasActiveFilters}
        onClear={() => { setSearchQuery(''); setStatusFilter('all'); }}
      />

      {/* Table */}
      <div className="bg-surface rounded-spa-lg border border-border">
        <div className="hidden lg:grid lg:grid-cols-[1.4fr_1.2fr_120px_1fr_1fr_110px] gap-3 px-5 py-3 bg-background/50 border-b border-border rounded-t-spa-lg">
          {['Client / Booking', 'Package', 'Discount', 'Requested by', 'Approved by', 'Status'].map((h, i) => (
            <span key={h} className={`font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide ${i === 5 ? 'text-center' : ''}`}>{h}</span>
          ))}
        </div>

        {discounts.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="Percent" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No discounts yet for this branch.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="SearchX" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No discounts match the current filters.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(d => (
              <div
                key={d.bookingId}
                className="grid grid-cols-1 lg:grid-cols-[1.4fr_1.2fr_120px_1fr_1fr_110px] gap-2 lg:gap-3 px-5 py-3 lg:items-center"
              >
                {/* Client / booking */}
                <div className="min-w-0">
                  <p className="font-body font-body-medium text-sm text-text-primary truncate">{d.customerName}</p>
                  <p className="font-caption text-xs text-text-tertiary">{d.bookingNumber} · {formatDate(d.date)}</p>
                </div>

                {/* Package */}
                <div className="min-w-0">
                  <p className="font-body text-sm text-text-secondary truncate">{d.serviceName}</p>
                </div>

                {/* Discount */}
                <div>
                  <span className="font-data text-sm text-error">
                    {d.discountPercent}% · NPR {d.discountAmount.toLocaleString('en-IN')}
                  </span>
                  {d.discountReason && (
                    <p className="font-caption text-[11px] text-text-tertiary italic truncate mt-0.5" title={d.discountReason}>
                      &ldquo;{d.discountReason}&rdquo;
                    </p>
                  )}
                </div>

                {/* Requested by */}
                <div className="min-w-0">
                  <span className="lg:hidden font-caption text-[11px] text-text-tertiary uppercase mr-1">Requested:</span>
                  <span className="font-body text-sm text-text-secondary">{d.requestedByName || '—'}</span>
                </div>

                {/* Approved by */}
                <div className="min-w-0">
                  <span className="lg:hidden font-caption text-[11px] text-text-tertiary uppercase mr-1">Approved:</span>
                  <span className="font-body text-sm text-text-secondary">
                    {d.discountStatus === 'approved'
                      ? (d.approvedByName || '—')
                      : (d.requestedToName ? `Awaiting ${d.requestedToName}` : '—')}
                  </span>
                </div>

                {/* Status */}
                <div className="lg:text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-caption font-caption-medium capitalize ${STATUS_BADGE[d.discountStatus] || 'bg-gray-100 text-gray-500'}`}>
                    {d.discountStatus}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DiscountsPanel;
