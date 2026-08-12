import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import FilterBar from '../../../components/ui/FilterBar';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../utils/periodPresets';
import { getServiceRevenueByBranch } from '../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const EMPTY_DATA = { branches: [], services: [], branchTotals: {}, grandTotalRevenue: 0, grandTotalCount: 0 };

const ServiceRevenueReportPanel = ({ branchId }) => {
  const today = getTodayISO();
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [mode, setMode] = useState('all'); // 'all' | 'preset' | 'custom'
  const [activePreset, setActivePreset] = useState('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const [sortKey, setSortKey] = useState('total'); // 'name' | 'total'
  const [sortDir, setSortDir] = useState('desc');

  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpand = (key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

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
    const { data: result, error: err } = await getServiceRevenueByBranch({ branchId, from: range.from, to: range.to });
    if (err) {
      setError(err.message || 'Failed to load service revenue.');
    } else {
      setData(result || EMPTY_DATA);
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

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data.services;
    return data.services.filter(s => s.serviceName.toLowerCase().includes(q));
  }, [data.services, searchQuery]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'name') return dir * a.serviceName.localeCompare(b.serviceName);
      return dir * (a.totalRevenue - b.totalRevenue);
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const sortIcon = (key) => (
    <Icon
      name={sortKey === key ? (sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown') : 'ChevronsUpDown'}
      size={14}
      className={sortKey === key ? 'text-primary' : 'text-text-tertiary'}
    />
  );

  const handleExportCSV = () => {
    if (!filtered.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Service', 'Branch', 'Revenue', 'Bookings'];
    let csv = header.join(',') + '\n';
    sorted.forEach((s) => {
      data.branches.forEach((b) => {
        const cell = s.byBranch[b.id];
        if (!cell) return;
        csv += [esc(s.serviceName), esc(b.name), esc(cell.revenue), esc(cell.count)].join(',') + '\n';
      });
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'service-revenue-report.csv';
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Service Revenue</h3>
          <p className="font-body text-sm text-text-secondary">
            {loading
              ? 'Loading…'
              : `${formatNPR(data.grandTotalRevenue)} across ${data.grandTotalCount} paid booking${data.grandTotalCount !== 1 ? 's' : ''}`}
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
        count={{ value: data.grandTotalCount, label: data.grandTotalCount === 1 ? 'Booking' : 'Bookings' }}
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search by service…' }}
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
            <p className="font-body text-sm text-text-secondary">Loading service revenue...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="PieChart" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">
              {data.services.length === 0
                ? 'No paid bookings in this period.'
                : 'No services match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-3">
                    <button type="button" onClick={() => handleSort('name')} className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary whitespace-nowrap">
                      <span>Service</span>{sortIcon('name')}
                    </button>
                  </th>
                  <th className="text-right px-4 py-3">
                    <button type="button" onClick={() => handleSort('total')} className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary whitespace-nowrap ml-auto">
                      <span>Total</span>{sortIcon('total')}
                    </button>
                  </th>
                  <th className="text-right px-4 py-3">
                    <span className="font-body font-body-medium text-sm text-text-secondary whitespace-nowrap"># Bookings</span>
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => {
                  const key = s.serviceName;
                  const isOpen = expanded.has(key);
                  const branchRows = data.branches.filter(b => s.byBranch[b.id]);
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast cursor-pointer"
                        onClick={() => toggleExpand(key)}
                      >
                        <td className="px-4 py-3">
                          <span className="font-body font-body-medium text-sm text-text-primary">{s.serviceName}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-data font-data-medium text-sm text-success font-semibold whitespace-nowrap">
                          {formatNPR(s.totalRevenue)}
                        </td>
                        <td className="px-4 py-3 text-right font-data text-sm text-text-secondary whitespace-nowrap">
                          {s.totalCount}
                        </td>
                        <td className="px-2 py-3 text-text-tertiary">
                          <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={16} />
                        </td>
                      </tr>

                      {isOpen && branchRows.map((b) => (
                        <tr key={b.id} className="border-b border-border last:border-b-0 bg-background/30">
                          <td colSpan={4} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3 flex-wrap pl-4">
                              <span className="inline-flex items-center gap-1.5 font-body text-sm text-text-primary">
                                <Icon name="Building2" size={14} className="text-primary" />
                                {b.name}
                              </span>
                              <div className="flex items-center gap-4 flex-shrink-0">
                                <span className="font-body text-xs text-text-secondary">
                                  {s.byBranch[b.id].count} booking{s.byBranch[b.id].count !== 1 ? 's' : ''}
                                </span>
                                <span className="font-data text-sm text-success font-semibold w-24 text-right">
                                  {formatNPR(s.byBranch[b.id].revenue)}
                                </span>
                              </div>
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
                  <td className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-success whitespace-nowrap">
                    {formatNPR(data.grandTotalRevenue)}
                  </td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-text-secondary whitespace-nowrap">
                    {data.grandTotalCount}
                  </td>
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

export default ServiceRevenueReportPanel;
