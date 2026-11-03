import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import FilterBar from '../../../../components/ui/FilterBar';
import CustomSelect from '../../../../components/ui/CustomSelect';
import PaymentModal from '../../../../components/ui/PaymentModal';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO } from '../../../../utils/periodPresets';
import { getDueReportByBranch, recordPayment, recordTip, getCustomerOutstandingBalance } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatDateOnly(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STAGES = ['Pending', 'Confirmed', 'In-Progress', 'Completed'];

const STAGE_STYLE = {
  Pending: 'bg-background text-text-secondary',
  Confirmed: 'bg-warning/10 text-warning',
  'In-Progress': 'bg-primary/10 text-primary',
  Completed: 'bg-success/10 text-success',
};

const createdByLabel = (row) => {
  if (row.createdByName) return row.createdByName;
  if (row.isOnlineBooking) return 'Online booking';
  return 'Unrecorded';
};

const DueReportPanel = () => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const today = getTodayISO();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [mode, setMode] = useState('all');
  const [activePreset, setActivePreset] = useState('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const [branchFilter, setBranchFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [sortKey, setSortKey] = useState('due');
  const [sortDir, setSortDir] = useState('desc');

  const [payingRow, setPayingRow] = useState(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [otherDueBookings, setOtherDueBookings] = useState([]);

  const range = useMemo(() => {
    if (mode === 'all') return { from: undefined, to: undefined };
    if (mode === 'custom' && appliedFrom) return { from: appliedFrom, to: appliedTo || today };
    const r = getPeriodRange(activePreset);
    return { from: r.startDate, to: r.endDate };
  }, [mode, activePreset, appliedFrom, appliedTo, today]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await getDueReportByBranch({ from: range.from, to: range.to });
    if (err) {
      setError(err.message || 'Failed to load due report.');
    } else {
      setGroups(data || []);
    }
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);
  const handleCustomApply = () => {
    if (!customFrom) return;
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
    setMode('custom');
  };

  const rows = useMemo(() => {
    const out = [];
    groups.forEach((g) => g.bookings.forEach((b) => out.push({ ...b, branchId: g.branchId, branchName: g.branchName })));
    return out;
  }, [groups]);

  const branchOptions = useMemo(() => [
    { value: '', label: 'All branches' },
    ...groups.map((g) => ({ value: g.branchId, label: g.branchName })),
  ], [groups]);

  const stageOptions = useMemo(() => [
    { value: '', label: 'All stages' },
    ...STAGES.map((s) => ({ value: s, label: s })),
  ], []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = rows;
    if (branchFilter) list = list.filter((r) => r.branchId === branchFilter);
    if (stageFilter) list = list.filter((r) => r.status === stageFilter);
    if (q) {
      list = list.filter((r) =>
        (r.customerName || '').toLowerCase().includes(q) ||
        (r.customerPhone || '').toLowerCase().includes(q) ||
        (r.bookingNumber || '').toLowerCase().includes(q) ||
        (r.therapistName || '').toLowerCase().includes(q) ||
        createdByLabel(r).toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, branchFilter, stageFilter, searchQuery]);

  const totalDue = useMemo(() => filtered.reduce((s, r) => s + r.amountDue, 0), [filtered]);

  const branchBreakdown = useMemo(() => {
    const byBranch = {};
    filtered.forEach((r) => {
      if (!byBranch[r.branchId]) byBranch[r.branchId] = { branchName: r.branchName, due: 0, count: 0 };
      byBranch[r.branchId].due += r.amountDue;
      byBranch[r.branchId].count += 1;
    });
    return Object.values(byBranch).sort((a, b) => b.due - a.due);
  }, [filtered]);

  const stageBreakdown = useMemo(() => {
    const byStage = {};
    STAGES.forEach((s) => { byStage[s] = { due: 0, count: 0 }; });
    filtered.forEach((r) => {
      if (!byStage[r.status]) byStage[r.status] = { due: 0, count: 0 };
      byStage[r.status].due += r.amountDue;
      byStage[r.status].count += 1;
    });
    return STAGES.map((s) => ({ stage: s, ...byStage[s] }));
  }, [filtered]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'due') return (a.amountDue - b.amountDue) * dir;
      if (sortKey === 'date') return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * dir;
      if (sortKey === 'branch') return a.branchName.localeCompare(b.branchName) * dir;
      if (sortKey === 'stage') return a.status.localeCompare(b.status) * dir;
      if (sortKey === 'customer') return (a.customerName || '').localeCompare(b.customerName || '') * dir;
      if (sortKey === 'createdBy') return createdByLabel(a).localeCompare(createdByLabel(b)) * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

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

  const openPay = async (row) => {
    setPayingRow(row);
    setOtherDueBookings([]);
    if (!row.customerPhone) return;
    const { data } = await getCustomerOutstandingBalance({
      customerPhone: row.customerPhone,
      branchId: row.branchId,
      excludeBookingId: row.bookingId,
    });
    setOtherDueBookings(data?.bookings || []);
  };

  const handleRecordPayment = async ({ tenders, additionalAllocations, dueHolderName, notes, tipSplits }) => {
    if (!payingRow) return { error: { message: 'No booking selected.' } };
    setPaymentSubmitting(true);
    const result = await recordPayment({ bookingId: payingRow.bookingId, tenders, dueHolderName, notes });
    if (result.error) {
      setPaymentSubmitting(false);
      return { error: result.error };
    }
    for (const split of (tipSplits || [])) {
      const tipResult = await recordTip({ bookingId: payingRow.bookingId, amount: split.amount, receivedBy: split.receivedBy });
      if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
    }
    for (const alloc of (additionalAllocations || [])) {
      await recordPayment({ bookingId: alloc.bookingId, tenders: alloc.tenders, notes });
    }
    setPaymentSubmitting(false);
    setPayingRow(null);
    setOtherDueBookings([]);
    await load();
    return { error: null };
  };

  const handleExportCSV = () => {
    if (!filtered.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Branch', 'Date', 'Booking #', 'Stage', 'Payment', 'Due', 'Customer', 'Phone', 'Therapist', 'Created By'];
    let csv = header.join(',') + '\n';
    filtered.forEach((r) => {
      csv += [
        esc(r.branchName), esc(formatDateOnly(r.date)), esc(r.bookingNumber), esc(r.status), esc(r.paymentStatus),
        esc(r.amountDue), esc(r.customerName), esc(r.customerPhone), esc(r.therapistName || 'Unassigned'), esc(createdByLabel(r)),
      ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'due-report-all-branches.csv';
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Due Report</h3>
          <p className="font-body text-sm text-text-secondary">
            {loading ? 'Loading…' : `${formatNPR(totalDue)} across ${filtered.length} booking${filtered.length !== 1 ? 's' : ''}`}
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

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {branchBreakdown.map((b) => (
              <div key={b.branchName} className="bg-surface border border-border rounded-spa p-3">
                <div className="font-body font-body-medium text-sm text-text-primary">{b.branchName}</div>
                <div className="font-data font-data-semibold text-base text-warning mt-1">{formatNPR(b.due)}</div>
                <div className="font-caption text-xs text-text-tertiary mt-0.5">{b.count} booking{b.count !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>

          <div className="bg-surface border border-border rounded-spa p-4">
            <div className="font-body font-body-medium text-sm text-text-secondary mb-3">By stage</div>
            <div className="flex h-2.5 rounded-full overflow-hidden border border-border mb-3">
              {stageBreakdown.map((s) => (
                <span
                  key={s.stage}
                  className={s.stage === 'Pending' ? 'bg-text-tertiary' : s.stage === 'Confirmed' ? 'bg-warning' : s.stage === 'In-Progress' ? 'bg-primary' : 'bg-success'}
                  style={{ width: totalDue > 0 ? `${(s.due / totalDue) * 100}%` : '0%' }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              {stageBreakdown.map((s) => (
                <span key={s.stage} className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-sm inline-block ${s.stage === 'Pending' ? 'bg-text-tertiary' : s.stage === 'Confirmed' ? 'bg-warning' : s.stage === 'In-Progress' ? 'bg-primary' : 'bg-success'}`} />
                  <span className="text-text-secondary">{s.stage}</span>
                  <span className="font-data text-text-tertiary">{formatNPR(s.due)} · {s.count}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <FilterBar
        count={{ value: filtered.length, label: filtered.length === 1 ? 'Booking' : 'Bookings' }}
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search customer, phone, booking #, therapist, created by…' }}
        presets={presetItems}
        dateRange={{
          from: customFrom, onFromChange: setCustomFrom, to: customTo, onToChange: setCustomTo,
          max: today, onApply: handleCustomApply, applyDisabled: !customFrom || !customDirty, applyActive: mode === 'custom',
        }}
        hasActiveFilters={searchQuery.trim().length > 0 || branchFilter !== '' || stageFilter !== ''}
        onClear={() => { setSearchQuery(''); setBranchFilter(''); setStageFilter(''); }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-body text-sm text-text-secondary flex-shrink-0">Branch</span>
          <CustomSelect value={branchFilter} onChange={setBranchFilter} options={branchOptions} size="sm" searchable className="w-48" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-body text-sm text-text-secondary flex-shrink-0">Stage</span>
          <CustomSelect value={stageFilter} onChange={setStageFilter} options={stageOptions} size="sm" className="w-40" />
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center bg-surface border border-border rounded-spa">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="font-body text-sm text-text-secondary">Loading due report...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center bg-surface border border-border rounded-spa">
          <Icon name="CheckCircle" size={32} className="text-success mx-auto mb-3" />
          <p className="font-body text-sm text-text-secondary">
            {rows.length === 0 ? 'No outstanding balances. Everything is settled.' : 'No balances match the current filters.'}
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-spa overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-sticky-filter">
                <tr className="bg-background border-b border-border">
                  <th className="text-left px-4 py-2.5">
                    <button onClick={() => handleSort('branch')} className="inline-flex items-center gap-1 font-body font-body-medium text-xs text-text-secondary hover:text-text-primary spa-transition-fast">
                      Branch <Icon name={sortIcon('branch')} size={13} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5">
                    <button onClick={() => handleSort('date')} className="inline-flex items-center gap-1 font-body font-body-medium text-xs text-text-secondary hover:text-text-primary spa-transition-fast">
                      Date <Icon name={sortIcon('date')} size={13} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Booking #</th>
                  <th className="text-left px-4 py-2.5">
                    <button onClick={() => handleSort('stage')} className="inline-flex items-center gap-1 font-body font-body-medium text-xs text-text-secondary hover:text-text-primary spa-transition-fast">
                      Stage <Icon name={sortIcon('stage')} size={13} />
                    </button>
                  </th>
                  <th className="text-right px-4 py-2.5">
                    <button onClick={() => handleSort('due')} className="inline-flex items-center gap-1 ml-auto font-body font-body-medium text-xs text-text-secondary hover:text-text-primary spa-transition-fast">
                      Due <Icon name={sortIcon('due')} size={13} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5">
                    <button onClick={() => handleSort('customer')} className="inline-flex items-center gap-1 font-body font-body-medium text-xs text-text-secondary hover:text-text-primary spa-transition-fast">
                      Customer <Icon name={sortIcon('customer')} size={13} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Therapist</th>
                  <th className="text-left px-4 py-2.5">
                    <button onClick={() => handleSort('createdBy')} className="inline-flex items-center gap-1 font-body font-body-medium text-xs text-text-secondary hover:text-text-primary spa-transition-fast">
                      Created By <Icon name={sortIcon('createdBy')} size={13} />
                    </button>
                  </th>
                  <th className="text-right px-4 py-2.5 font-body font-body-medium text-xs text-text-secondary">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr
                    key={r.bookingId}
                    onClick={() => navigate(`/${orgSlug}/bookings/${r.bookingId}`)}
                    className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast cursor-pointer"
                  >
                    <td className="px-4 py-2.5 font-body font-body-medium text-sm text-text-primary whitespace-nowrap">{r.branchName}</td>
                    <td className="px-4 py-2.5 font-body text-sm text-text-primary whitespace-nowrap">{formatDateOnly(r.date)}</td>
                    <td className="px-4 py-2.5 font-data text-sm text-text-primary whitespace-nowrap">{r.bookingNumber}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-spa text-xs font-body-medium ${STAGE_STYLE[r.status] || 'bg-background text-text-secondary'}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-data font-data-medium text-sm text-warning font-semibold whitespace-nowrap">{formatNPR(r.amountDue)}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-body font-body-medium text-sm text-text-primary">{r.customerName}</div>
                      <div className="font-caption text-xs text-text-tertiary">{r.customerPhone || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 font-body text-sm text-text-secondary whitespace-nowrap">{r.therapistName || 'Unassigned'}</td>
                    <td className="px-4 py-2.5 font-body text-sm whitespace-nowrap">
                      <span className={r.createdByName ? 'text-text-primary' : r.isOnlineBooking ? 'text-primary font-body-medium' : 'text-text-tertiary italic'}>
                        {createdByLabel(r)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
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
            </table>
          </div>
        </div>
      )}

      {payingRow && (
        <PaymentModal
          booking={{
            bookingId: payingRow.bookingId,
            booking_number: payingRow.bookingNumber,
            branchId: payingRow.branchId,
            finalAmount: payingRow.finalAmount,
            amountPaid: payingRow.amountPaid,
            service: payingRow.serviceName,
          }}
          additionalBookings={otherDueBookings}
          onConfirm={handleRecordPayment}
          onClose={() => { setPayingRow(null); setOtherDueBookings([]); }}
          isSubmitting={paymentSubmitting}
        />
      )}
    </div>
  );
};

export default DueReportPanel;
