import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import { getOutstandingByStaff, fetchDueHolderNames, setDueHolder } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDateOnly(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

const UNASSIGNED_LABEL = 'Unassigned';

const OutstandingReportPanel = ({ branchId }) => {
  const today = getTodayISO();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  // 'all' shows every outstanding balance regardless of date (the useful default
  // for cumulative credit); presets/custom narrow by booking date.
  const [mode, setMode] = useState('all'); // 'all' | 'preset' | 'custom'
  const [activePreset, setActivePreset] = useState('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const [expanded, setExpanded] = useState(() => new Set());
  // bookingId currently being assigned a name → { value }
  const [assigning, setAssigning] = useState(null);
  const [assignName, setAssignName] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [showAssignSuggestions, setShowAssignSuggestions] = useState(false);

  const filteredAssignSuggestions = useMemo(() => {
    const q = assignName.trim().toLowerCase();
    return suggestions
      .filter((n) => n && n.toLowerCase().includes(q) && n.toLowerCase() !== q)
      .slice(0, 6);
  }, [assignName, suggestions]);

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
    const { data, error: err } = await getOutstandingByStaff({ branchId, from: range.from, to: range.to });
    if (err) {
      setError(err.message || 'Failed to load outstanding balances.');
    } else {
      setGroups(data || []);
    }
    setLoading(false);
  }, [branchId, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let active = true;
    fetchDueHolderNames(branchId).then(({ data }) => {
      if (active && Array.isArray(data)) setSuggestions(data);
    });
    return () => { active = false; };
  }, [branchId]);

  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const handleCustomApply = () => {
    if (!customFrom) return;
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setMode('custom');
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(g => {
        const label = g.dueHolderName || UNASSIGNED_LABEL;
        const nameMatch = label.toLowerCase().includes(q);
        if (nameMatch) return g;
        const bookings = g.bookings.filter(b =>
          (b.customerName || '').toLowerCase().includes(q) ||
          (b.bookingNumber || '').toLowerCase().includes(q) ||
          (b.serviceName || '').toLowerCase().includes(q)
        );
        if (bookings.length === 0) return null;
        const totalDue = Math.round(bookings.reduce((s, b) => s + Number(b.amountDue || 0), 0) * 100) / 100;
        return { ...g, bookings, bookingCount: bookings.length, totalDue };
      })
      .filter(Boolean);
  }, [groups, searchQuery]);

  const totalOutstanding = useMemo(
    () => filtered.reduce((s, g) => s + Number(g.totalDue || 0), 0),
    [filtered]
  );
  const totalBookings = useMemo(
    () => filtered.reduce((s, g) => s + g.bookingCount, 0),
    [filtered]
  );

  const toggleExpand = (key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const startAssign = (bookingId, current) => {
    setAssigning(bookingId);
    setAssignName(current || '');
    setShowAssignSuggestions(false);
  };

  const saveAssign = async (bookingId) => {
    const name = assignName.trim();
    if (!name) return;
    setAssignSaving(true);
    const { error: err } = await setDueHolder({ bookingId, dueHolderName: name });
    setAssignSaving(false);
    if (err) {
      setError(err.message || 'Failed to assign name.');
      return;
    }
    setAssigning(null);
    setAssignName('');
    await load();
    fetchDueHolderNames(branchId).then(({ data }) => {
      if (Array.isArray(data)) setSuggestions(data);
    });
  };

  const handleExportCSV = () => {
    if (!filtered.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Responsible Person', 'Customer', 'Booking #', 'Date', 'Service', 'Final', 'Paid', 'Outstanding', 'Status'];
    let csv = header.join(',') + '\n';
    filtered.forEach((g) => {
      const label = g.dueHolderName || UNASSIGNED_LABEL;
      g.bookings.forEach((b) => {
        csv += [
          esc(label),
          esc(b.customerName),
          esc(b.bookingNumber),
          esc(formatDateOnly(b.date)),
          esc(b.serviceName),
          esc(b.finalAmount),
          esc(b.amountPaid),
          esc(b.amountDue),
          esc(b.paymentStatus),
        ].join(',') + '\n';
      });
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'outstanding-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const presetItems = [
    { label: 'All Time', active: mode === 'all', onClick: () => setMode('all') },
    ...PERIOD_PRESETS.map((p) => ({
      label: p.label,
      active: mode === 'preset' && activePreset === p.id,
      onClick: () => { setMode('preset'); setActivePreset(p.id); },
    })),
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Outstanding Report</h3>
          <p className="font-body text-sm text-text-secondary">
            {loading
              ? 'Loading…'
              : `${formatNPR(totalOutstanding)} across ${totalBookings} booking${totalBookings !== 1 ? 's' : ''}`}
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
        count={{ value: totalBookings, label: totalBookings === 1 ? 'Booking' : 'Bookings' }}
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
            <p className="font-body text-sm text-text-secondary">Loading outstanding balances...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="CheckCircle" size={32} className="text-success mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">
              {groups.length === 0 ? 'No outstanding balances. Everything is settled.' : 'No balances match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Responsible Person</th>
                  <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Outstanding</th>
                  <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary"># Bookings</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => {
                  const key = g.dueHolderName || '__unassigned__';
                  const isUnassigned = !g.dueHolderName;
                  const isOpen = expanded.has(key);
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast cursor-pointer"
                        onClick={() => toggleExpand(key)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isUnassigned ? (
                              <span className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-warning">
                                <Icon name="HelpCircle" size={15} />
                                {UNASSIGNED_LABEL}
                              </span>
                            ) : (
                              <span className="font-body font-body-medium text-sm text-text-primary">{g.dueHolderName}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-data font-data-medium text-sm text-warning font-semibold whitespace-nowrap">
                          {formatNPR(g.totalDue)}
                        </td>
                        <td className="px-4 py-3 text-right font-data text-sm text-text-secondary whitespace-nowrap">
                          {g.bookingCount}
                        </td>
                        <td className="px-2 py-3 text-text-tertiary">
                          <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={16} />
                        </td>
                      </tr>

                      {isOpen && g.bookings.map((b) => (
                        <tr key={b.bookingId} className="border-b border-border last:border-b-0 bg-background/30">
                          <td colSpan={4} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3 flex-wrap pl-4">
                              <div className="min-w-0">
                                <span className="font-body font-body-medium text-sm text-text-primary">{b.customerName}</span>
                                <span className="font-body text-xs text-text-secondary ml-2">
                                  #{b.bookingNumber} · {b.serviceName} · {formatDateOnly(b.date)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <span className="font-data text-xs text-text-secondary">
                                  Paid {formatNPR(b.amountPaid)}
                                </span>
                                <span className="font-data text-sm text-warning font-semibold">
                                  Due {formatNPR(b.amountDue)}
                                </span>
                                {isUnassigned && (
                                  assigning === b.bookingId ? (
                                    <div className="flex items-center gap-1.5">
                                      <div className="relative w-36">
                                        <input
                                          type="text"
                                          autoFocus
                                          value={assignName}
                                          onChange={(e) => { setAssignName(e.target.value); setShowAssignSuggestions(true); }}
                                          onFocus={() => setShowAssignSuggestions(true)}
                                          onBlur={() => setTimeout(() => setShowAssignSuggestions(false), 150)}
                                          onKeyDown={(e) => { if (e.key === 'Enter') saveAssign(b.bookingId); }}
                                          placeholder="Name…"
                                          className="w-full rounded-spa border border-border bg-surface px-2 py-1 font-body text-xs text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                                        />
                                        {showAssignSuggestions && filteredAssignSuggestions.length > 0 && (
                                          <div className="absolute z-dropdown left-0 right-0 mt-1 bg-surface border border-border rounded-spa shadow-spa-elevated max-h-44 overflow-y-auto">
                                            {filteredAssignSuggestions.map((name) => (
                                              <button
                                                key={name}
                                                type="button"
                                                onMouseDown={() => { setAssignName(name); setShowAssignSuggestions(false); }}
                                                className="w-full text-left px-2 py-1.5 text-xs text-text-primary hover:bg-background spa-transition-fast"
                                              >
                                                {name}
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        onClick={() => saveAssign(b.bookingId)}
                                        disabled={assignSaving || !assignName.trim()}
                                        className="px-2 py-1 rounded-spa bg-primary text-white text-xs font-body-medium disabled:opacity-50"
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick={() => { setAssigning(null); setAssignName(''); setShowAssignSuggestions(false); }}
                                        className="p-1 rounded-spa hover:bg-background text-text-secondary"
                                      >
                                        <Icon name="X" size={14} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => startAssign(b.bookingId, '')}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-spa border border-border bg-surface text-xs font-body-medium text-primary hover:bg-background spa-transition-fast"
                                    >
                                      <Icon name="UserPlus" size={13} />
                                      Assign name
                                    </button>
                                  )
                                )}
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
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-warning whitespace-nowrap">
                    {formatNPR(totalOutstanding)}
                  </td>
                  <td className="px-4 py-3 text-right font-data text-sm text-text-secondary">{totalBookings}</td>
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

export default OutstandingReportPanel;
