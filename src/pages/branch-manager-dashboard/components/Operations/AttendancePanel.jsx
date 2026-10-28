import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import TransferManagementModal from '../../../../components/ui/TransferManagementModal';
import RowBoundary from '../../../../components/ui/RowBoundary';
import TransferFitText from '../../../../components/ui/TransferFitText';
import TransferPill from '../../../../components/ui/TransferPill';
import { describeTransfer, toTransferInput, transferState } from '../../../../utils/transferText';
import { useAuth } from '../../../../contexts/AuthContext';
import FilterBar from '../../../../components/ui/FilterBar';
import { useIndustry } from '../../../../hooks/useIndustry';
import { useAutoRefresh } from '../../../../hooks/useAutoRefresh';
import {
  fetchAttendance,
  fetchAttendanceByTherapistIds,
  fetchAttendanceSummary,
  markAttendance,
  fetchPendingTransfers,
  fetchTherapistTransferStatus,
  fetchShiftsForRange,
  fetchBranchesByOrgId,
  fetchVisitingAttendanceToday,
  markVisitorAttendance,
} from '../../../../services/api';
import { workedAtNote, visitFromText } from '../../../../services/visitorAttendance';
import { useAvailabilityConflictGuard } from '../../../../hooks/useAvailabilityConflictGuard';
import { leaveChange, defaultHalfDayOff, validateHalfDay } from '../../../../services/availabilityConflicts';
import { hhmmToMinutes } from '../../../../services/availability';

function formatPrettyDate(d) {
  if (!d) return '—';
  // d is a YYYY-MM-DD string; parse as local to avoid TZ shift.
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

const ATTENDANCE_OPTIONS = [
  { value: '', label: 'Not Marked' },
  { value: 'Present', label: 'Present' },
  { value: 'Absent', label: 'Absent' },
  { value: 'Annual Leave', label: 'Annual Leave' },
  { value: 'Sick Leave', label: 'Sick Leave' },
  { value: 'Day Off', label: 'Day Off' },
  { value: '1st-Half Day', label: '1st Half Day' },
  { value: '2nd-Half Day', label: '2nd Half Day' },
];

// therapist_shifts_for_range row -> the shape the half-day helpers take (null when the person doesn't work that day).
const shiftShape = (r) => (!r || !r.works || !r.start_time ? null : {
  start: String(r.start_time).slice(0, 5),
  end: String(r.end_time) === '23:59:59' ? '23:59:59' : String(r.end_time).slice(0, 5),
  breaks: r.breaks || [],
});

const isHalfDay = (status) => status === '1st-Half Day' || status === '2nd-Half Day';
// Statuses that take the person out of (part of) the day: the "falls outside" list runs before these are saved.
const OFF_STATUSES = ['Absent', 'Annual Leave', 'Sick Leave', 'Day Off'];

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: '', label: 'Not Marked' },
  { value: 'Present', label: 'Present' },
  { value: 'Absent', label: 'Absent' },
  { value: 'Annual Leave', label: 'Annual Leave' },
  { value: 'Sick Leave', label: 'Sick Leave' },
  { value: 'Day Off', label: 'Day Off' },
  { value: '1st-Half Day', label: '1st Half Day' },
  { value: '2nd-Half Day', label: '2nd Half Day' },
];

const STAFF_TYPE_OPTIONS = [
  { value: 'all', label: 'All Staff' },
  { value: 'service', label: 'Service Staff' },
  { value: 'support', label: 'Support Staff' },
  { value: 'transferred', label: 'Transferred' },
];

function SummaryCard({ icon, iconBg, iconColor, label, value, highlight }) {
  return (
    <div className="bg-surface rounded-spa-lg border border-border p-4 flex items-center space-x-3">
      <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon name={icon} size={18} className={iconColor} />
      </div>
      <div>
        <p className={`font-heading font-heading-semibold text-lg ${highlight || 'text-text-primary'}`}>
          {value}
        </p>
        <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">{label}</p>
      </div>
    </div>
  );
}

const AttendancePanel = ({ branchId }) => {
  const today = new Date().toISOString().split('T')[0];
  const { staffLabel, locationLabel } = useIndustry();
  const { profile } = useAuth();
  // Same per-user 12h/24h display preference the calendar uses.
  const use24h = (() => { try { return localStorage.getItem(`bookspa_calendar_use24h_${profile?.org_id}_${profile?.id}`) === '1'; } catch { return false; } })();
  const { confirmConflicts, conflictModal } = useAvailabilityConflictGuard();
  const [shiftByTherapist, setShiftByTherapist] = useState({});   // that date's shift per person (therapist_shifts_for_range)

  const [selectedDate, setSelectedDate] = useState(today);
  // Deep link from the Therapists list ("Mark attendance"): ?view=attendance&therapist=<id> shows only that person, on today.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusTherapistId = searchParams.get('therapist');
  const clearFocusTherapist = () => { const next = new URLSearchParams(searchParams); next.delete('therapist'); setSearchParams(next, { replace: true }); };
  const [therapists, setTherapists] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dayLocked, setDayLocked] = useState(false);
  const [toast, setToast] = useState(null);

  // Transfer feature
  const [pendingByTherapist, setPendingByTherapist] = useState({});
  const [transferStatusByTherapist, setTransferStatusByTherapist] = useState({});
  const [transferTarget, setTransferTarget] = useState(null); // { therapistId, therapistName }

  // Track local edits per therapist: { [therapistId]: { status, checkInTime, checkOutTime, notes, dirty } }
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState({});

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [staffTypeFilter, setStaffTypeFilter] = useState('all');

  // Multi-selection for bulk marking
  const [selectedIds, setSelectedIds] = useState([]);

  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== 'all' || staffTypeFilter !== 'all';

  // An incoming transfer whose revert_at has already passed but the server-side cron
  // (apply_due_staff_reverts(), every 5 min) hasn't ticked yet — branch_id still points here in
  // the DB, but the staffer is due to leave. Hide them from this branch's own table immediately
  // rather than waiting out that window; they'll disappear from the DB-driven side (calendar,
  // origin's list, etc.) once the cron actually processes it.
  const isIncomingTransferOverdue = useCallback((therapistId) => {
    const status = transferStatusByTherapist[therapistId];
    return !!(
      status?.applied && !status?.reverted && status?.revertAt
      && status?.toBranchId === branchId
      && new Date(status.revertAt) <= new Date()
    );
  }, [transferStatusByTherapist, branchId]);

  const isTransferredTherapist = useCallback((therapistId) => {
    const status = transferStatusByTherapist[therapistId];
    const activeIncomingTransfer = status?.applied && !status?.reverted && status?.revertAt && status?.toBranchId === branchId;
    return !!pendingByTherapist[therapistId] || !!activeIncomingTransfer;
  }, [pendingByTherapist, transferStatusByTherapist, branchId]);

  const filteredTherapists = useMemo(() => {
    return therapists.filter((t) => {
      if (focusTherapistId) return t.therapistId === focusTherapistId;
      if (staffTypeFilter === 'transferred' && !isTransferredTherapist(t.therapistId)) return false;
      if (isIncomingTransferOverdue(t.therapistId)) return false;
      const matchesSearch = !searchQuery.trim()
        || (t.therapistName || '').toLowerCase().includes(searchQuery.toLowerCase().trim());
      const currentStatus = edits[t.therapistId]?.status ?? (t.status || '');
      const matchesStatus = statusFilter === 'all' || currentStatus === statusFilter;
      const matchesType = staffTypeFilter === 'all' || staffTypeFilter === 'transferred'
        || (staffTypeFilter === 'service' ? t.isServiceStaff : !t.isServiceStaff);
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [therapists, edits, searchQuery, statusFilter, staffTypeFilter, isIncomingTransferOverdue, isTransferredTherapist, focusTherapistId]);

  // Staff transferred (or being transferred) AWAY from this branch — both already-active
  // transfers (branch_id has moved, so they're absent from `therapists`) and scheduled-but-
  // not-yet-started ones (branch_id hasn't moved yet, but the transfer already exists). Both
  // show up here as soon as the transfer is created, each cancellable from this same list.
  const transferredOutBase = useMemo(() => {
    const active = Object.values(transferStatusByTherapist)
      .filter((s) => s.applied && !s.reverted && s.revertAt && s.fromBranchId === branchId && s.toBranchId !== branchId)
      .map((s) => ({ ...s, isPending: false }));
    const pending = Object.values(pendingByTherapist).map((p) => ({
      id: p.id,
      therapistId: p.therapistId,
      therapistName: p.therapistName,
      toBranch: p.toBranch,
      effectiveDate: p.effectiveDate,
      startTime: p.startTime,
      revertAt: p.revertAt,
      isPending: true,
    }));
    return [...active, ...pending];
  }, [transferStatusByTherapist, pendingByTherapist, branchId]);

  // Today's check-in/check-out for transferred-out staff — attendance is global per
  // (therapist_id, date), not branch-scoped, so it still exists even once they're off this
  // branch's own fetchAttendance() result.
  const [transferredAttendance, setTransferredAttendance] = useState({});

  // Visitors checked in HERE (V33c): today only; home owns the record, this branch's manager writes just the two times.
  const [branchNameById, setBranchNameById] = useState({});
  const [visitors, setVisitors] = useState([]);
  const [visitorEdits, setVisitorEdits] = useState({});
  const loadVisitors = useCallback(async () => {
    if (selectedDate !== today || !branchId || branchId === 'all') { setVisitors([]); return; }
    const { data } = await fetchVisitingAttendanceToday({ branchId });
    setVisitors(Object.values(data || {}));
  }, [selectedDate, today, branchId]);
  useEffect(() => { loadVisitors(); }, [loadVisitors]);
  useEffect(() => {
    if (!profile?.org_id) return;
    fetchBranchesByOrgId(profile.org_id).then(({ data }) => setBranchNameById(Object.fromEntries((data || []).map((b) => [b.id, b.name]))));
  }, [profile?.org_id]);
  const saveVisitor = async (v) => {
    const e = visitorEdits[v.therapistId] || {};
    const { error: err } = await markVisitorAttendance({
      therapistId: v.therapistId, branchId,
      checkInTime: e.checkInTime ?? null, checkOutTime: e.checkOutTime ?? null,
    });
    if (err) { showToast(err.message || 'Failed to save attendance.', 'error'); return; }
    setVisitorEdits((prev) => ({ ...prev, [v.therapistId]: {} }));
    showToast(`Attendance saved for ${v.therapistName}`);
    loadVisitors();
  };

  useEffect(() => {
    const ids = transferredOutBase.map((s) => s.therapistId);
    if (ids.length === 0) {
      setTransferredAttendance({});
      return;
    }
    let cancelled = false;
    fetchAttendanceByTherapistIds({ therapistIds: ids, date: selectedDate }).then(({ data }) => {
      if (!cancelled) setTransferredAttendance(data || {});
    });
    return () => { cancelled = true; };
  }, [transferredOutBase, selectedDate]);

  const transferredOutList = useMemo(
    () => transferredOutBase.map((s) => ({ ...s, attendance: transferredAttendance[s.therapistId] || null })),
    [transferredOutBase, transferredAttendance]
  );

  // Staff whose transfer has APPLIED are no longer on this branch's roster, but keep their place in the list (sorted with everyone).
  // Scheduled ones are still on the roster, so they already have their own row.
  const filteredTransferredOut = useMemo(() => {
    if (focusTherapistId || statusFilter !== 'all' || !['all', 'transferred'].includes(staffTypeFilter)) return [];
    // Drop the away row when the person already has a home row (one row per person).
    const homeIds = new Set(therapists.map((t) => t.therapistId));
    const active = transferredOutList.filter((s) => !s.isPending && !homeIds.has(s.therapistId));
    if (!searchQuery.trim()) return active;
    const q = searchQuery.toLowerCase().trim();
    return active.filter((s) => (s.therapistName || '').toLowerCase().includes(q));
  }, [transferredOutList, therapists, searchQuery, staffTypeFilter, statusFilter, focusTherapistId]);

  const transferredCount = useMemo(
    () => therapists.filter((t) => isTransferredTherapist(t.therapistId)).length + transferredOutList.filter((s) => !s.isPending).length,
    [therapists, isTransferredTherapist, transferredOutList]
  );

  const allFilteredSelected = filteredTherapists.length > 0
    && filteredTherapists.every((t) => selectedIds.includes(t.therapistId));

  const toggleSelect = (id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filteredTherapists.some((t) => t.therapistId === id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...filteredTherapists.map((t) => t.therapistId)])]);
    }
  };

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadPendingTransfers = useCallback(async () => {
    if (!branchId) return;
    const [{ data }, { data: statusMap }] = await Promise.all([
      fetchPendingTransfers(branchId),
      fetchTherapistTransferStatus(branchId),
    ]);
    const map = {};
    (data || []).forEach(t => { map[t.therapistId] = t; });
    setPendingByTherapist(map);
    setTransferStatusByTherapist(statusMap || {});
  }, [branchId]);

  // Only the very first load per date shows the full skeleton, resets the
  // row selection, and unconditionally overwrites `edits` — background
  // auto-refresh ticks (see useAutoRefresh below) instead: skip the skeleton,
  // leave the current selection alone, and preserve any row a manager has
  // mid-edit (dirty=true) instead of silently clobbering unsaved input.
  const hasLoadedRef = useRef(false);
  const loadedDateRef = useRef(null);
  const loadData = useCallback(async () => {
    if (!branchId) return;
    // A date switch is its own "first load" — don't treat it as a background
    // refresh of the previous date's (now-irrelevant) dirty edits/selection.
    if (loadedDateRef.current !== selectedDate) hasLoadedRef.current = false;
    const isFirstLoad = !hasLoadedRef.current;
    if (isFirstLoad) setLoading(true);
    setError(null);
    setDayLocked(false);

    const [attendanceResult, summaryResult, shiftsResult] = await Promise.all([
      fetchAttendance({ branchId, date: selectedDate }),
      fetchAttendanceSummary({ branchId, date: selectedDate }),
      fetchShiftsForRange({ branchId, startDate: selectedDate, endDate: selectedDate }),
      loadPendingTransfers(),
    ]);
    const shiftMap = Object.fromEntries((shiftsResult.data || []).map((r) => [r.therapist_id, r]));
    setShiftByTherapist(shiftMap);

    if (attendanceResult.error) {
      setError(attendanceResult.error.message || 'Failed to load attendance.');
      hasLoadedRef.current = true;
      setLoading(false);
      return;
    }

    const rows = attendanceResult.data || [];
    setTherapists(rows);
    if (isFirstLoad) setSelectedIds([]);

    setEdits(prev => {
      const next = {};
      for (const t of rows) {
        const existing = prev[t.therapistId];
        // Keep the manager's in-progress, unsaved edit instead of
        // overwriting it with the freshly fetched row on a background poll.
        if (!isFirstLoad && existing?.dirty) {
          next[t.therapistId] = existing;
        } else {
          next[t.therapistId] = {
            status: t.status || '',
            checkInTime: t.checkInTime || '',
            checkOutTime: t.checkOutTime || '',
            notes: t.notes || '',
            // a half day saved without exact times shows the times the split rule gives it
            offStart: t.offStart || (isHalfDay(t.status) ? defaultHalfDayOff({ status: t.status, shift: shiftShape(shiftMap[t.therapistId]) })?.start || '' : ''),
            offEnd: t.offEnd || (isHalfDay(t.status) ? defaultHalfDayOff({ status: t.status, shift: shiftShape(shiftMap[t.therapistId]) })?.end || '' : ''),
            dirty: false,
          };
        }
      }
      return next;
    });

    if (summaryResult.data) {
      setSummary(summaryResult.data);
    }

    hasLoadedRef.current = true;
    loadedDateRef.current = selectedDate;
    setLoading(false);
  }, [branchId, selectedDate, loadPendingTransfers]);

  useEffect(() => { loadData(); }, [loadData]);

  useAutoRefresh(loadData, { intervalMs: 60000 });

  // The shift of `therapistId` on the selected date, in the shape the half-day helpers take.
  const shiftOf = (therapistId) => shiftShape(shiftByTherapist[therapistId]);

  const handleFieldChange = (therapistId, field, value) => {
    setEdits(prev => {
      const next = { ...prev[therapistId], [field]: value, dirty: true };
      if (field === 'status') {
        // A half day starts from the existing split rule (the editable times are prefilled); other statuses carry no off times.
        if (isHalfDay(value)) {
          const d = defaultHalfDayOff({ status: value, shift: shiftOf(therapistId) });
          next.offStart = d?.start || '';
          next.offEnd = d?.end || '';
        } else {
          next.offStart = '';
          next.offEnd = '';
        }
      }
      return { ...prev, [therapistId]: next };
    });
  };

  // Inline error for a half day's off times (null = fine or not a half day).
  const halfDayError = (therapistId, edit = edits[therapistId]) => (
    edit && isHalfDay(edit.status) ? validateHalfDay({ offStart: edit.offStart, offEnd: edit.offEnd, shift: shiftOf(therapistId) }) : null
  );

  // The change to list bookings for: leave / half day on the selected date. Present / not marked strand nothing.
  const leaveCheckFor = (therapistId, status, edit = {}) => {
    const name = therapists.find(t => t.therapistId === therapistId)?.therapistName;
    if (OFF_STATUSES.includes(status)) return { therapistId, name, change: leaveChange({ from: selectedDate }) };
    if (isHalfDay(status) && edit.offStart && edit.offEnd) return { therapistId, name, change: leaveChange({ from: selectedDate, offStart: edit.offStart, offEnd: edit.offEnd }) };
    return null;
  };

  const confirmLeaves = (checks) => confirmConflicts({
    checks: checks.filter(Boolean),
    summary: `Marking ${selectedDate} as ${checks.length === 1 ? 'leave' : 'leave for these staff'}.`,
    titleFor: (n) => `${n} upcoming booking${n === 1 ? '' : 's'} ${n === 1 ? 'falls' : 'fall'} during this leave`,
    saveLabel: 'Save anyway',
  });

  const handleSave = async (therapistId) => {
    const edit = edits[therapistId];
    if (!edit || !edit.status) {
      showToast('Please select a status before saving.', 'error');
      return;
    }

    const hdErr = halfDayError(therapistId, edit);
    if (hdErr) { showToast(hdErr, 'error'); return; }

    setSaving(prev => ({ ...prev, [therapistId]: true }));

    if (!(await confirmLeaves([leaveCheckFor(therapistId, edit.status, edit)]))) {
      setSaving(prev => ({ ...prev, [therapistId]: false }));
      return;
    }

    const result = await markAttendance({
      therapistId,
      date: selectedDate,
      status: edit.status,
      checkInTime: edit.checkInTime || null,
      checkOutTime: edit.checkOutTime || null,
      notes: edit.notes || null,
      offStart: edit.offStart || null,
      offEnd: edit.offEnd || null,
    });

    setSaving(prev => ({ ...prev, [therapistId]: false }));

    if (result.error) {
      if (result.error.code === 'ATTENDANCE_DAY_LOCKED') {
        setDayLocked(true);
        showToast('Day is closed. Attendance cannot be modified.', 'error');
        return;
      }
      showToast(result.error.message || 'Failed to save attendance.', 'error');
      return;
    }

    // Mark as not dirty
    setEdits(prev => ({
      ...prev,
      [therapistId]: { ...prev[therapistId], dirty: false },
    }));

    showToast(`Attendance saved for ${therapists.find(t => t.therapistId === therapistId)?.therapistName || 'therapist'}`);

    // Refresh summary
    const summaryResult = await fetchAttendanceSummary({ branchId, date: selectedDate });
    if (summaryResult.data) {
      setSummary(summaryResult.data);
    }
  };

  const handleSaveAll = async () => {
    const dirtyIds = Object.entries(edits)
      .filter(([, e]) => e.dirty && e.status)
      .map(([id]) => id);

    if (dirtyIds.length === 0) {
      showToast('No changes to save.', 'error');
      return;
    }
    if (dirtyIds.some((id) => halfDayError(id))) {
      showToast('Fix the half-day times before saving.', 'error');
      return;
    }
    if (!(await confirmLeaves(dirtyIds.map((id) => leaveCheckFor(id, edits[id].status, edits[id]))))) return;

    let successCount = 0;
    let lockHit = false;

    for (const id of dirtyIds) {
      setSaving(prev => ({ ...prev, [id]: true }));

      const edit = edits[id];
      const result = await markAttendance({
        therapistId: id,
        date: selectedDate,
        status: edit.status,
        checkInTime: edit.checkInTime || null,
        checkOutTime: edit.checkOutTime || null,
        notes: edit.notes || null,
        offStart: edit.offStart || null,
        offEnd: edit.offEnd || null,
      });

      setSaving(prev => ({ ...prev, [id]: false }));

      if (result.error) {
        if (result.error.code === 'ATTENDANCE_DAY_LOCKED') {
          lockHit = true;
          setDayLocked(true);
          break;
        }
        continue;
      }

      setEdits(prev => ({
        ...prev,
        [id]: { ...prev[id], dirty: false },
      }));
      successCount++;
    }

    if (lockHit) {
      showToast('Day is closed. Attendance cannot be modified.', 'error');
    } else if (successCount > 0) {
      showToast(`Saved attendance for ${successCount} therapist${successCount !== 1 ? 's' : ''}`);
    }

    // Refresh summary
    const summaryResult = await fetchAttendanceSummary({ branchId, date: selectedDate });
    if (summaryResult.data) {
      setSummary(summaryResult.data);
    }
  };

  const handleBulkMark = async (status) => {
    if (selectedIds.length === 0) return;
    if (dayLocked) {
      showToast('Day is closed. Attendance cannot be modified.', 'error');
      return;
    }

    if (!(await confirmLeaves(selectedIds.map((id) => leaveCheckFor(id, status, {}))))) return;

    let successCount = 0;
    let lockHit = false;

    for (const id of selectedIds) {
      setSaving(prev => ({ ...prev, [id]: true }));

      const edit = edits[id] || {};
      const result = await markAttendance({
        therapistId: id,
        date: selectedDate,
        status,
        checkInTime: edit.checkInTime || null,
        checkOutTime: edit.checkOutTime || null,
        notes: edit.notes || null,
        offStart: null,
        offEnd: null,
      });

      setSaving(prev => ({ ...prev, [id]: false }));

      if (result.error) {
        if (result.error.code === 'ATTENDANCE_DAY_LOCKED') {
          lockHit = true;
          setDayLocked(true);
          break;
        }
        continue;
      }

      setEdits(prev => ({
        ...prev,
        [id]: { ...prev[id], status, dirty: false },
      }));
      successCount++;
    }

    if (lockHit) {
      showToast('Day is closed. Attendance cannot be modified.', 'error');
    } else if (successCount > 0) {
      showToast(`Marked ${successCount} therapist${successCount !== 1 ? 's' : ''} ${status}`);
    }

    setSelectedIds([]);

    const summaryResult = await fetchAttendanceSummary({ branchId, date: selectedDate });
    if (summaryResult.data) {
      setSummary(summaryResult.data);
    }
  };

  const openTransfer = (t) => {
    setTransferTarget({ therapistId: t.therapistId, therapistName: t.therapistName });
  };

  // One look for a transfer everywhere: pill + short sentence + chevron, opening the same side panel as the calendar.
  const renderTransferCell = (row, viewpoint, t) => {
    const open = row && ['upcoming', 'now', 'permanent-upcoming'].includes(transferState(toTransferInput(row)));
    if (!open) {
      return (
        <button
          type="button"
          onClick={() => openTransfer(t)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-spa border border-border bg-surface text-text-secondary hover:bg-background spa-transition-fast font-body font-body-medium text-xs whitespace-nowrap w-fit"
          title={`Transfer ${staffLabel.toLowerCase()}`}
        >
          <Icon name="ArrowRightLeft" size={14} />
          Transfer
        </button>
      );
    }
    const d = describeTransfer(toTransferInput(row), { viewpoint, use24h, short: true, day: selectedDate, labels: { branch: (locationLabel || 'branch').toLowerCase() } });
    return (
      <button
        type="button"
        onClick={() => openTransfer(t)}
        title={d.sentence}
        data-transfer-cell={d.state}
        className="flex items-center gap-2 h-8 w-full min-w-0 text-left hover:bg-background rounded-spa px-1 -mx-1 spa-transition-fast"
      >
        <TransferPill state={d.state}>{d.pill}</TransferPill>
        <TransferFitText candidates={d.state === 'now' ? d.afterPills : viewpoint === 'receiving' ? [d.sentence, d.short, d.tiny] : [d.full, d.short, d.tiny]} className="font-body text-xs text-text-secondary flex-1 min-w-0 overflow-hidden" />
        <Icon name="ChevronRight" size={14} className="text-text-tertiary flex-shrink-0" />
      </button>
    );
  };

  const dirtyCount = Object.values(edits).filter(e => e.dirty && e.status).length;

  // ── Loading state ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="bg-surface rounded-spa-lg border border-border p-4 animate-pulse">
              <div className="h-5 bg-background rounded w-12 mb-2" />
              <div className="h-3 bg-background rounded w-16" />
            </div>
          ))}
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-6 animate-pulse">
          <div className="h-4 bg-background rounded w-48 mb-4" />
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-10 bg-background rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────
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

  const renderAwayRow = (s) => (
    <div
                key={`away-${s.id}`}
                className="grid grid-cols-1 md:grid-cols-[1fr_140px_100px_100px_minmax(120px,1fr)_278px_56px] gap-3 px-5 py-3 items-center"
              >
                <button
                  type="button"
                  onClick={() => openTransfer({ therapistId: s.therapistId, therapistName: s.therapistName })}
                  className="flex items-center space-x-2 min-w-0 text-left"
                >
                  <span className="w-4 h-4 flex-shrink-0" />
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon name="User" size={14} className="text-primary" />
                  </div>
                  <span className="font-body font-body-medium text-sm text-text-primary truncate hover:underline">{s.therapistName}</span>
                </button>
                <span className="font-body text-xs text-text-tertiary">Away</span>
                {/* Attendance is global per day, so it still shows though they're no longer in this branch's roster */}
                <span className="font-data text-sm text-text-primary">{s.attendance?.checkInTime || '—'}</span>
                <span className="font-data text-sm text-text-primary">{s.attendance?.checkOutTime || '—'}</span>
                <span />
                {renderTransferCell(s.isPending ? { ...transferStatusByTherapist[s.therapistId], ...s, applied: false, reverted: false } : s, 'home', { therapistId: s.therapistId, therapistName: s.therapistName })}
                <span />
              </div>
  );

  const renderOwnRow = (t) => {
              const edit = edits[t.therapistId] || {};
              const isSaving = saving[t.therapistId];
              const isDirty = edit.dirty;
              const isDisabled = dayLocked || isSaving;

              return (
                <div
                  key={t.therapistId}
                  className={`grid grid-cols-1 md:grid-cols-[1fr_140px_100px_100px_minmax(120px,1fr)_278px_56px] gap-3 px-5 py-3 items-center ${
                    isDirty ? 'bg-primary/5' : ''
                  }`}
                >
                  {/* Therapist name */}
                  <div className="flex items-center space-x-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(t.therapistId)}
                      onChange={() => toggleSelect(t.therapistId)}
                      disabled={dayLocked}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer disabled:cursor-not-allowed flex-shrink-0"
                    />
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      'bg-primary/10'
                    }`}>
                      <Icon name="User" size={14} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-body font-body-medium text-sm text-text-primary truncate">{t.therapistName}</span>
                        {(() => {
                          // Late = checked in after that date's shift start (the same shift the calendar uses).
                          const sh = shiftOf(t.therapistId);
                          const late = sh && edit.checkInTime && !(t.workedAtBranchId && t.workedAtBranchId !== branchId) ? hhmmToMinutes(edit.checkInTime) - hhmmToMinutes(sh.start) : 0;
                          return late > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-caption font-caption-medium bg-warning/10 text-warning" title={`Shift starts ${sh.start}`}>
                              Late {late} min
                            </span>
                          ) : null;
                        })()}
                        {edit.status && (
                          <span className={`md:hidden inline-flex items-center px-2 py-0.5 rounded text-[10px] font-caption font-caption-medium ${
                            edit.status === 'Present' ? 'bg-success/10 text-success' :
                            edit.status === 'Absent' ? 'bg-error/10 text-error' :
                            (edit.status === 'Annual Leave' || edit.status === 'Sick Leave') ? 'bg-warning/10 text-warning' :
                            'bg-accent/10 text-accent'
                          }`}>
                            {edit.status}
                          </span>
                        )}
                      </div>
                      {(() => {
                        const note = workedAtNote({ row: t, homeBranchId: branchId, branchNameById });
                        return note ? <div className="font-body text-xs text-text-secondary">{note}</div> : null;
                      })()}
                    </div>
                  </div>

                  {/* Status dropdown */}
                  <CustomSelect
                    value={edit.status || ''}
                    onChange={(val) => handleFieldChange(t.therapistId, 'status', val)}
                    options={ATTENDANCE_OPTIONS}
                    disabled={isDisabled}
                    size="sm"
                    valueClassName={
                      edit.status === 'Present' ? 'text-success' :
                      edit.status === 'Absent' ? 'text-error' :
                      (edit.status === 'Annual Leave' || edit.status === 'Sick Leave') ? 'text-warning' :
                      edit.status === 'Day Off' ? 'text-accent' :
                      'text-text-tertiary'
                    }
                  />

                  {/* Check-in */}
                  <input
                    type="time"
                    value={edit.checkInTime || ''}
                    onChange={(e) => handleFieldChange(t.therapistId, 'checkInTime', e.target.value)}
                    disabled={isDisabled}
                    className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  />

                  {/* Check-out */}
                  <input
                    type="time"
                    value={edit.checkOutTime || ''}
                    onChange={(e) => handleFieldChange(t.therapistId, 'checkOutTime', e.target.value)}
                    disabled={isDisabled}
                    className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  />

                  {/* Notes */}
                  <input
                    type="text"
                    placeholder="Optional notes..."
                    value={edit.notes || ''}
                    onChange={(e) => handleFieldChange(t.therapistId, 'notes', e.target.value)}
                    disabled={isDisabled}
                    className="px-2 py-1.5 rounded-spa border border-border bg-surface font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  />

                  {/* Transfer: the button, or the pill + short sentence when one exists */}
                  {renderTransferCell(transferStatusByTherapist[t.therapistId], transferStatusByTherapist[t.therapistId]?.toBranchId === branchId ? 'receiving' : 'home', t)}

                  {/* Actions */}
                  <div className="flex justify-center items-center gap-1.5">
                    <button
                      onClick={() => handleSave(t.therapistId)}
                      disabled={isDisabled || !isDirty || !!halfDayError(t.therapistId, edit)}
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-spa spa-transition-fast ${
                        isDirty && !isDisabled && !halfDayError(t.therapistId, edit)
                          ? 'bg-primary text-white hover:bg-primary/90'
                          : 'bg-background text-text-tertiary cursor-not-allowed'
                      }`}
                      title={halfDayError(t.therapistId, edit) ? 'Fix the half-day times first' : isDirty ? 'Save' : 'No changes'}
                    >
                      {isSaving ? (
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      ) : (
                        <Icon name="Check" size={16} />
                      )}
                    </button>
                  </div>

                  {/* Half day: editable off times, prefilled by the split rule, validated inside that day's shift */}
                  {isHalfDay(edit.status) && (
                    <div className="md:col-span-full flex items-center flex-wrap gap-2 pl-9" data-testid={`half-day-${t.therapistId}`}>
                      <span className="font-caption text-xs text-text-secondary">Off</span>
                      <input
                        type="time"
                        aria-label="Off from"
                        value={edit.offStart || ''}
                        onChange={(e) => handleFieldChange(t.therapistId, 'offStart', e.target.value)}
                        disabled={isDisabled}
                        className={`px-2 py-1 rounded-spa border bg-surface font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 ${halfDayError(t.therapistId, edit) ? 'border-error' : 'border-border'}`}
                      />
                      <span className="font-caption text-xs text-text-secondary">to</span>
                      <input
                        type="time"
                        aria-label="Off until"
                        value={edit.offEnd || ''}
                        onChange={(e) => handleFieldChange(t.therapistId, 'offEnd', e.target.value)}
                        disabled={isDisabled}
                        className={`px-2 py-1 rounded-spa border bg-surface font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 ${halfDayError(t.therapistId, edit) ? 'border-error' : 'border-border'}`}
                      />
                      {shiftOf(t.therapistId) && (
                        <span className="font-caption text-xs text-text-tertiary">Shift {shiftOf(t.therapistId).start}–{shiftOf(t.therapistId).end === '23:59:59' ? '24:00' : shiftOf(t.therapistId).end}</span>
                      )}
                      {halfDayError(t.therapistId, edit) && (
                        <span role="alert" className="font-caption text-xs text-error">{halfDayError(t.therapistId, edit)}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            };

  // One list, sorted with everyone: on-roster staff and staff whose transfer has applied (away).
  const orderedRows = [
    ...filteredTherapists.map((t) => ({ t, name: t.therapistName || '' })),
    ...filteredTransferredOut.map((s) => ({ s, away: true, name: s.therapistName || '' })),
  ].sort((x, y) => x.name.localeCompare(y.name));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-heading font-heading-semibold text-xl text-text-primary">Staff Attendance</h2>
          <p className="font-body text-sm text-text-secondary">Mark daily attendance for active staff.</p>
        </div>
        <div className="flex items-center space-x-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-spa border border-border bg-surface font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {dirtyCount > 0 && !dayLocked && (
            <button
              onClick={handleSaveAll}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-primary text-white rounded-spa font-body font-body-medium text-sm hover:bg-primary/90 spa-transition-fast"
            >
              <Icon name="Save" size={16} />
              <span>Save All ({dirtyCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Day Locked Banner */}
      {dayLocked && (
        <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
          <Icon name="Lock" size={18} className="text-error flex-shrink-0" />
          <p className="font-body font-body-medium text-sm text-error">
            Day is closed. Attendance cannot be modified.
          </p>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard
            icon="UserCheck"
            iconBg="bg-success/10"
            iconColor="text-success"
            label="Present"
            value={summary.presentCount}
          />
          <SummaryCard
            icon="UserX"
            iconBg="bg-error/10"
            iconColor="text-error"
            label="Absent"
            value={summary.absentCount}
          />
          <SummaryCard
            icon="CalendarOff"
            iconBg="bg-warning/10"
            iconColor="text-warning"
            label="Leave / Day Off"
            value={summary.leaveCount}
          />
          <SummaryCard
            icon="ArrowRightLeft"
            iconBg="bg-[#B45309]/10"
            iconColor="text-[#B45309]"
            label="Transferred"
            value={transferredCount}
          />
          <SummaryCard
            icon="Percent"
            iconBg="bg-primary/10"
            iconColor="text-primary"
            label="Attendance Rate"
            value={`${summary.attendanceRate}%`}
            highlight={summary.attendanceRate >= 80 ? 'text-success' : summary.attendanceRate >= 50 ? 'text-warning' : 'text-error'}
          />
        </div>
      )}

      {/* Search & Status Filter */}
      {focusTherapistId && (
        <div className="flex items-center gap-2 px-1 pb-2 text-[13px]" data-attendance-focus>
          <span className="text-text-secondary">Showing only <b className="text-text-primary font-medium">{therapists.find((t) => t.therapistId === focusTherapistId)?.therapistName || 'one person'}</b></span>
          <button type="button" onClick={clearFocusTherapist} className="text-primary hover:underline">Show everyone</button>
        </div>
      )}
      <FilterBar
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search staff...',
        }}
        filters={[
          {
            value: staffTypeFilter,
            onChange: setStaffTypeFilter,
            options: STAFF_TYPE_OPTIONS,
          },
          {
            value: statusFilter,
            onChange: setStatusFilter,
            options: STATUS_FILTER_OPTIONS,
          },
        ]}
        resultCount={hasActiveFilters ? {
          filtered: filteredTherapists.length + filteredTransferredOut.length,
          total: therapists.length + transferredOutList.filter((s) => !s.isPending).length,
        } : undefined}
        hasActiveFilters={hasActiveFilters}
        onClear={() => { setSearchQuery(''); setStatusFilter('all'); setStaffTypeFilter('all'); }}
      />

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && !dayLocked && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-primary/5 border border-primary/20 rounded-spa-lg">
          <span className="font-body font-body-medium text-sm text-text-primary">
            {selectedIds.length} selected
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleBulkMark('Present')}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-success text-white rounded-spa font-body font-body-medium text-sm hover:bg-success/90 spa-transition-fast"
            >
              <Icon name="UserCheck" size={15} />
              <span>Mark Present</span>
            </button>
            <button
              onClick={() => handleBulkMark('Absent')}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-error text-white rounded-spa font-body font-body-medium text-sm hover:bg-error/90 spa-transition-fast"
            >
              <Icon name="UserX" size={15} />
              <span>Mark Absent</span>
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-text-secondary rounded-spa font-body font-body-medium text-sm hover:bg-background spa-transition-fast"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Therapist Table */}
      <div className="bg-surface rounded-spa-lg border border-border">
        {/* Table header */}
        <div className="hidden md:grid md:grid-cols-[1fr_140px_100px_100px_minmax(120px,1fr)_278px_56px] gap-3 px-5 py-3 bg-background/50 border-b border-border rounded-t-spa-lg">
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide flex items-center gap-2">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              disabled={dayLocked || filteredTherapists.length === 0}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer disabled:cursor-not-allowed"
              title="Select all"
            />
            Staff
          </span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Status</span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Check-in</span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Check-out</span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Notes</span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Transfer</span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide text-center">Action</span>
        </div>

        {therapists.length === 0 && transferredOutList.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="Users" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No active staff found for this branch.</p>
          </div>
        ) : filteredTherapists.length === 0 && filteredTransferredOut.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="SearchX" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No staff match the current filters.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {orderedRows.map((r) => (
              <RowBoundary key={r.away ? `away-${r.s.id}` : r.t.therapistId}>{r.away ? renderAwayRow(r.s) : renderOwnRow(r.t)}</RowBoundary>
            ))}
          </div>
        )}
      </div>

      {visitors.length > 0 && (
        <div className="bg-surface rounded-spa-lg border border-border">
          <div className="px-4 py-3 border-b border-border font-body font-body-medium text-sm text-text-primary">Visiting</div>
          <div className="divide-y divide-border">
            {visitors.map((v) => {
              const e = visitorEdits[v.therapistId] || {};
              const set = (k, val) => setVisitorEdits((prev) => ({ ...prev, [v.therapistId]: { ...prev[v.therapistId], [k]: val } }));
              return (
                <div key={v.therapistId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="font-body font-body-medium text-sm text-text-primary flex-1 min-w-[8rem]">
                    {v.therapistName}
                    {v.windowFrom && new Date(v.windowFrom) > new Date() && <span className="ml-2 font-body text-xs text-text-secondary">{visitFromText(v.windowFrom)}</span>}
                  </span>
                  <input type="time" value={e.checkInTime ?? v.checkInTime ?? ''} onChange={(ev) => set('checkInTime', ev.target.value)} disabled={dayLocked}
                    className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data text-sm text-text-primary" />
                  <input type="time" value={e.checkOutTime ?? v.checkOutTime ?? ''} onChange={(ev) => set('checkOutTime', ev.target.value)} disabled={dayLocked}
                    className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data text-sm text-text-primary" />
                  <button onClick={() => saveVisitor(v)} disabled={dayLocked || (e.checkInTime == null && e.checkOutTime == null)}
                    className="px-3 py-1.5 rounded-spa bg-primary text-white font-body text-sm disabled:opacity-50">Save</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {conflictModal}

      {/* Transfer Modal */}
      {transferTarget && (
        <TransferManagementModal
          variant="panel"
          therapistId={transferTarget.therapistId}
          therapistName={transferTarget.therapistName}
          currentBranchId={branchId}
          defaultStartDate={selectedDate}
          onClose={() => setTransferTarget(null)}
          onSuccess={(message) => {
            setTransferTarget(null);
            if (message) showToast(message);
            loadData();
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2 ${
          toast.type === 'error' ? 'bg-error text-white' : 'bg-success text-white'
        }`}>
          <Icon name={toast.type === 'error' ? 'AlertCircle' : 'CheckCircle'} size={16} />
          <span className="font-body font-body-medium text-sm">{toast.msg}</span>
        </div>
      )}
    </div>
  );
};

export default AttendancePanel;
