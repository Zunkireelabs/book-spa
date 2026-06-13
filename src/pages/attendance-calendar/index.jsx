import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBranch } from 'contexts/BranchContext';
import Icon from 'components/AppIcon';
import CustomSelect from 'components/ui/CustomSelect';
import { PERIOD_PRESETS, getPeriodRange, getTodayISO, toISO } from 'utils/periodPresets';
import { fetchAttendanceReport } from 'services/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getDatesInRange(startDate, endDate) {
  const dates = [];
  const end = parseLocalDate(endDate);
  const cur = parseLocalDate(startDate);
  while (cur <= end) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    dates.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function cellStyle(status) {
  switch (status) {
    case 'Present':      return { bg: 'bg-success',    title: 'Present' };
    case 'Absent':       return { bg: 'bg-error',      title: 'Absent' };
    case 'Leave':        return { bg: 'bg-warning',    title: 'Leave' };
    case '1st-Half Day': return { bg: 'bg-primary/60', title: '1st Half Day' };
    case '2nd-Half Day': return { bg: 'bg-primary/60', title: '2nd Half Day' };
    default:             return { bg: 'bg-border/50',  title: 'No record' };
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtShort(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Month calendar card ───────────────────────────────────────────────────────

const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function CalendarMonth({ year, month, attendanceByDate, today, large = false }) {
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const firstDow = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const cells = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isoOf = (d) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const dayStyle = (d) => {
    const status = attendanceByDate[isoOf(d)];
    switch (status) {
      case 'Present':      return { bg: '#D1FAE5', fg: '#065F46' };
      case 'Absent':       return { bg: '#FEE2E2', fg: '#991B1B' };
      case 'Leave':        return { bg: '#FFEDD5', fg: '#9A3412' };
      case '1st-Half Day':
      case '2nd-Half Day': return { bg: '#DBEAFE', fg: '#1E40AF' };
      default:             return { bg: null, fg: '#374151' };
    }
  };

  return (
    <div className={`bg-surface border border-border rounded-spa-lg shadow-spa-resting select-none ${large ? 'p-6' : 'p-3'}`}>
      <p className={`font-heading font-heading-semibold text-text-primary mb-3 px-0.5 ${large ? 'text-lg' : 'text-sm'}`}>
        {monthLabel}
      </p>
      <div className="grid grid-cols-7 mb-1">
        {DOW_LABELS.map((d, i) => (
          <div key={i} className={`text-center font-body text-text-tertiary py-1 ${large ? 'text-sm' : 'text-[10px]'}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} className="aspect-square" />;
          const iso = isoOf(day);
          const isToday = iso === today;
          const { bg, fg } = dayStyle(day);
          return (
            <div key={idx} className={`flex items-center justify-center aspect-square ${large ? 'p-1' : 'p-px'}`}>
              <div
                className="w-full h-full flex items-center justify-center rounded-full"
                style={{
                  backgroundColor: isToday ? '#2D5A27' : (bg || 'transparent'),
                  color: isToday ? '#fff' : fg,
                  fontWeight: (isToday || bg) ? 600 : 400,
                  fontSize: large ? 16 : 12,
                }}
                title={iso}
              >
                {day}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Staff type options ────────────────────────────────────────────────────────

const STAFF_TYPE_OPTIONS = [
  { value: 'all',     label: 'All staff' },
  { value: 'service', label: 'Service' },
  { value: 'support', label: 'Support' },
];

// ── Page ─────────────────────────────────────────────────────────────────────

const AttendanceCalendarPage = () => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { branchId, branchName } = useBranch();
  const today = getTodayISO();

  const [activePreset, setActivePreset] = useState('monthly');
  const [mode, setMode] = useState('preset'); // 'preset' | 'custom'
  const [weekOffset, setWeekOffset] = useState(0); // weeks back from current (weekly preset only)
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [staffType, setStaffType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Aggregated view: single-staff focus
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [aggSearchInput, setAggSearchInput] = useState('');
  const [aggDropdownOpen, setAggDropdownOpen] = useState(false);
  const aggDropdownRef = useRef(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const range = useMemo(() => {
    if (mode === 'custom' && appliedFrom) {
      return { startDate: appliedFrom, endDate: appliedTo || today };
    }
    if (activePreset === 'weekly') {
      const endD = new Date();
      endD.setDate(endD.getDate() - weekOffset * 7);
      const startD = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() - 6);
      return { startDate: toISO(startD), endDate: toISO(endD) };
    }
    if (activePreset === 'monthly') {
      const now = new Date();
      return {
        startDate: toISO(new Date(now.getFullYear(), now.getMonth(), 1)),
        endDate: toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    }
    if (activePreset === 'quarterly') {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      return {
        startDate: toISO(new Date(now.getFullYear(), q * 3, 1)),
        endDate: toISO(new Date(now.getFullYear(), q * 3 + 3, 0)),
      };
    }
    if (activePreset === 'semiannual') {
      const now = new Date();
      const half = now.getMonth() < 6 ? 0 : 6;
      return {
        startDate: toISO(new Date(now.getFullYear(), half, 1)),
        endDate: toISO(new Date(now.getFullYear(), half + 6, 0)),
      };
    }
    if (activePreset === 'annually') {
      const now = new Date();
      return {
        startDate: toISO(new Date(now.getFullYear(), 0, 1)),
        endDate: toISO(new Date(now.getFullYear(), 12, 0)),
      };
    }
    return getPeriodRange(activePreset);
  }, [mode, activePreset, appliedFrom, appliedTo, today, weekOffset]);

  const isAggregated = useMemo(() => {
    if (mode === 'preset') {
      return ['monthly', 'quarterly', 'semiannual', 'annually'].includes(activePreset);
    }
    // Custom range > 62 days → show calendar cards instead of the "too wide" error
    if (!range.startDate || !range.endDate) return false;
    return getDatesInRange(range.startDate, range.endDate).length > 62;
  }, [mode, activePreset, range]);

  const customDirty = customFrom && (customFrom !== appliedFrom || customTo !== appliedTo);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    const result = await fetchAttendanceReport({ branchId, ...range });
    if (result.error) {
      setError(result.error.message || 'Failed to load attendance.');
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [branchId, range]);

  useEffect(() => { load(); }, [load]);

  // Close aggregated staff dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (aggDropdownRef.current && !aggDropdownRef.current.contains(e.target)) {
        setAggDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filtered + sorted staff
  const staffRows = useMemo(() => {
    const all = data?.perStaff || [];
    const byType = all.filter((s) =>
      staffType === 'all' ? true : staffType === 'service' ? s.isServiceStaff : !s.isServiceStaff
    );
    const q = searchQuery.trim().toLowerCase();
    const searched = q ? byType.filter((s) => s.therapistName.toLowerCase().includes(q)) : byType;
    return [...searched].sort((a, b) => b.marked - a.marked || a.therapistName.localeCompare(b.therapistName));
  }, [data, staffType, searchQuery]);

  // Auto-select first staff when entering aggregated mode or when data refreshes
  useEffect(() => {
    if (!isAggregated || staffRows.length === 0) return;
    const stillPresent = selectedStaffId && staffRows.find((s) => s.therapistId === selectedStaffId);
    if (!stillPresent) {
      setSelectedStaffId(staffRows[0].therapistId);
      setAggSearchInput(staffRows[0].therapistName);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAggregated, staffRows]);

  // Day-by-day lookup: { [therapistId]: { [date]: status } }
  const lookup = useMemo(() => {
    const map = {};
    for (const r of (data?.dayRecords || [])) {
      if (!map[r.therapistId]) map[r.therapistId] = {};
      map[r.therapistId][r.date] = r.status;
    }
    return map;
  }, [data]);

  const dates = useMemo(
    () => (data ? getDatesInRange(data.startDate, data.endDate) : []),
    [data]
  );

  const tooManyDays = !isAggregated && dates.length > 62;

  const selectedStaff = useMemo(() => {
    if (!isAggregated) return null;
    return staffRows.find((s) => s.therapistId === selectedStaffId) || staffRows[0] || null;
  }, [isAggregated, selectedStaffId, staffRows]);

  const aggFilteredStaff = useMemo(() => {
    const q = aggSearchInput.trim().toLowerCase();
    if (!q) return staffRows;
    return staffRows.filter((s) => s.therapistName.toLowerCase().includes(q));
  }, [staffRows, aggSearchInput]);

  // Calendar month list derived from the fetched range
  const calendarMonths = useMemo(() => {
    if (!isAggregated) return [];
    const months = [];
    const cur = new Date(parseLocalDate(range.startDate).getFullYear(), parseLocalDate(range.startDate).getMonth(), 1);
    const end = parseLocalDate(range.endDate);
    while (cur <= end) {
      months.push({ year: cur.getFullYear(), month: cur.getMonth() });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }, [isAggregated, range]);

  // Summary
  const totals = useMemo(() => {
    return staffRows.reduce(
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
  }, [staffRows]);

  // HTML export — fully self-contained file, no app required
  const handleExportHTML = () => {
    if (!data || !staffRows.length || !dates.length) return;

    const cellColor = (status) => {
      switch (status) {
        case 'Present':      return '#10B981';
        case 'Absent':       return '#DC2626';
        case 'Leave':        return '#D97706';
        case '1st-Half Day':
        case '2nd-Half Day': return '#2D5A2799';
        default:             return '#E1E3E5';
      }
    };

    const DAY_ABBR_LOCAL = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

    const headCols = dates.map((iso) => {
      const d = parseLocalDate(iso);
      const dayIdx = d.getDay();
      const isWeekend = dayIdx === 0 || dayIdx === 6;
      const dimColor = isWeekend ? '#9CA3AF' : '#374151';
      return `
        <th style="min-width:40px;padding:6px 4px;text-align:center;background:#F9FAFB;border-bottom:2px solid #E1E3E5;">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${dimColor};letter-spacing:.05em;">${DAY_ABBR_LOCAL[dayIdx]}</div>
          <div style="font-size:13px;font-weight:600;color:${dimColor};margin-top:1px;">${d.getDate()}</div>
        </th>`;
    }).join('');

    const bodyRows = staffRows.map((s, rowIdx) => {
      const byDate = lookup[s.therapistId] || {};
      const rowBg = rowIdx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
      const dayCells = dates.map((iso) => {
        const st = byDate[iso];
        const color = cellColor(st);
        const title = st || 'No record';
        return `<td style="padding:6px 4px;text-align:center;background:${rowBg};" title="${title}">
          <span style="display:inline-block;width:26px;height:26px;border-radius:4px;background:${color};"></span>
        </td>`;
      }).join('');
      return `
        <tr>
          <td style="position:sticky;left:0;background:${rowBg};padding:8px 16px;border-right:1px solid #E1E3E5;white-space:nowrap;z-index:1;">
            <div style="font-weight:600;font-size:13px;color:#111827;">${s.therapistName}</div>
            <div style="font-size:10px;color:#9CA3AF;margin-top:1px;">${s.isServiceStaff ? 'Service' : 'Support'}</div>
          </td>
          ${dayCells}
          <td style="position:sticky;right:0;background:${rowBg};padding:8px 14px;text-align:center;border-left:1px solid #E1E3E5;font-weight:700;font-size:13px;color:#111827;">
            ${s.marked > 0 ? `${s.attendanceRate}%` : '—'}
          </td>
        </tr>`;
    }).join('');

    const legend = [
      { label: 'Present',   color: '#10B981' },
      { label: 'Absent',    color: '#DC2626' },
      { label: 'Leave',     color: '#D97706' },
      { label: 'Half Day',  color: '#2D5A2799' },
      { label: 'No record', color: '#E1E3E5' },
    ].map(l => `
      <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#6B7280;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${l.color};flex-shrink:0;"></span>
        ${l.label}
      </span>`).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Attendance Calendar · ${fmtDate(data.startDate)} – ${fmtDate(data.endDate)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, -apple-system, sans-serif; background: #F3F4F6; color: #111827; }
    .page { max-width: 1400px; margin: 0 auto; padding: 32px 24px; }
    h1 { font-size: 22px; font-weight: 700; color: #111827; }
    .subtitle { font-size: 13px; color: #6B7280; margin-top: 4px; }
    .summary { display: flex; gap: 32px; margin: 20px 0; flex-wrap: wrap; }
    .summary-item { display: flex; flex-direction: column; }
    .summary-item .val { font-size: 28px; font-weight: 700; }
    .summary-item .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9CA3AF; margin-top: 2px; }
    .legend { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .table-wrap { overflow-x: auto; background: #fff; border-radius: 10px; border: 1px solid #E1E3E5; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
    table { border-collapse: collapse; width: max-content; min-width: 100%; }
    thead th { position: sticky; top: 0; z-index: 2; }
    .name-th { position: sticky; left: 0; z-index: 3 !important; background: #F9FAFB; min-width: 200px; padding: 10px 16px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9CA3AF; border-right: 1px solid #E1E3E5; border-bottom: 2px solid #E1E3E5; }
    .rate-th { position: sticky; right: 0; z-index: 3 !important; background: #F9FAFB; padding: 10px 14px; text-align: center; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9CA3AF; border-left: 1px solid #E1E3E5; border-bottom: 2px solid #E1E3E5; }
    tr:last-child td { border-bottom: none; }
    @media print { body { background: #fff; } .page { padding: 0; } }
  </style>
</head>
<body>
  <div class="page">
    <h1>📅 Attendance Calendar</h1>
    <p class="subtitle">${branchName || ''} &nbsp;·&nbsp; ${fmtDate(data.startDate)} – ${fmtDate(data.endDate)}</p>

    <div class="summary">
      <div class="summary-item"><span class="val">${staffRows.length}</span><span class="lbl">Staff</span></div>
      <div class="summary-item"><span class="val" style="color:#10B981">${totals.present}</span><span class="lbl">Present</span></div>
      <div class="summary-item"><span class="val" style="color:#DC2626">${totals.absent}</span><span class="lbl">Absent</span></div>
      <div class="summary-item"><span class="val" style="color:#D97706">${totals.leave}</span><span class="lbl">Leave</span></div>
      <div class="summary-item"><span class="val" style="color:#2D5A27">${totals.halfDay}</span><span class="lbl">Half Day</span></div>
    </div>

    <div class="legend">${legend}</div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="name-th">Staff Member</th>
            ${headCols}
            <th class="rate-th">Rate</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>

    <p style="margin-top:16px;font-size:11px;color:#9CA3AF;">Generated by Zenly &nbsp;·&nbsp; ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</p>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${data.startDate}-to-${data.endDate}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // CSV export (day-by-day)
  const handleExportCSV = () => {
    if (!data || !staffRows.length || !dates.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Staff', ...dates, 'Attendance %'];
    let csv = header.join(',') + '\n';
    staffRows.forEach((s) => {
      const byDate = lookup[s.therapistId] || {};
      csv += [
        esc(s.therapistName),
        ...dates.map((d) => esc(byDate[d] || '')),
        esc(s.marked > 0 ? `${s.attendanceRate}%` : ''),
      ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-calendar-${data.startDate}-to-${data.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">

      {/* ── Top bar ── */}
      <header className="sticky top-0 z-header bg-surface border-b border-border px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(`/${orgSlug}/dashboard?view=attendance-report`)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-spa border border-border bg-background text-sm font-body-medium text-text-secondary hover:bg-border/30 spa-transition-fast flex-shrink-0"
          >
            <Icon name="ArrowLeft" size={15} />
            Back
          </button>

          <div className="h-5 w-px bg-border flex-shrink-0" />

          <div className="min-w-0">
            <h1 className="font-heading font-heading-semibold text-lg text-text-primary leading-tight flex items-center gap-2">
              <Icon name="CalendarDays" size={18} className="text-primary flex-shrink-0" />
              Attendance Calendar
            </h1>
            {branchName && (
              <p className="font-body text-xs text-text-secondary truncate">{branchName}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {data && staffRows.length > 0 && !isAggregated && !tooManyDays && (
            <>
              <button
                onClick={handleExportHTML}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-primary/40 bg-primary/5 text-sm font-body-medium text-primary hover:bg-primary/10 spa-transition-fast"
              >
                <Icon name="FileCode" size={15} />
                Export HTML
              </button>
              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-surface text-sm font-body-medium text-text-secondary hover:bg-background spa-transition-fast"
              >
                <Icon name="Download" size={15} />
                Export CSV
              </button>
            </>
          )}
          <button
            onClick={load}
            className="p-2 rounded-spa hover:bg-background text-text-tertiary hover:text-text-secondary spa-transition-fast"
            title="Refresh"
          >
            <Icon name="RefreshCw" size={16} />
          </button>
        </div>
      </header>

      {/* ── Filters ── */}
      <div className="bg-surface border-b border-border px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
        {/* Period presets */}
        <div className="flex items-center gap-1 flex-wrap">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setMode('preset');
                setActivePreset(p.id);
                if (p.id !== 'weekly') setWeekOffset(0);
              }}
              className={`px-2.5 py-1 rounded text-xs font-body-medium transition-colors ${
                mode === 'preset' && activePreset === p.id
                  ? 'bg-primary text-white'
                  : 'bg-background border border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            max={today}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-spa border border-border bg-surface px-2 py-1 font-data text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <span className="font-body text-xs text-text-tertiary">to</span>
          <input
            type="date"
            value={customTo}
            max={today}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-spa border border-border bg-surface px-2 py-1 font-data text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            onClick={() => { if (customFrom) { setAppliedFrom(customFrom); setAppliedTo(customTo); setMode('custom'); } }}
            disabled={!customFrom || !customDirty}
            className={`px-2.5 py-1 rounded text-xs font-body-medium transition-colors disabled:opacity-40 ${
              mode === 'custom'
                ? 'bg-primary text-white'
                : 'bg-background border border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            Apply
          </button>
        </div>

        <div className="h-4 w-px bg-border hidden sm:block" />

        {/* Staff type */}
        <div className="w-32">
          <CustomSelect
            options={STAFF_TYPE_OPTIONS}
            value={staffType}
            onChange={setStaffType}
            size="sm"
          />
        </div>

        {/* Search */}
        <div className="relative">
          <Icon name="Search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search staff…"
            className="pl-7 pr-3 py-1 rounded-spa border border-border bg-surface font-body text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50 w-36"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
            >
              <Icon name="X" size={11} />
            </button>
          )}
        </div>
      </div>

      {/* ── Summary strip ── */}
      {!loading && data && (
        <div className="bg-surface border-b border-border px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-5 flex-wrap text-xs font-body text-text-secondary">
          <span>{fmtDate(data.startDate)} – {fmtDate(data.endDate)}</span>
          <span className="h-3 w-px bg-border" />
          {isAggregated && selectedStaff ? (
            <>
              <span className="font-body-medium text-text-primary">{selectedStaff.therapistName}</span>
              <span className="h-3 w-px bg-border" />
              <span className="text-success font-body-medium">{selectedStaff.present} present</span>
              <span className="text-error font-body-medium">{selectedStaff.absent} absent</span>
              <span className="text-warning font-body-medium">{selectedStaff.leave} leave</span>
              <span className="text-primary font-body-medium">{selectedStaff.halfDay} half-day</span>
              {selectedStaff.marked > 0 && (
                <span className="font-body-medium text-text-secondary">{selectedStaff.attendanceRate}% rate</span>
              )}
            </>
          ) : (
            <>
              <span>{staffRows.length} staff</span>
              <span className="h-3 w-px bg-border" />
              <span className="text-success font-body-medium">{totals.present} present</span>
              <span className="text-error font-body-medium">{totals.absent} absent</span>
              <span className="text-warning font-body-medium">{totals.leave} leave</span>
              <span className="text-primary font-body-medium">{totals.halfDay} half-day</span>
            </>
          )}
        </div>
      )}

      {/* ── Main content ── */}
      <main className="px-4 sm:px-6 lg:px-8 py-6">

        {loading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="animate-spin w-10 h-10 border-2 border-primary border-t-transparent rounded-full mb-4" />
            <p className="font-body text-sm text-text-secondary">Loading attendance…</p>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center gap-3 p-4 bg-error/5 border border-error/20 rounded-spa">
            <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
            <p className="font-body text-sm text-error">{error}</p>
            <button onClick={load} className="ml-auto font-body-medium text-sm text-error underline">Retry</button>
          </div>
        )}

        {!loading && !error && data && tooManyDays && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Icon name="CalendarRange" size={40} className="text-text-tertiary mb-4" />
            <p className="font-body text-text-secondary">
              The selected range spans {dates.length} days — too wide for the calendar grid.
            </p>
            <p className="font-body text-sm text-text-tertiary mt-1">
              Choose a period of 2 months or less to see the grid.
            </p>
          </div>
        )}

        {/* ── Calendar cards: monthly / quarterly / semi-annual / annual ── */}
        {!loading && !error && data && isAggregated && (
          <>
            {/* Staff picker */}
            <div ref={aggDropdownRef} className="relative mb-5" style={{ maxWidth: 280 }}>
              <div className="relative">
                <Icon name="User" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                <input
                  type="text"
                  value={aggSearchInput}
                  onChange={(e) => { setAggSearchInput(e.target.value); setAggDropdownOpen(true); }}
                  onFocus={() => setAggDropdownOpen(true)}
                  placeholder="Type staff name…"
                  className="w-full pl-8 pr-3 py-2 rounded-spa border border-border bg-surface font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              {aggDropdownOpen && aggFilteredStaff.length > 0 && (
                <div className="absolute z-dropdown top-full mt-1 w-full bg-surface border border-border rounded-spa shadow-spa-elevated max-h-52 overflow-y-auto">
                  {aggFilteredStaff.map((s) => (
                    <button
                      key={s.therapistId}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedStaffId(s.therapistId);
                        setAggSearchInput(s.therapistName);
                        setAggDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-background spa-transition-fast ${
                        s.therapistId === selectedStaff?.therapistId ? 'bg-primary/5' : ''
                      }`}
                    >
                      <span className="font-body text-sm text-text-primary flex-1">{s.therapistName}</span>
                      <span className="font-caption text-[10px] text-text-tertiary flex-shrink-0">
                        {s.isServiceStaff ? 'Service' : 'Support'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mb-5 flex-wrap">
              {[
                { label: 'Present',   bg: '#D1FAE5', fg: '#065F46' },
                { label: 'Absent',    bg: '#FEE2E2', fg: '#991B1B' },
                { label: 'Leave',     bg: '#FFEDD5', fg: '#9A3412' },
                { label: 'Half Day',  bg: '#DBEAFE', fg: '#1E40AF' },
              ].map((l) => (
                <span key={l.label} className="inline-flex items-center gap-1.5 font-body text-xs text-text-secondary">
                  <span className="inline-block w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: l.bg }} />
                  {l.label}
                </span>
              ))}
            </div>

            {staffRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Icon name="CalendarX" size={32} className="text-text-tertiary mx-auto mb-3" />
                <p className="font-body text-sm text-text-tertiary">No attendance recorded in this period.</p>
              </div>
            ) : (
              <div className={`grid gap-4 ${
                calendarMonths.length === 1  ? 'grid-cols-1 max-w-md mx-auto w-full' :
                calendarMonths.length <= 3   ? 'grid-cols-1 sm:grid-cols-3' :
                calendarMonths.length <= 6   ? 'grid-cols-2 sm:grid-cols-3' :
                                               'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
              }`}>
                {calendarMonths.map(({ year, month }) => (
                  <CalendarMonth
                    key={`${year}-${month}`}
                    year={year}
                    month={month}
                    attendanceByDate={selectedStaff ? (lookup[selectedStaff.therapistId] || {}) : {}}
                    today={today}
                    large={calendarMonths.length === 1}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Colored squares grid: daily / weekly ── */}
        {!loading && !error && data && !isAggregated && !tooManyDays && (
          <>
            {/* Color legend */}
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              {[
                { label: 'Present',   cls: 'bg-success' },
                { label: 'Absent',    cls: 'bg-error' },
                { label: 'Leave',     cls: 'bg-warning' },
                { label: 'Half Day',  cls: 'bg-primary/60' },
                { label: 'No record', cls: 'bg-border/50' },
              ].map((l) => (
                <span key={l.label} className="inline-flex items-center gap-1.5 font-body text-xs text-text-secondary">
                  <span className={`inline-block w-4 h-4 rounded-sm ${l.cls}`} />
                  {l.label}
                </span>
              ))}
            </div>

            {/* Grid */}
            <div className="bg-surface border border-border rounded-spa-lg overflow-hidden shadow-spa-resting">
              <div className="overflow-x-auto">
                <table className="border-collapse" style={{ minWidth: `${220 + dates.length * 44}px` }}>
                  <thead>
                    {/* Weekly navigation row */}
                    {mode === 'preset' && activePreset === 'weekly' && dates.length > 0 && (
                      <tr className="bg-background border-b border-border/50">
                        <td className="sticky left-0 z-10 bg-background border-r border-border min-w-[200px]" />
                        <td colSpan={dates.length} className="bg-background px-3 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              onClick={() => setWeekOffset((o) => o + 1)}
                              className="p-1 rounded-spa hover:bg-border/40 text-text-secondary hover:text-text-primary spa-transition-fast"
                              title="Previous week"
                            >
                              <Icon name="ChevronLeft" size={15} />
                            </button>
                            <span className="font-body text-xs font-medium text-text-primary whitespace-nowrap">
                              {fmtShort(range.startDate)} – {fmtShort(range.endDate)}
                            </span>
                            <button
                              onClick={() => setWeekOffset((o) => o - 1)}
                              disabled={weekOffset === 0}
                              className="p-1 rounded-spa hover:bg-border/40 text-text-secondary hover:text-text-primary spa-transition-fast disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Next week"
                            >
                              <Icon name="ChevronRight" size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr className="bg-background border-b border-border">
                      <th className="sticky left-0 z-10 bg-background px-5 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide whitespace-nowrap min-w-[200px] border-r border-border">
                        Staff member
                      </th>
                      {dates.map((iso) => {
                        const d = parseLocalDate(iso);
                        const dayIdx = d.getDay();
                        const isWeekend = dayIdx === 0 || dayIdx === 6;
                        return (
                          <th key={iso} className={`px-1 py-2 text-center min-w-[40px] ${isWeekend ? 'bg-background/60' : ''}`}>
                            <div className={`font-caption text-[10px] font-semibold uppercase leading-none ${isWeekend ? 'text-text-tertiary' : 'text-text-secondary'}`}>
                              {DAY_ABBR[dayIdx]}
                            </div>
                            <div className={`font-data text-sm font-semibold mt-0.5 ${isWeekend ? 'text-text-tertiary' : 'text-text-primary'}`}>
                              {d.getDate()}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {staffRows.length === 0 ? (
                      <tr>
                        <td colSpan={dates.length + 1} className="px-5 py-16 text-center">
                          <Icon name="CalendarX" size={32} className="text-text-tertiary mx-auto mb-3" />
                          <p className="font-body text-sm text-text-tertiary">
                            {totals.marked === 0
                              ? 'No attendance recorded in this period.'
                              : `No staff match "${searchQuery.trim()}".`}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      staffRows.map((s, rowIdx) => {
                        const byDate = lookup[s.therapistId] || {};
                        const isEven = rowIdx % 2 === 0;
                        const rowBg = isEven ? 'bg-surface' : 'bg-background/40';
                        return (
                          <tr key={s.therapistId} className={`border-b border-border last:border-b-0 ${rowBg}`}>
                            <td className={`sticky left-0 z-10 px-5 py-3 min-w-[200px] border-r border-border ${rowBg}`}>
                              <p className="font-body font-body-medium text-sm text-text-primary truncate max-w-[180px]" title={s.therapistName}>
                                {s.therapistName}
                              </p>
                              <p className="font-caption text-[10px] text-text-tertiary mt-0.5">
                                {s.isServiceStaff ? 'Service' : 'Support'}
                              </p>
                            </td>
                            {dates.map((iso) => {
                              const st = byDate[iso];
                              const cell = cellStyle(st);
                              const d = parseLocalDate(iso);
                              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                              return (
                                <td
                                  key={iso}
                                  className={`px-1 py-2.5 text-center ${isWeekend ? 'bg-background/20' : ''}`}
                                  title={`${s.therapistName} · ${iso} · ${cell.title}`}
                                >
                                  <span className={`inline-block w-7 h-7 rounded-sm ${cell.bg}`} />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default AttendanceCalendarPage;
