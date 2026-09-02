import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import FilterBar from '../../../components/ui/FilterBar';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO, toISO } from '../../../utils/periodPresets';
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
  const today = getTodayISO();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activePreset, setActivePreset] = useState('monthly');
  const [mode, setMode] = useState('preset'); // 'preset' | 'custom'
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const range = useMemo(() => {
    if (mode === 'custom' && appliedFrom) {
      return { startDate: appliedFrom, endDate: appliedTo || today };
    }
    return getPeriodRange(activePreset);
  }, [mode, activePreset, appliedFrom, appliedTo, today]);

  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const handlePreset = (id) => {
    setMode('preset');
    setActivePreset(id);
  };

  const handleCustomApply = () => {
    if (!customFrom) return;
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setMode('custom');
  };

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
    return transfers.filter(t => {
      const matchesSearch = !q
        || t.therapistName.toLowerCase().includes(q)
        || t.fromBranch.toLowerCase().includes(q)
        || t.toBranch.toLowerCase().includes(q)
        || t.transferredBy.toLowerCase().includes(q);
      const ds = t.transferredAt ? toISO(new Date(t.transferredAt)) : '';
      const matchesDate = !ds || (ds >= range.startDate && ds <= range.endDate);
      return matchesSearch && matchesDate;
    });
  }, [transfers, searchQuery, range]);

  const handleExportCSV = () => {
    if (!filtered.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Recorded', 'Staff', 'From', 'To', 'Effective Date', 'Status', 'Reverts At', 'Transferred By', 'Remarks'];
    let csv = header.join(',') + '\n';
    filtered.forEach((t) => {
      csv += [
        esc(formatDateTime(t.transferredAt)),
        esc(t.therapistName),
        esc(t.fromBranch),
        esc(t.toBranch),
        esc(formatDateOnly(t.effectiveDate)),
        esc(t.applied ? 'Applied' : 'Scheduled'),
        esc(t.revertAt ? (t.reverted ? `Reverted ${formatDateTime(t.revertedAt)}` : formatDateTime(t.revertAt)) : '—'),
        esc(t.transferredBy),
        esc(t.note || ''),
      ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'transfer-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

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

      {/* Filters */}
      <FilterBar
        count={{ value: filtered.length, label: filtered.length === 1 ? 'Transfer' : 'Transfers' }}
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search by staff, branch, or person…' }}
        presets={PERIOD_PRESETS.map((p) => ({
          label: p.label,
          active: mode === 'preset' && activePreset === p.id,
          onClick: () => handlePreset(p.id),
        }))}
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
            <p className="font-body text-sm text-text-secondary">Loading transfer history...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="ArrowRightLeft" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">
              {transfers.length === 0 ? 'No transfers recorded yet.' : 'No transfers match the current filters.'}
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
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Reverts At</th>
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
                    <td className="px-4 py-3 whitespace-nowrap">
                      {t.revertAt ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-caption font-caption-medium ${
                          t.reverted ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'
                        }`} title={t.reverted ? `Reverted ${formatDateTime(t.revertedAt)}` : `Reverts ${formatDateTime(t.revertAt)}`}>
                          <Icon name={t.reverted ? 'CheckCircle' : 'Clock'} size={12} />
                          {t.reverted ? 'Reverted' : formatDateTime(t.revertAt)}
                        </span>
                      ) : (
                        <span className="font-body text-sm text-text-tertiary">—</span>
                      )}
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
