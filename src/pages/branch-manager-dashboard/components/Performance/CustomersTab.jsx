import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import { getTherapistCustomerHistory } from '../../../../services/api';

const STATUS_COLORS = {
  Completed: 'bg-success/10 text-success',
  Cancelled: 'bg-error/10 text-error',
  'No Show': 'bg-gray-100 text-gray-600',
};

function formatDateTime(dateStr, timeStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  const datePart = new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return timeStr ? `${datePart}, ${timeStr.slice(0, 5)}` : datePart;
}

const CustomersTab = ({ therapistId, branchId, range }) => {
  const [showAll, setShowAll] = useState(false); // include Cancelled/No Show
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    if (!branchId || !therapistId) return;
    setLoading(true);
    setError(null);

    const result = await getTherapistCustomerHistory({ branchId, therapistId, ...range, includeMissedCancelled: showAll });

    if (result.error) {
      setError(result.error.message || 'Failed to load customer history.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [branchId, therapistId, range, showAll]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-6 space-y-3 animate-pulse">
        {[0, 1, 2].map(i => <div key={i} className="h-10 bg-background rounded" />)}
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

  const customers = data?.customers || [];

  // Distinct people, not visit count — a repeat customer's 2nd/3rd completed booking should not
  // inflate this number (mirrors computeTherapistMetrics' customersAttended dedup on the main
  // table / Overview tab, so this banner never disagrees with those).
  const uniqueAttendedCount = useMemo(() => {
    const key = (c) => {
      const normalizedPhone = (c.customerPhone || '').replace(/\D/g, '');
      return normalizedPhone ? `phone:${normalizedPhone}` : (c.customerId || `name:${(c.customerName || '').trim().toLowerCase()}`);
    };
    return new Set(customers.filter(c => c.status === 'Completed').map(key)).size;
  }, [customers]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-body font-body-medium text-sm text-text-primary">
          {uniqueAttendedCount} customer{uniqueAttendedCount === 1 ? '' : 's'} attended
        </p>
        <label className="inline-flex items-center gap-1.5 font-caption text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="rounded border-border" />
          Show cancelled / no-show
        </label>
      </div>

      <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
        {customers.length === 0 ? (
          <div className="p-12 text-center">
            <Icon name="Users" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No customers attended for this period.</p>
          </div>
        ) : (
          <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-background/50 border-b border-border">
                  <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Customer</th>
                  <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Service</th>
                  <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Date / Time</th>
                  <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Duration</th>
                  <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Type</th>
                  {showAll && <th className="px-4 py-3 text-center font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Status</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((c) => (
                  <tr key={c.bookingId} className="hover:bg-background/30 spa-transition-fast">
                    <td className="px-4 py-3 min-w-0">
                      <span className="font-body font-body-medium text-sm text-text-primary truncate block max-w-[180px]">{c.customerName || '—'}</span>
                      {c.customerPhone && <span className="font-caption text-[11px] text-text-tertiary">{c.customerPhone}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body text-sm text-text-secondary truncate block max-w-[160px]">{c.serviceName || '—'}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-data font-data-normal text-sm text-text-secondary">{formatDateTime(c.date, c.startTime)}</span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className="font-data font-data-normal text-sm text-text-secondary">{c.durationMinutes ? `${c.durationMinutes} min` : '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {c.customerType && (
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-caption font-caption-medium ${
                          c.customerType === 'New' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
                        }`}>
                          {c.customerType}
                        </span>
                      )}
                    </td>
                    {showAll && (
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-caption font-caption-medium ${STATUS_COLORS[c.status] || 'bg-background text-text-secondary'}`}>
                          {c.status}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card stack */}
          <div className="md:hidden divide-y divide-border">
            {customers.map((c) => (
              <div key={c.bookingId} className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-body font-body-medium text-sm text-text-primary truncate min-w-0">{c.customerName || '—'}</span>
                  {c.customerType && (
                    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-caption font-caption-medium flex-shrink-0 ${
                      c.customerType === 'New' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
                    }`}>
                      {c.customerType}
                    </span>
                  )}
                </div>
                <p className="font-body text-xs text-text-secondary truncate">{c.serviceName || '—'}</p>
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                  <span>{formatDateTime(c.date, c.startTime)}</span>
                  {c.durationMinutes && <><span>·</span><span>{c.durationMinutes} min</span></>}
                  {showAll && <><span>·</span><span className={`px-1.5 py-0.5 rounded ${STATUS_COLORS[c.status] || ''}`}>{c.status}</span></>}
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CustomersTab;
