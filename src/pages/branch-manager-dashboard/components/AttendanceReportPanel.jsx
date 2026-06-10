import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import FilterBar from '../../../components/ui/FilterBar';
import { fetchAttendanceReport } from '../../../services/api';

const PRESETS = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' },
];

const STAFF_TYPE_OPTIONS = [
  { value: 'all', label: 'All staff' },
  { value: 'service', label: 'Service' },
  { value: 'support', label: 'Support' },
];

const toISO = (d) => d.toISOString().split('T')[0];

// Calendar-period-to-date ranges ending today (weekly = rolling 7 days).
function getPresetRange(preset) {
  const today = new Date();
  const end = toISO(today);
  let start;
  switch (preset) {
    case 'daily':
      start = end;
      break;
    case 'weekly':
      start = toISO(new Date(today.getTime() - 6 * 86400000));
      break;
    case 'monthly':
      start = toISO(new Date(today.getFullYear(), today.getMonth(), 1));
      break;
    case 'quarterly': {
      const q = Math.floor(today.getMonth() / 3);
      start = toISO(new Date(today.getFullYear(), q * 3, 1));
      break;
    }
    case 'yearly':
      start = toISO(new Date(today.getFullYear(), 0, 1));
      break;
    default:
      start = end;
  }
  return { startDate: start, endDate: end };
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function SummaryCard({ label, value, tone }) {
  const toneClass = {
    primary: 'text-text-primary',
    success: 'text-success',
    error: 'text-error',
    warning: 'text-warning',
    secondary: 'text-secondary',
  }[tone] || 'text-text-primary';
  return (
    <div className="bg-surface rounded-spa border border-border px-4 py-3">
      <p className="font-caption text-[11px] text-text-tertiary uppercase tracking-wide">{label}</p>
      <p className={`font-heading font-heading-semibold text-2xl ${toneClass}`}>{value}</p>
    </div>
  );
}

const AttendanceReportPanel = ({ branchId }) => {
  const today = toISO(new Date());

  const [activePreset, setActivePreset] = useState('monthly');
  const [mode, setMode] = useState('preset'); // 'preset' | 'custom'
  const [customFrom, setCustomFrom] = useState('');   // live input value
  const [customTo, setCustomTo] = useState('');       // live input value
  const [appliedFrom, setAppliedFrom] = useState(''); // committed on Apply
  const [appliedTo, setAppliedTo] = useState('');     // committed on Apply
  const [staffType, setStaffType] = useState('all'); // 'all' | 'service' | 'support'
  const [searchQuery, setSearchQuery] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Range is driven by the APPLIED dates, never the live inputs, so editing the
  // date pickers does not re-fetch until the user clicks Apply.
  const range = useMemo(() => {
    if (mode === 'custom' && appliedFrom) {
      return { startDate: appliedFrom, endDate: appliedTo || today };
    }
    return getPresetRange(activePreset);
  }, [mode, activePreset, appliedFrom, appliedTo, today]);

  // True when the inputs differ from what's currently applied (pending Apply).
  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    const result = await fetchAttendanceReport({ branchId, ...range });
    if (result.error) {
      setError(result.error.message || 'Failed to load attendance report.');
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [branchId, range]);

  useEffect(() => { loadData(); }, [loadData]);

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

  const handleExportCSV = () => {
    if (!data) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const staff = (data.perStaff || []).filter((s) =>
      staffType === 'all' ? true : staffType === 'service' ? s.isServiceStaff : !s.isServiceStaff
    );
    const t = staff.reduce(
      (acc, s) => {
        acc.present += s.present; acc.absent += s.absent; acc.leave += s.leave;
        acc.halfDay += s.halfDay; acc.marked += s.marked;
        return acc;
      },
      { present: 0, absent: 0, leave: 0, halfDay: 0, marked: 0 }
    );
    t.attendanceRate = t.marked > 0 ? Math.round((t.present / t.marked) * 100) : 0;
    const staffTypeLabel = staffType === 'all' ? 'All' : staffType === 'service' ? 'Service' : 'Support';
    const rows = [];

    rows.push('ATTENDANCE REPORT');
    rows.push(`Period,${data.startDate} to ${data.endDate}`);
    rows.push(`Staff filter,${staffTypeLabel}`);
    rows.push('');

    rows.push('SUMMARY');
    rows.push(`Total Staff,${staff.length}`);
    rows.push(`Records,${t.marked}`);
    rows.push(`Present,${t.present}`);
    rows.push(`Absent,${t.absent}`);
    rows.push(`Leave,${t.leave}`);
    rows.push(`Half Day,${t.halfDay}`);
    rows.push(`Attendance %,${t.attendanceRate}`);
    rows.push('');

    rows.push('PER-STAFF BREAKDOWN');
    rows.push(['Staff', 'Type', 'Present', 'Absent', 'Leave', 'Half Day', 'Days Marked', 'Attendance %'].join(','));
    const sorted = [...staff].sort(
      (a, b) => b.marked - a.marked || a.therapistName.localeCompare(b.therapistName)
    );
    for (const s of sorted) {
      rows.push([
        esc(s.therapistName),
        s.isServiceStaff ? 'Service staff' : 'Support staff',
        s.present,
        s.absent,
        s.leave,
        s.halfDay,
        s.marked,
        s.marked > 0 ? s.attendanceRate : '',
      ].join(','));
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-report-${data.startDate}-to-${data.endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-6 animate-pulse">
        <div className="h-5 bg-background rounded w-56 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 bg-background rounded" />)}
        </div>
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

  const allStaff = data?.perStaff || [];
  const perStaff = allStaff.filter((s) =>
    staffType === 'all' ? true : staffType === 'service' ? s.isServiceStaff : !s.isServiceStaff
  );
  // Recompute totals from the filtered set so summary cards match the table.
  const totals = perStaff.reduce(
    (acc, s) => {
      acc.present += s.present;
      acc.absent += s.absent;
      acc.leave += s.leave;
      acc.halfDay += s.halfDay;
      acc.marked += s.marked;
      return acc;
    },
    { present: 0, absent: 0, leave: 0, halfDay: 0, marked: 0 }
  );
  totals.attendanceRate = totals.marked > 0 ? Math.round((totals.present / totals.marked) * 100) : 0;
  const filteredStaffCount = perStaff.length;
  const q = searchQuery.trim().toLowerCase();
  const searchedStaff = q
    ? perStaff.filter((s) => (s.therapistName || '').toLowerCase().includes(q))
    : perStaff;
  const rankedStaff = [...searchedStaff].sort((a, b) => b.marked - a.marked || a.therapistName.localeCompare(b.therapistName));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-heading font-heading-semibold text-xl text-text-primary">Attendance Report</h2>
          <p className="font-body text-sm text-text-secondary">
            Staff attendance over a period. Period: {formatDate(data?.startDate)} – {formatDate(data?.endDate)}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button
            onClick={handleExportCSV}
            disabled={!data || totals.marked === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-surface font-body font-body-medium text-sm text-text-secondary hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed spa-transition-fast"
            title="Export to CSV"
          >
            <Icon name="Download" size={15} />
            Export CSV
          </button>
          <button onClick={loadData} className="p-2 rounded-lg hover:bg-gray-100 transition-colors" title="Refresh">
            <Icon name="RefreshCw" size={16} className="text-text-tertiary" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <FilterBar
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search staff by name…' }}
        presets={PRESETS.map((p) => ({
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
        filters={[{ value: staffType, onChange: setStaffType, options: STAFF_TYPE_OPTIONS }]}
      />

      {/* Applied custom range indicator */}
      {mode === 'custom' && appliedFrom && (
        <div className="flex items-center gap-1.5 -mt-1">
          <Icon name="CalendarRange" size={14} className="text-text-tertiary" />
          <span className="font-body text-xs text-text-secondary">
            Showing {formatDate(appliedFrom)} – {formatDate(appliedTo || today)}
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Staff" value={filteredStaffCount} tone="primary" />
        <SummaryCard label="Records" value={totals.marked} tone="primary" />
        <SummaryCard label="Present" value={totals.present} tone="success" />
        <SummaryCard label="Absent" value={totals.absent} tone="error" />
        <SummaryCard label="Leave" value={totals.leave} tone="warning" />
        <SummaryCard label="Half Day" value={totals.halfDay} tone="secondary" />
      </div>

      {/* Per-staff table */}
      <div className="bg-surface rounded-spa-lg border border-border">
        <div className="hidden lg:grid lg:grid-cols-[1.6fr_90px_90px_90px_110px_110px_110px] gap-3 px-5 py-3 bg-background/50 border-b border-border rounded-t-spa-lg">
          {['Staff', 'Present', 'Absent', 'Leave', 'Half Day', 'Days Marked', 'Attendance %'].map((h, i) => (
            <span key={h} className={`font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide ${i === 0 ? '' : 'text-center'}`}>{h}</span>
          ))}
        </div>

        {perStaff.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="CalendarCheck" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No active staff for this branch.</p>
          </div>
        ) : totals.marked === 0 ? (
          <div className="p-8 text-center">
            <Icon name="CalendarX" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No attendance recorded in this period.</p>
          </div>
        ) : rankedStaff.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="SearchX" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No staff match "{searchQuery.trim()}".</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rankedStaff.map(s => (
              <div
                key={s.therapistId}
                className="grid grid-cols-2 lg:grid-cols-[1.6fr_90px_90px_90px_110px_110px_110px] gap-2 lg:gap-3 px-5 py-3 lg:items-center"
              >
                <div className="min-w-0 col-span-2 lg:col-span-1">
                  <p className="font-body font-body-medium text-sm text-text-primary truncate">{s.therapistName}</p>
                  <p className="font-caption text-[11px] text-text-tertiary">{s.isServiceStaff ? 'Service staff' : 'Support staff'}</p>
                </div>
                <div className="lg:text-center">
                  <span className="lg:hidden font-caption text-[11px] text-text-tertiary uppercase mr-1">Present:</span>
                  <span className="font-data text-sm text-success">{s.present}</span>
                </div>
                <div className="lg:text-center">
                  <span className="lg:hidden font-caption text-[11px] text-text-tertiary uppercase mr-1">Absent:</span>
                  <span className="font-data text-sm text-error">{s.absent}</span>
                </div>
                <div className="lg:text-center">
                  <span className="lg:hidden font-caption text-[11px] text-text-tertiary uppercase mr-1">Leave:</span>
                  <span className="font-data text-sm text-warning">{s.leave}</span>
                </div>
                <div className="lg:text-center">
                  <span className="lg:hidden font-caption text-[11px] text-text-tertiary uppercase mr-1">Half Day:</span>
                  <span className="font-data text-sm text-secondary">{s.halfDay}</span>
                </div>
                <div className="lg:text-center">
                  <span className="lg:hidden font-caption text-[11px] text-text-tertiary uppercase mr-1">Days:</span>
                  <span className="font-data text-sm text-text-primary">{s.marked}</span>
                </div>
                <div className="lg:text-center">
                  <span className="lg:hidden font-caption text-[11px] text-text-tertiary uppercase mr-1">Rate:</span>
                  <span className="font-data text-sm text-text-primary">{s.marked > 0 ? `${s.attendanceRate}%` : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AttendanceReportPanel;
