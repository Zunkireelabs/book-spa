import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import CustomSelect from '../../../../components/ui/CustomSelect';
import PaymentModal from '../../../../components/ui/PaymentModal';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import { getOutstandingByStaff, fetchDueHolderNames, setDueHolder, recordPayment, getCustomerOutstandingBalance } from '../../../../services/api';
import SettledDueHistoryPanel from './SettledDueHistoryPanel';

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
  const [view, setView] = useState('outstanding'); // 'outstanding' | 'settled'
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

  const [personFilter, setPersonFilter] = useState('');
  const [sortKey, setSortKey] = useState('due'); // 'customer' | 'responsible' | 'due'
  const [sortDir, setSortDir] = useState('desc');
  // bookingId currently being assigned a name → { value }
  const [assigning, setAssigning] = useState(null);
  const [assignName, setAssignName] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [showAssignSuggestions, setShowAssignSuggestions] = useState(false);
  // row currently being paid (full row object, or null when closed)
  const [payingRow, setPayingRow] = useState(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  // this customer's other outstanding bookings, auto-bundled into the same payment
  const [otherDueBookings, setOtherDueBookings] = useState([]);

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

  // Flatten the grouped API response into one row per outstanding booking,
  // each carrying its responsible person.
  const rows = useMemo(() => {
    const out = [];
    groups.forEach((g) => {
      const responsible = g.dueHolderName || UNASSIGNED_LABEL;
      const isUnassigned = !g.dueHolderName;
      g.bookings.forEach((b) => out.push({ ...b, responsible, isUnassigned }));
    });
    return out;
  }, [groups]);

  const personOptions = useMemo(() => {
    const names = new Set();
    let hasUnassigned = false;
    rows.forEach((r) => { r.isUnassigned ? (hasUnassigned = true) : names.add(r.responsible); });
    const opts = [
      { value: '', label: 'All responsible persons' },
      ...Array.from(names).sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n })),
    ];
    if (hasUnassigned) opts.push({ value: UNASSIGNED_LABEL, label: UNASSIGNED_LABEL });
    return opts;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = rows;
    if (personFilter) list = list.filter((r) => r.responsible === personFilter);
    if (q) {
      list = list.filter((r) =>
        (r.customerName || '').toLowerCase().includes(q) ||
        (r.customerPhone || '').toLowerCase().includes(q) ||
        (r.bookingNumber || '').toLowerCase().includes(q) ||
        (r.serviceName || '').toLowerCase().includes(q) ||
        r.responsible.toLowerCase().includes(q)
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === 'due') return (Number(a.amountDue || 0) - Number(b.amountDue || 0)) * dir;
      if (sortKey === 'responsible') return a.responsible.localeCompare(b.responsible) * dir;
      return (a.customerName || '').localeCompare(b.customerName || '') * dir;
    });
  }, [rows, searchQuery, personFilter, sortKey, sortDir]);

  const totalOutstanding = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.amountDue || 0), 0),
    [filtered]
  );
  const totalBookings = filtered.length;

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'due' ? 'desc' : 'asc');
    }
  };

  const sortIcon = (key) => {
    if (sortKey !== key) return 'ChevronsUpDown';
    return sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown';
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

  const openPay = async (row) => {
    setPayingRow(row);
    setOtherDueBookings([]);
    if (!row.customerPhone) return;
    const { data } = await getCustomerOutstandingBalance({
      customerPhone: row.customerPhone,
      branchId,
      excludeBookingId: row.bookingId,
    });
    setOtherDueBookings(data?.bookings || []);
  };

  const handleRecordPayment = async ({ tenders, additionalAllocations, dueHolderName, notes }) => {
    if (!payingRow) return { error: { message: 'No booking selected.' } };
    setPaymentSubmitting(true);
    // Pay the clicked row with its allocated tenders, then pay each bundled
    // other-outstanding booking with its own allocated tenders — PaymentModal
    // splits the entered amount across bookings and payment methods.
    const result = await recordPayment({ bookingId: payingRow.bookingId, tenders, dueHolderName, notes });
    if (result.error) {
      setPaymentSubmitting(false);
      return { error: result.error };
    }
    for (const alloc of (additionalAllocations || [])) {
      await recordPayment({ bookingId: alloc.bookingId, tenders: alloc.tenders, notes });
    }
    setPaymentSubmitting(false);
    setPayingRow(null);
    setOtherDueBookings([]);
    await load();
    fetchDueHolderNames(branchId).then(({ data }) => {
      if (Array.isArray(data)) setSuggestions(data);
    });
    return { error: null };
  };

  const handleExportCSV = () => {
    if (!filtered.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Customer', 'Phone', 'Responsible Person', 'Booking #', 'Date', 'Service', 'Final', 'Paid', 'Outstanding', 'Status'];
    let csv = header.join(',') + '\n';
    filtered.forEach((r) => {
      csv += [
        esc(r.customerName),
        esc(r.customerPhone),
        esc(r.responsible),
        esc(r.bookingNumber),
        esc(formatDateOnly(r.date)),
        esc(r.serviceName),
        esc(r.finalAmount),
        esc(r.amountPaid),
        esc(r.amountDue),
        esc(r.paymentStatus),
      ].join(',') + '\n';
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
      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-6">
          {[
            { id: 'outstanding', label: 'Outstanding' },
            { id: 'settled', label: 'Settled' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={`py-2.5 px-1 border-b-2 spa-transition-fast font-body font-body-medium text-sm ${
                view === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {view === 'settled' ? (
        <SettledDueHistoryPanel branchId={branchId} />
      ) : (
      <>
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
        hasActiveFilters={searchQuery.trim().length > 0 || personFilter !== ''}
        onClear={() => { setSearchQuery(''); setPersonFilter(''); }}
      />

      {/* Responsible person filter */}
      <div className="flex items-center gap-2">
        <span className="font-body text-sm text-text-secondary flex-shrink-0">Responsible person</span>
        <CustomSelect
          value={personFilter}
          onChange={setPersonFilter}
          options={personOptions}
          size="sm"
          searchable
          className="w-60"
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
          <div className={`overflow-x-auto ${filtered.length > 10 ? 'max-h-[640px] overflow-y-auto' : ''}`}>
            <table className="w-full">
              <thead className="sticky top-0 z-sticky-filter">
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-3">
                    <button
                      onClick={() => handleSort('customer')}
                      className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary spa-transition-fast"
                    >
                      Customer <Icon name={sortIcon('customer')} size={14} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3">
                    <button
                      onClick={() => handleSort('responsible')}
                      className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary spa-transition-fast"
                    >
                      Responsible Person <Icon name={sortIcon('responsible')} size={14} />
                    </button>
                  </th>
                  <th className="text-right px-4 py-3">
                    <button
                      onClick={() => handleSort('due')}
                      className="inline-flex items-center gap-1 ml-auto font-body font-body-medium text-sm text-text-secondary hover:text-text-primary spa-transition-fast"
                    >
                      Outstanding <Icon name={sortIcon('due')} size={14} />
                    </button>
                  </th>
                  <th className="text-right px-4 py-3">
                    <span className="font-body font-body-medium text-sm text-text-secondary">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.bookingId} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                    <td className="px-4 py-3">
                      <div className="font-body font-body-medium text-sm text-text-primary">{r.customerName}</div>
                      <div className="font-caption text-xs text-text-tertiary">{r.customerPhone || '—'}</div>
                      <div className="font-body text-xs text-text-secondary">
                        #{r.bookingNumber} · {r.serviceName} · {formatDateOnly(r.date)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.isUnassigned ? (
                        assigning === r.bookingId ? (
                          <div className="flex items-center gap-1.5">
                            <div className="relative w-40">
                              <input
                                type="text"
                                autoFocus
                                value={assignName}
                                onChange={(e) => { setAssignName(e.target.value); setShowAssignSuggestions(true); }}
                                onFocus={() => setShowAssignSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowAssignSuggestions(false), 150)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveAssign(r.bookingId); }}
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
                              onClick={() => saveAssign(r.bookingId)}
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
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 font-body font-body-medium text-sm text-warning">
                              <Icon name="HelpCircle" size={15} />
                              {UNASSIGNED_LABEL}
                            </span>
                            <button
                              onClick={() => startAssign(r.bookingId, '')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-spa border border-border bg-surface text-xs font-body-medium text-primary hover:bg-background spa-transition-fast"
                            >
                              <Icon name="UserPlus" size={13} />
                              Assign
                            </button>
                          </div>
                        )
                      ) : (
                        <span className="font-body font-body-medium text-sm text-text-primary">{r.responsible}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-data font-data-medium text-sm text-warning font-semibold whitespace-nowrap">
                      {formatNPR(r.amountDue)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openPay(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-spa bg-success text-white text-xs font-body-medium hover:bg-success/90 spa-transition-fast"
                      >
                        <Icon name="CreditCard" size={13} />
                        Pay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-background border-t-2 border-border">
                  <td className="px-4 py-3 font-body font-body-semibold text-sm text-text-primary">Total</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right font-data font-data-semibold text-sm text-warning whitespace-nowrap">
                    {formatNPR(totalOutstanding)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {payingRow && (
        <PaymentModal
          booking={{
            bookingId: payingRow.bookingId,
            booking_number: payingRow.bookingNumber,
            finalAmount: payingRow.finalAmount,
            amountPaid: payingRow.amountPaid,
            service: payingRow.serviceName,
            dueHolderName: payingRow.isUnassigned ? '' : payingRow.responsible,
          }}
          additionalBookings={otherDueBookings}
          dueHolderSuggestions={suggestions}
          onConfirm={handleRecordPayment}
          onClose={() => { setPayingRow(null); setOtherDueBookings([]); }}
          isSubmitting={paymentSubmitting}
        />
      )}
    </div>
  );
};

export default OutstandingReportPanel;
