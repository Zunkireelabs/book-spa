import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import { getReferralsReport, setReferralCommission } from '../../../../services/api';

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

function commissionLabel(type, value) {
  if (!type) return 'Not set';
  if (type === 'percentage') return `${Number(value)}%`;
  return formatNPR(value);
}

const TYPE_OPTIONS = [
  { value: 'percentage', label: '%' },
  { value: 'amount', label: 'NPR' },
];

const ReferralsReportPanel = ({ branchId }) => {
  const today = getTodayISO();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [mode, setMode] = useState('all'); // 'all' | 'preset' | 'custom'
  const [activePreset, setActivePreset] = useState('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const [expanded, setExpanded] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // bookingId being edited
  const [editType, setEditType] = useState('percentage');
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const [selectedGroups, setSelectedGroups] = useState(() => new Set());
  const [bulkType, setBulkType] = useState('percentage');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const [sortKey, setSortKey] = useState('commission'); // 'name' | 'commission' | 'bookings'
  const [sortDir, setSortDir] = useState('desc');

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
    const { data, error: err } = await getReferralsReport({ branchId, from: range.from, to: range.to });
    if (err) {
      setError(err.message || 'Failed to load referrals.');
    } else {
      setGroups(data || []);
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
    if (!q) return groups;
    return groups
      .map(g => {
        if (g.referredBy.toLowerCase().includes(q)) return g;
        const bookings = g.bookings.filter(b =>
          (b.customerName || '').toLowerCase().includes(q) ||
          (b.bookingNumber || '').toLowerCase().includes(q) ||
          (b.serviceName || '').toLowerCase().includes(q)
        );
        if (bookings.length === 0) return null;
        const totalCommission = Math.round(bookings.reduce((s, b) => s + Number(b.commission || 0), 0) * 100) / 100;
        return { ...g, bookings, bookingCount: bookings.length, totalCommission };
      })
      .filter(Boolean);
  }, [groups, searchQuery]);

  const totalCommission = useMemo(
    () => filtered.reduce((s, g) => s + Number(g.totalCommission || 0), 0),
    [filtered]
  );
  const totalBookings = useMemo(
    () => filtered.reduce((s, g) => s + g.bookingCount, 0),
    [filtered]
  );

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'name') return dir * a.referredBy.localeCompare(b.referredBy);
      if (sortKey === 'bookings') return dir * (a.bookingCount - b.bookingCount);
      return dir * (Number(a.totalCommission) - Number(b.totalCommission));
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

  const toggleExpand = (key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const selectedInView = useMemo(
    () => filtered.filter(g => selectedGroups.has(g.referredBy)).length,
    [filtered, selectedGroups]
  );
  const allSelected = filtered.length > 0 && selectedInView === filtered.length;

  const toggleSelect = (key) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedGroups(allSelected ? new Set() : new Set(filtered.map(g => g.referredBy)));
  };

  const applyBulk = async () => {
    const v = Number(bulkValue);
    if (!(v >= 0) || (bulkType === 'percentage' && v > 100)) {
      setError(bulkType === 'percentage' ? 'Percentage must be between 0 and 100.' : 'Amount must be zero or more.');
      return;
    }
    const ids = [];
    filtered.forEach(g => {
      if (selectedGroups.has(g.referredBy)) g.bookings.forEach(b => ids.push(b.bookingId));
    });
    if (ids.length === 0) return;
    setBulkSaving(true);
    setError(null);
    const results = await Promise.all(
      ids.map(id => setReferralCommission({ bookingId: id, commissionType: bulkType, commissionValue: v }))
    );
    setBulkSaving(false);
    const failed = results.filter(r => r.error).length;
    if (failed > 0) {
      setError(`Updated ${ids.length - failed} of ${ids.length} booking(s). ${failed} could not be changed (the day may be closed).`);
    }
    setSelectedGroups(new Set());
    setBulkValue('');
    await load();
  };

  const startEdit = (b) => {
    setEditing(b.bookingId);
    setEditType(b.commissionType || 'percentage');
    setEditValue(b.commissionValue != null ? String(b.commissionValue) : '');
  };

  const saveEdit = async (bookingId) => {
    const v = Number(editValue);
    if (!(v >= 0) || (editType === 'percentage' && v > 100)) {
      setError(editType === 'percentage' ? 'Percentage must be between 0 and 100.' : 'Amount must be zero or more.');
      return;
    }
    setSaving(true);
    const { error: err } = await setReferralCommission({ bookingId, commissionType: editType, commissionValue: v });
    setSaving(false);
    if (err) {
      setError(err.message || 'Failed to save commission.');
      return;
    }
    setEditing(null);
    await load();
  };

  const clearEdit = async (bookingId) => {
    setSaving(true);
    const { error: err } = await setReferralCommission({ bookingId, commissionType: null, commissionValue: null });
    setSaving(false);
    if (err) {
      setError(err.message || 'Failed to clear commission.');
      return;
    }
    setEditing(null);
    await load();
  };

  const handleExportCSV = () => {
    if (!filtered.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Referrer', 'Customer', 'Booking #', 'Date', 'Service', 'Final', 'Commission Rule', 'Commission Earned'];
    let csv = header.join(',') + '\n';
    sorted.forEach((g) => {
      g.bookings.forEach((b) => {
        csv += [
          esc(g.referredBy),
          esc(b.customerName),
          esc(b.bookingNumber),
          esc(formatDateOnly(b.date)),
          esc(b.serviceName),
          esc(b.finalAmount),
          esc(commissionLabel(b.commissionType, b.commissionValue)),
          esc(b.commission),
        ].join(',') + '\n';
      });
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'referrals-report.csv';
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
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Referrals Report</h3>
          <p className="font-body text-sm text-text-secondary">
            {loading
              ? 'Loading…'
              : `${formatNPR(totalCommission)} commission across ${totalBookings} paid booking${totalBookings !== 1 ? 's' : ''}`}
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
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search by referrer, customer, or booking…' }}
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

      {/* Bulk-apply bar */}
      {selectedInView > 0 && (
        <div className="flex items-center gap-3 flex-wrap p-3 bg-primary/5 border border-primary/20 rounded-spa">
          <span className="font-body font-body-medium text-sm text-text-primary whitespace-nowrap">
            {selectedInView} referrer{selectedInView !== 1 ? 's' : ''} selected
          </span>
          <span className="font-body text-xs text-text-secondary">Apply commission to all their paid bookings:</span>
          <div className="w-20">
            <CustomSelect options={TYPE_OPTIONS} value={bulkType} onChange={setBulkType} size="sm" />
          </div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyBulk(); }}
            placeholder={bulkType === 'percentage' ? '%' : 'NPR'}
            className="w-24 rounded-spa border border-border bg-surface px-2 py-1.5 font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
          <button
            onClick={applyBulk}
            disabled={bulkSaving || bulkValue === ''}
            className="px-3 py-1.5 rounded-spa bg-primary text-white text-sm font-body-medium disabled:opacity-50"
          >
            {bulkSaving ? 'Applying…' : 'Apply'}
          </button>
          <button
            onClick={() => setSelectedGroups(new Set())}
            className="px-3 py-1.5 rounded-spa border border-border text-sm font-body-medium text-text-secondary hover:bg-background"
          >
            Clear
          </button>
        </div>
      )}

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
            <p className="font-body text-sm text-text-secondary">Loading referrals...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="UserPlus" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">
              {groups.length === 0
                ? 'No paid bookings with a referrer in this period.'
                : 'No referrals match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = selectedInView > 0 && !allSelected; }}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 align-middle cursor-pointer accent-primary"
                    />
                  </th>
                  <th className="text-left px-4 py-3">
                    <button type="button" onClick={() => handleSort('name')} className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary">
                      <span>Referred By</span>{sortIcon('name')}
                    </button>
                  </th>
                  <th className="text-right px-4 py-3">
                    <button type="button" onClick={() => handleSort('commission')} className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary">
                      <span>Commission</span>{sortIcon('commission')}
                    </button>
                  </th>
                  <th className="text-right px-4 py-3">
                    <button type="button" onClick={() => handleSort('bookings')} className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary">
                      <span># Bookings</span>{sortIcon('bookings')}
                    </button>
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((g) => {
                  const key = g.referredBy;
                  const isOpen = expanded.has(key);
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast cursor-pointer"
                        onClick={() => toggleExpand(key)}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedGroups.has(key)}
                            onChange={() => toggleSelect(key)}
                            className="w-4 h-4 align-middle cursor-pointer accent-primary"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 font-body font-body-medium text-sm text-text-primary">
                            <Icon name="UserCheck" size={15} className="text-primary" />
                            {g.referredBy}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-data font-data-medium text-sm text-success font-semibold whitespace-nowrap">
                          {formatNPR(g.totalCommission)}
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
                          <td colSpan={5} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3 flex-wrap pl-4">
                              <div className="min-w-0">
                                <span className="font-body font-body-medium text-sm text-text-primary">{b.customerName}</span>
                                <span className="font-body text-xs text-text-secondary ml-2">
                                  #{b.bookingNumber} · {b.serviceName} · {formatDateOnly(b.date)} · {formatNPR(b.finalAmount)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                {editing === b.bookingId ? (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-20">
                                      <CustomSelect options={TYPE_OPTIONS} value={editType} onChange={setEditType} size="sm" />
                                    </div>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      autoFocus
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(b.bookingId); }}
                                      placeholder={editType === 'percentage' ? '%' : 'NPR'}
                                      className="w-24 rounded-spa border border-border bg-surface px-2 py-1 font-data text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                                    />
                                    <button
                                      onClick={() => saveEdit(b.bookingId)}
                                      disabled={saving || editValue === ''}
                                      className="px-2 py-1 rounded-spa bg-primary text-white text-xs font-body-medium disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                    {b.commissionType && (
                                      <button
                                        onClick={() => clearEdit(b.bookingId)}
                                        disabled={saving}
                                        className="px-2 py-1 rounded-spa border border-border text-xs font-body-medium text-error hover:bg-error/5"
                                      >
                                        Clear
                                      </button>
                                    )}
                                    <button
                                      onClick={() => setEditing(null)}
                                      className="p-1 rounded-spa hover:bg-background text-text-secondary"
                                    >
                                      <Icon name="X" size={14} />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="font-body text-xs text-text-secondary">
                                      Rule: <span className="text-text-primary font-body-medium">{commissionLabel(b.commissionType, b.commissionValue)}</span>
                                    </span>
                                    <span className="font-data text-sm text-success font-semibold w-24 text-right">
                                      {formatNPR(b.commission)}
                                    </span>
                                    <button
                                      onClick={() => startEdit(b)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-spa border border-border bg-surface text-xs font-body-medium text-primary hover:bg-background spa-transition-fast"
                                    >
                                      <Icon name="Pencil" size={13} />
                                      {b.commissionType ? 'Edit' : 'Set'}
                                    </button>
                                  </>
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
                  <td />
                  <td className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-success whitespace-nowrap">
                    {formatNPR(totalCommission)}
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

export default ReferralsReportPanel;
