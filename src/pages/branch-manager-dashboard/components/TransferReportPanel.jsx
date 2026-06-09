import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { useIndustry } from '../../../hooks/useIndustry';
import { fetchStaffTransfers } from '../../../services/api';

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDateOnly(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

const TransferReportPanel = () => {
  const { staffLabel } = useIndustry();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await fetchStaffTransfers();
      if (!active) return;
      if (err) {
        setError(err.message || 'Failed to load transfer history.');
      } else {
        setTransfers(data || []);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return transfers;
    return transfers.filter(t =>
      t.therapistName.toLowerCase().includes(q) ||
      t.fromBranch.toLowerCase().includes(q) ||
      t.toBranch.toLowerCase().includes(q) ||
      t.transferredBy.toLowerCase().includes(q)
    );
  }, [transfers, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">{staffLabel} Transfer Report</h3>
          <p className="font-body text-sm text-text-secondary">
            {loading ? 'Loading…' : `${filtered.length} transfer${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          placeholder="Search by staff, branch, or person..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-spa text-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

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
            <p className="font-body text-sm text-text-secondary">Loading transfer history...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="ArrowRightLeft" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">
              {transfers.length === 0 ? 'No transfers recorded yet.' : 'No transfers match your search.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Recorded</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">{staffLabel}</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">From → To</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Effective Date</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Transferred By</th>
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                    <td className="px-4 py-3 font-body text-sm text-text-secondary whitespace-nowrap">{formatDateTime(t.transferredAt)}</td>
                    <td className="px-4 py-3 font-body font-body-medium text-sm text-text-primary">{t.therapistName}</td>
                    <td className="px-4 py-3 font-body text-sm text-text-secondary whitespace-nowrap">
                      {t.fromBranch} <span className="text-text-tertiary">→</span> {t.toBranch}
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-text-secondary whitespace-nowrap">{formatDateOnly(t.effectiveDate)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-caption font-caption-medium ${
                        t.applied ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'
                      }`}>
                        <Icon name={t.applied ? 'CheckCircle' : 'Clock'} size={12} />
                        {t.applied ? 'Applied' : 'Scheduled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-text-secondary">{t.transferredBy}</td>
                    <td className="px-4 py-3 font-body text-sm text-text-secondary">{t.note || '—'}</td>
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

export default TransferReportPanel;
