import React, { useState, useEffect } from 'react';
import Icon from '../AppIcon';
import {
  PanelShell, FormBody, Field, TextInput, NumberInput, SelectField, Segmented, TabBar, DateField, TimeField, InlineError, InfoRows,
} from './PanelFormKit';
import { computeRevertDate as computeRevertDateUtil, DURATION_UNIT_OPTIONS as UNIT_OPTIONS, formatRevert, toYmd, toHm, validateExtension } from '../../utils/transferPreview';
import { friendlyError } from '../../utils/friendlyError';
import { useIndustry } from '../../hooks/useIndustry';
import TransferHoursWarning from './TransferHoursWarning';
import { useAuth } from '../../contexts/AuthContext';
import TransferPill from './TransferPill';
import { canAct } from '../../utils/transferPermissions';
import { describeTransfer, toTransferInput, transferWindowLine, transferDurationText } from '../../utils/transferText';
import { useAvailabilityConflictGuard } from '../../hooks/useAvailabilityConflictGuard';
import { transferChange } from '../../services/availabilityConflicts';
import {
  transferTherapist,
  extendStaffTransfer,
  revertStaffTransferNow,
  rescheduleStaffTransferReturn,
  fetchAllBranches,
  fetchTherapistTransferStatus,
  cancelScheduledTransfer,
} from '../../services/api';

function formatPrettyDate(d) {
  if (!d) return '—';
  // d is a YYYY-MM-DD string; parse as local to avoid TZ shift.
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Nepal-local 'YYYY-MM-DD' for capping a date input to "today" — new Date().toISOString()
// is UTC and lands on the previous calendar day between 00:00-05:45 Nepal time (UTC+5:45),
// which would wrongly block picking the real local "today" during that window.
function toLocalYMD(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Standalone transfer-management modal: create a new transfer, or — when this therapist
// already has an active/recently-completed one for this branch — extend it, reschedule/mark
// their return, or (origin branch) cancel it outright. Extracted out of AttendancePanel.jsx so
// it can be reused from other call sites (e.g. the Calendar) without duplicating this logic;
// unlike AttendancePanel (which precomputes a branch-wide transferStatusByTherapist map), this
// component fetches this one therapist's current transfer status itself on mount, so callers
// only need to hand it a therapist + branch.
const TransferManagementModal = ({ variant = 'modal', therapistId, therapistName, currentBranchId, defaultStartDate, guardRef, onClose, onSuccess, onDraftChange, use24h = false }) => {
  const { staffLabel, locationLabel } = useIndustry();
  const { profile } = useAuth();
  const role = profile?.role;
  const can = (action, row) => canAct(action, { role, side: row.toBranchId === currentBranchId ? 'receiving' : 'home' });
  const { confirmConflicts, conflictModal } = useAvailabilityConflictGuard();
  const today = new Date().toISOString().split('T')[0];

  const [loadingStatus, setLoadingStatus] = useState(true);
  const [activeTransfer, setActiveTransfer] = useState(null);
  const [completedTransfer, setCompletedTransfer] = useState(null);
  const [scheduledTransfer, setScheduledTransfer] = useState(null); // upcoming (not yet applied)
  const [editingScheduled, setEditingScheduled] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancellingScheduled, setCancellingScheduled] = useState(false);
  const [scheduledError, setScheduledError] = useState(null);

  const [orgBranches, setOrgBranches] = useState([]);
  const [transferMode, setTransferMode] = useState('temporary'); // 'temporary' | 'permanent'
  const [transferToBranch, setTransferToBranch] = useState('');
  const [transferStartDate, setTransferStartDate] = useState(defaultStartDate || today);
  const [transferStartTime, setTransferStartTime] = useState('');
  const [transferDurationUnit, setTransferDurationUnit] = useState('');
  const [transferDurationValue, setTransferDurationValue] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferError, setTransferError] = useState(null);
  const [transferring, setTransferring] = useState(false);

  const [extendDurationUnit, setExtendDurationUnit] = useState('');
  const [extendDurationValue, setExtendDurationValue] = useState('');
  const [extendError, setExtendError] = useState(null);
  const [extending, setExtending] = useState(false);

  const [revertError, setRevertError] = useState(null);
  const [reverting, setReverting] = useState(false);
  const [useCustomReturnTime, setUseCustomReturnTime] = useState(false);
  const [customReturnDate, setCustomReturnDate] = useState('');
  const [customReturnTime, setCustomReturnTime] = useState('');

  const [cancellingActive, setCancellingActive] = useState(false);
  const [cancelActiveError, setCancelActiveError] = useState(null);

  // Origin branch's view of an active transfer offers two distinct actions — 'cancel' (undo
  // it, right now or at a specific past moment) vs 'edit' (push the return date/time out,
  // still in the future) — instead of burying the edit path inside a plain checkbox under a
  // modal titled "Cancel Transfer" the whole time.
  const [originAction, setOriginAction] = useState('cancel');
  const [editReturnDate, setEditReturnDate] = useState('');
  const [editReturnTime, setEditReturnTime] = useState('');
  const [editError, setEditError] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetchAllBranches().then(({ data }) => setOrgBranches(data || []));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingStatus(true);
    fetchTherapistTransferStatus(currentBranchId).then(({ data }) => {
      if (cancelled) return;
      const latest = (data && data[therapistId]) || null;
      const active = latest && latest.applied && !latest.reverted && latest.revertAt
        && (latest.toBranchId === currentBranchId || latest.fromBranchId === currentBranchId)
        ? latest
        : null;
      const completed = !active && latest && latest.reverted && latest.fromBranchId === currentBranchId
        ? latest
        : null;
      const scheduled = !active && latest && !latest.applied && !latest.reverted
        && (latest.toBranchId === currentBranchId || latest.fromBranchId === currentBranchId)
        ? latest
        : null;
      setActiveTransfer(active);
      setCompletedTransfer(completed);
      setScheduledTransfer(scheduled);
      setLoadingStatus(false);
    });
    return () => { cancelled = true; };
  }, [therapistId, currentBranchId]);

  // Whole number of 1+, and the new return at most a year ahead (client-side: the RPC has no ceiling).
  const extendValidationError = activeTransfer ? validateExtension({ value: extendDurationValue, unit: extendDurationUnit, currentRevertAt: activeTransfer.revertAt }) : null;
  const isExtendFormComplete = !!extendDurationUnit && !!extendDurationValue && Number(extendDurationValue) > 0 && !extendValidationError;

  const handleExtendTransfer = async () => {
    if (!isExtendFormComplete) {
      setExtendError('Enter a valid extra duration.');
      return;
    }
    setExtending(true);
    setExtendError(null);

    const result = await extendStaffTransfer({
      transferId: activeTransfer.id,
      additionalValue: Number(extendDurationValue),
      additionalUnit: extendDurationUnit,
    });

    if (result.error) {
      setExtendError(friendlyError(result.error, 'Failed to extend transfer.'));
      setExtending(false);
      return;
    }

    setExtending(false);
    onSuccess(`Extended ${therapistName}'s transfer — now returns ${new Date(result.data.revertAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}.`);
  };

  // One control for changing an active transfer's return: pick any date/time — a moment already
  // past means "they came back then" (revertStaffTransferNow), a future moment means "reschedule
  // their return to then" (rescheduleStaffTransferReturn). Works from either branch's view.
  const handleUpdateReturnTime = async () => {
    if (!customReturnDate || !customReturnTime) {
      setRevertError('Enter a date and time.');
      return;
    }
    const picked = new Date(`${customReturnDate}T${customReturnTime}`);
    if (Number.isNaN(picked.getTime())) {
      setRevertError('Enter a valid date and time.');
      return;
    }

    setReverting(true);
    setRevertError(null);

    const isFuture = picked > new Date();
    const result = isFuture
      ? await rescheduleStaffTransferReturn({ transferId: activeTransfer.id, newRevertAt: picked })
      : await revertStaffTransferNow({ transferId: activeTransfer.id, revertedAt: picked });

    if (result.error) {
      const prefix = isFuture ? /^reschedule_staff_transfer_return:\s*/ : /^revert_staff_transfer_now:\s*/;
      setRevertError(result.error.message?.replace(prefix, '') || 'Failed to update return time.');
      setReverting(false);
      return;
    }

    setReverting(false);
    onSuccess(isFuture
      ? `${therapistName}'s return rescheduled to ${picked.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}.`
      : `${therapistName} is back — now bookable at ${activeTransfer.fromBranch}.`);
  };

  // Origin branch's Cancel-mode "they already returned at a specific past time" — unlike the
  // shared handleUpdateReturnTime (which dual-routes future picks to a reschedule, still used
  // by the destination-branch ACTIVE view below), this call site's whole premise is "this
  // already happened," so a future pick here is a mistake, not an alternate action — route it
  // to an error pointing at Edit Transfer instead of silently rescheduling behind a button
  // that says "Mark Returned Early".
  const handleMarkReturnedAt = async () => {
    if (!customReturnDate || !customReturnTime) {
      setRevertError('Enter a date and time.');
      return;
    }
    const picked = new Date(`${customReturnDate}T${customReturnTime}`);
    if (Number.isNaN(picked.getTime())) {
      setRevertError('Enter a valid date and time.');
      return;
    }
    if (picked > new Date()) {
      setRevertError('That time is in the future — use Edit Transfer to reschedule the return instead.');
      return;
    }

    setReverting(true);
    setRevertError(null);

    const result = await revertStaffTransferNow({ transferId: activeTransfer.id, revertedAt: picked });
    if (result.error) {
      setRevertError(result.error.message?.replace(/^revert_staff_transfer_now:\s*/, '') || 'Failed to update return time.');
      setReverting(false);
      return;
    }

    setReverting(false);
    onSuccess(`${therapistName} is back — now bookable at ${activeTransfer.fromBranch}.`);
  };

  // Origin branch editing an active transfer's return date/time — always a future moment
  // (server-enforced by reschedule_staff_transfer_return); a past moment is "cancel" territory,
  // handled by the separate Cancel Transfer action instead.
  const handleEditReturnTime = async () => {
    if (!editReturnDate || !editReturnTime) {
      setEditError('Enter a date and time.');
      return;
    }
    const picked = new Date(`${editReturnDate}T${editReturnTime}`);
    if (Number.isNaN(picked.getTime())) {
      setEditError('Enter a valid date and time.');
      return;
    }
    if (picked <= new Date()) {
      setEditError('New return time must be in the future — for a return that already happened, use Cancel Transfer instead.');
      return;
    }

    setEditing(true);
    setEditError(null);

    const result = await rescheduleStaffTransferReturn({ transferId: activeTransfer.id, newRevertAt: picked });
    if (result.error) {
      setEditError(result.error.message?.replace(/^reschedule_staff_transfer_return:\s*/, '') || 'Failed to update return time.');
      setEditing(false);
      return;
    }

    setEditing(false);
    onSuccess(`${therapistName}'s return rescheduled to ${picked.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}.`);
  };

  // Origin branch cancelling an active transfer they initiated — one click, right now. If the
  // therapist is still booked at the destination branch, revert_staff_transfer_now() (server)
  // blocks it and explains the conflicting booking's end time; the destination branch's manager
  // then has to mark them returned once that booking finishes.
  const handleCancelTransferNow = async () => {
    setCancellingActive(true);
    setCancelActiveError(null);

    const result = await revertStaffTransferNow({
      transferId: activeTransfer.id,
      revertedAt: null,
    });

    if (result.error) {
      setCancelActiveError(result.error.message?.replace(/^revert_staff_transfer_now:\s*/, '') || 'Failed to cancel transfer.');
      setCancellingActive(false);
      return;
    }

    setCancellingActive(false);
    onSuccess(`${therapistName}'s transfer cancelled — back at this branch now.`);
  };

  const isPermanentTransfer = transferMode === 'permanent';

  const isTransferFormComplete = isPermanentTransfer
    ? !!transferToBranch && !!transferStartDate
    : !!transferToBranch &&
      !!transferStartDate &&
      !!transferStartTime &&
      !!transferDurationUnit &&
      !!transferDurationValue &&
      Number(transferDurationValue) > 0;

  const handleTransfer = async () => {
    if (!transferToBranch) {
      setTransferError('Select a destination branch.');
      return;
    }
    if (!transferStartDate) {
      setTransferError('Select a start date.');
      return;
    }
    if (!isPermanentTransfer) {
      if (!transferStartTime) {
        setTransferError('Select a start time.');
        return;
      }
      if (!transferDurationUnit) {
        setTransferError('Select a duration unit.');
        return;
      }
      if (!transferDurationValue || Number(transferDurationValue) <= 0) {
        setTransferError('Enter a valid duration.');
        return;
      }
    }

    setTransferring(true);
    setTransferError(null);

    // Bookings still at this branch inside the window are listed first (kept either way).
    const proceed = await confirmConflicts({
      therapistId,
      change: transferChange({
        fromTs: `${transferStartDate}T${isPermanentTransfer ? '00:00' : transferStartTime}:00+05:45`,
        toTs: revertDateObj ? `${toYmd(revertDateObj)}T${toHm(revertDateObj)}:00+05:45` : null,
        toBranchId: transferToBranch,
      }),
      summary: `Moving ${therapistName} to another branch from ${transferStartDate}${isPermanentTransfer ? '' : ` ${transferStartTime}`}.`,
      titleFor: (n) => `${n} upcoming booking${n === 1 ? '' : 's'} at this branch while away`,
      saveLabel: 'Transfer anyway',
    });
    if (!proceed) { setTransferring(false); return; }

    const isFuture = transferStartDate > today;
    if (editingScheduled && scheduledTransfer) {
      const cancelled = await cancelScheduledTransfer(scheduledTransfer.id);
      if (cancelled.error) {
        setTransferError(cancelled.error.message || 'Could not replace the scheduled transfer.');
        setTransferring(false);
        return;
      }
    }
    const result = await transferTherapist({
      therapistId,
      toBranchId: transferToBranch,
      permanent: isPermanentTransfer,
      startTime: isPermanentTransfer ? null : transferStartTime,
      durationValue: isPermanentTransfer ? null : Number(transferDurationValue),
      durationUnit: isPermanentTransfer ? null : transferDurationUnit,
      note: transferNote.trim() || null,
      effectiveDate: transferStartDate,
    });

    if (result.error) {
      setTransferError(result.error.message || 'Transfer failed.');
      setTransferring(false);
      return;
    }

    const revertPreview = isPermanentTransfer
      ? null
      : computeRevertPreview(transferStartDate, transferStartTime, transferDurationValue, transferDurationUnit);
    setTransferring(false);
    onSuccess(
      isFuture
        ? `Transfer scheduled for ${therapistName} on ${formatPrettyDate(transferStartDate)}${revertPreview ? `, returns around ${revertPreview}` : ''}.`
        : `${therapistName} transferred${revertPreview ? `, returns around ${revertPreview}` : isPermanentTransfer ? ' permanently.' : '.'}`
    );
  };

  const isOriginCancelView = !!(
    activeTransfer
    && activeTransfer.fromBranchId === currentBranchId
    && activeTransfer.toBranchId !== currentBranchId
  );

  const busy = transferring || extending || reverting || cancellingActive || editing;
  const fmtDT = (v) => formatRevert(new Date(v));
  const todayLocal = toLocalYMD(new Date());
  const nowHm = toHm(new Date());
  const staff = (staffLabel || 'Therapist');

  // Live shading preview of the transfer window (create view only).
  const revertDateObj = isPermanentTransfer ? null : computeRevertDateUtil(transferStartDate, transferStartTime, transferDurationValue, transferDurationUnit);
  const showCreate = !loadingStatus && !activeTransfer && (!scheduledTransfer || editingScheduled);
  useEffect(() => {
    if (!showCreate) { onDraftChange?.(null); return; }
    onDraftChange?.({
      kind: 'transfer', therapistId, date: transferStartDate, startTime: isPermanentTransfer ? '00:00' : transferStartTime,
      endDate: revertDateObj ? toYmd(revertDateObj) : null, endTime: revertDateObj ? toHm(revertDateObj) : null,
      permanent: isPermanentTransfer, therapistName,
    });
  }, [showCreate, therapistId, transferStartDate, transferStartTime, isPermanentTransfer, revertDateObj && revertDateObj.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDraftChange?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const viewpointOf = (row) => (row.toBranchId === currentBranchId ? 'receiving' : 'home');
  // Pill + one sentence at the top of every view of a real transfer (same helper as the calendar, Attendance, profile).
  const summaryFor = (row) => {
    if (!row) return null;
    const d = describeTransfer(toTransferInput(row), { viewpoint: viewpointOf(row), use24h, labels: { branch: (locationLabel || 'branch').toLowerCase() } });
    return (
      <div className="flex flex-col gap-2" data-transfer-summary>
        <div><TransferPill state={d.state}>{d.pill}</TransferPill></div>
        <p className={`rounded-spa px-3 py-2 font-body text-[13px] text-text-primary ${d.state === 'now' ? 'bg-primary/5 border border-primary/10' : 'bg-gray-100'}`}>{d.sentence}</p>
      </div>
    );
  };

  // Rows under the sentence: type, from -> to, window, who set it and when, note.
  const infoRowsFor = (row) => {
    const input = toTransferInput(row);
    const dur = !row.isPermanent ? transferDurationText(input) : '';
    const hours = dur ? ` · ${dur}` : '';
    const setAt = row.transferredAt ? new Date(row.transferredAt).toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: !use24h }).replace(/,/g, '').replace(/\s([ap]m)$/i, '$1') : null;
    return [
      ['Type', row.isPermanent ? 'Permanent' : `Temporary${hours}`],
      ['From → to', `${row.fromBranch} → ${row.toBranch}`],
      ['Window', transferWindowLine({ ...input, fromBranch: null }, { use24h }).replace(/ · back at .*$/, '').replace(/^(\w+ \d+ \w+) /, '$1, ') || '—'],
      row.transferredByName || setAt ? ['Set by', [row.transferredByName, setAt].filter(Boolean).join(' · ')] : null,
      row.note ? ['Note', row.note] : null,
    ];
  };

  const startEditScheduled = () => {
    const r = scheduledTransfer;
    setEditingScheduled(true);
    setConfirmingCancel(false);
    setTransferMode(r.isPermanent ? 'permanent' : 'temporary');
    setTransferToBranch(r.toBranchId || '');
    setTransferStartDate(r.effectiveDate || today);
    setTransferStartTime(r.startTime ? r.startTime.slice(0, 5) : '');
    setTransferDurationUnit(r.durationUnit || '');
    setTransferDurationValue(r.durationValue ? String(r.durationValue) : '');
    setTransferNote(r.note || '');
  };

  const handleCancelScheduled = async () => {
    setCancellingScheduled(true);
    setScheduledError(null);
    const result = await cancelScheduledTransfer(scheduledTransfer.id);
    if (result.error) {
      setScheduledError(friendlyError(result.error, 'Failed to cancel transfer.'));
      setCancellingScheduled(false);
      return;
    }
    setCancellingScheduled(false);
    onSuccess(`${therapistName}'s scheduled transfer cancelled.`);
  };

  if (loadingStatus) {
    return (
      <PanelShell variant={variant} title={`Manage transfer · ${therapistName}`} onClose={onClose} hideFooter>
        <div className="px-5 py-5 animate-pulse space-y-3">
          <div className="h-5 bg-background rounded w-40" />
          <div className="h-10 bg-background rounded" />
          <div className="h-10 bg-background rounded" />
        </div>
      </PanelShell>
    );
  }

  // Which of the four views we're in, and what each contributes to the shell.
  let title; let dirty; let reason = ''; let primary; let cancelLabel = 'Close'; let body; let hideFooter = false;

  const editDateTime = (
    <div className="grid grid-cols-2 gap-3">
      <DateField label="New return date" required value={editReturnDate} onChange={setEditReturnDate} disabled={editing} />
      <TimeField label="New return time" required value={editReturnTime} onChange={setEditReturnTime} disabled={editing} />
    </div>
  );

  // Past-moment / specific-return-time block shared by the origin "cancel" view and the destination "active" view.
  const customReturnBlock = (originView) => (
    <div className="border border-border rounded-spa p-3 space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={useCustomReturnTime}
          onChange={(e) => {
            setUseCustomReturnTime(e.target.checked);
            setRevertError(null);
            if (e.target.checked && !customReturnDate) {
              const now = new Date();
              // Local date/time components — toISOString() is UTC and can land on a different calendar day near midnight.
              const pad = (n) => String(n).padStart(2, '0');
              setCustomReturnDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
              setCustomReturnTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
            }
          }}
          disabled={reverting}
          className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer"
        />
        <span className="font-body font-body-medium text-[13px] text-text-primary">
          {originView ? 'They already returned at a specific past time' : 'Or pick a specific return time'}
        </span>
      </label>
      {useCustomReturnTime && (
        <div className="space-y-3">
          {!originView && (
            <p className="text-xs text-text-secondary">
              A past moment means they've already come back; a future one reschedules when they will (e.g. needed for less time than originally planned).
            </p>
          )}
          <InlineError message={revertError} />
          <div className="grid grid-cols-2 gap-3">
            <DateField label="Date" value={customReturnDate} onChange={setCustomReturnDate} disabled={reverting} />
            <TimeField label="Time" value={customReturnTime} onChange={setCustomReturnTime} disabled={reverting} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={originView ? handleMarkReturnedAt : handleUpdateReturnTime}
              disabled={reverting || (!originView && extending)}
              className="h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast disabled:opacity-50 flex items-center gap-2"
            >
              {reverting && <div className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />}
              {originView
                ? 'Mark returned early'
                : (customReturnDate && customReturnTime && new Date(`${customReturnDate}T${customReturnTime}`) > new Date() ? 'Set new return time' : 'Mark returned early')}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (scheduledTransfer && !editingScheduled) {
    const mayAct = can('cancelScheduled', scheduledTransfer) && scheduledTransfer.fromBranchId === currentBranchId;
    title = `Manage transfer · ${therapistName}`;
    dirty = false;
    hideFooter = true;
    body = (
      <FormBody>
        {summaryFor(scheduledTransfer)}
        <InfoRows rows={infoRowsFor(scheduledTransfer)} />
        <InlineError message={scheduledError} />
        {mayAct && (confirmingCancel ? (
          <div className="border border-border rounded-spa p-3 space-y-3">
            <p className="font-body text-[13px] text-text-primary">Cancel this scheduled transfer? {therapistName} stays at {scheduledTransfer.fromBranch}.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmingCancel(false)} disabled={cancellingScheduled} className="h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast">Keep it</button>
              <button type="button" onClick={handleCancelScheduled} disabled={cancellingScheduled} className="h-9 px-3 text-[13px] font-body font-body-medium rounded-spa bg-error text-white hover:opacity-90 spa-transition-fast disabled:opacity-50">{cancellingScheduled ? 'Cancelling…' : 'Yes, cancel transfer'}</button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={startEditScheduled} className="h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast">Edit</button>
            <button type="button" onClick={() => setConfirmingCancel(true)} className="h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa text-error hover:bg-background spa-transition-fast">Cancel transfer</button>
          </div>
        ))}
      </FormBody>
    );
  } else if (activeTransfer && !can('revertNow', activeTransfer)) {
    // Staff and admin_viewer: the words only, no actions.
    title = `Transfer · ${therapistName}`;
    dirty = false;
    hideFooter = true;
    body = (
      <FormBody>
        {summaryFor(activeTransfer)}
        <InfoRows rows={infoRowsFor(activeTransfer)} />
      </FormBody>
    );
  } else if (activeTransfer && isOriginCancelView) {
    title = `Manage transfer · ${therapistName}`;
    dirty = (originAction === 'edit' && (!!editReturnDate || !!editReturnTime)) || (originAction === 'cancel' && useCustomReturnTime);
    if (originAction === 'edit') {
      primary = { label: editing ? 'Saving…' : 'Save new return time', onClick: handleEditReturnTime, disabled: !editReturnDate || !editReturnTime, loading: editing };
      reason = !editReturnDate ? 'Pick a return date' : !editReturnTime ? 'Pick a return time' : '';
    } else {
      primary = { label: cancellingActive ? 'Bringing back…' : 'Bring back now', onClick: handleCancelTransferNow, disabled: reverting, loading: cancellingActive };
    }
    body = (
      <>
        <TabBar
          tabs={[{ id: 'cancel', label: 'Bring back now', icon: 'Undo2' }, { id: 'edit', label: 'Change return time', icon: 'CalendarClock' }]}
          value={originAction}
          onChange={(id) => { if (busy) return; if (id === 'cancel') { setOriginAction('cancel'); setEditError(null); } else { setOriginAction('edit'); setCancelActiveError(null); setRevertError(null); } }}
        />
        <FormBody>
          {summaryFor(activeTransfer)}
          <InfoRows rows={infoRowsFor(activeTransfer)} />
          {originAction === 'edit' ? (
            <>
              <p className="text-xs text-text-secondary">Change when {therapistName} is back at {activeTransfer.fromBranch}. The transfer stays active until then.</p>
              <InlineError message={editError} />
              {editDateTime}
            </>
          ) : (
            <>
              <InlineError message={cancelActiveError} />
              <p className="text-xs text-text-secondary">
                This brings {therapistName} back to {activeTransfer.fromBranch} right now. If they're still booked at {activeTransfer.toBranch}, it will
                tell you so — you'll then need to wait until that booking finishes, or pick the exact time it did below.
              </p>
              {customReturnBlock(true)}
            </>
          )}
        </FormBody>
      </>
    );
  } else if (activeTransfer) {
    title = `Manage transfer · ${therapistName}`;
    dirty = isExtendFormComplete || useCustomReturnTime || !!extendDurationUnit || !!extendDurationValue;
    primary = { label: extending ? 'Extending…' : 'Extend', onClick: handleExtendTransfer, disabled: !isExtendFormComplete || reverting, loading: extending };
    reason = !extendDurationUnit ? 'Pick a unit' : !(Number(extendDurationValue) > 0) ? 'Enter an amount' : '';
    body = (
      <FormBody>
        {summaryFor(activeTransfer)}
        <InfoRows rows={infoRowsFor(activeTransfer)} />
        <InlineError message={extendValidationError || extendError || (!useCustomReturnTime ? revertError : null)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Add extra time">
            <SelectField placeholder="Select unit..." options={UNIT_OPTIONS} value={extendDurationUnit} onChange={setExtendDurationUnit} />
          </Field>
          <Field label="Amount">
            <NumberInput min="1" step="1" value={extendDurationValue} onChange={(e) => { setExtendDurationValue(e.target.value); setExtendError(null); }} placeholder="e.g. 2" />
          </Field>
        </div>
        {customReturnBlock(false)}
      </FormBody>
    );
  } else {
    title = `Transfer ${staff.toLowerCase()} · ${therapistName}`;
    dirty = !!transferToBranch || !!transferDurationUnit || !!transferDurationValue || !!transferNote.trim() || isPermanentTransfer || !!transferStartTime;
    const scheduled = transferStartDate > today;
    primary = {
      label: transferring ? 'Transferring…' : completedTransfer ? 'Transfer again' : scheduled ? 'Schedule transfer' : 'Transfer',
      onClick: handleTransfer, disabled: !isTransferFormComplete, loading: transferring,
    };
    cancelLabel = 'Cancel';
    reason = !transferToBranch ? 'Select a destination branch' : !transferStartDate ? 'Pick a start date'
      : !isPermanentTransfer && !transferStartTime ? 'Pick a start time'
      : !isPermanentTransfer && !transferDurationUnit ? 'Pick a duration unit'
      : !isPermanentTransfer && !(Number(transferDurationValue) > 0) ? 'Enter a duration' : '';
    body = (
      <FormBody>
        {completedTransfer && (
          <div className="border border-border rounded-spa px-3 py-2">{summaryFor(completedTransfer)}</div>
        )}
        <Segmented options={[['temporary', 'Temporary'], ['permanent', 'Permanent']]} value={transferMode} onChange={setTransferMode} />
        <p className="font-body text-[13px] text-text-secondary">
          {isPermanentTransfer
            ? <>Move {therapistName} to another branch permanently. They'll stay there until transferred again.</>
            : <>Move {therapistName} to another branch for a set duration. They'll automatically return to their current branch once it elapses.</>}
        </p>
        <InlineError message={transferError} />
        <Field label="Destination branch" required>
          <SelectField
            placeholder="Select a branch..."
            options={orgBranches.filter((b) => b.id !== currentBranchId).map((b) => ({ value: b.id, label: b.name }))}
            value={transferToBranch}
            onChange={setTransferToBranch}
          />
        </Field>
        <div className={isPermanentTransfer ? '' : 'grid grid-cols-2 gap-3'}>
          <DateField label="Start date" required value={transferStartDate} onChange={setTransferStartDate} />
          {!isPermanentTransfer && <TimeField label="Transfer time" required value={transferStartTime} onChange={setTransferStartTime} />}
        </div>
        {!isPermanentTransfer && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration unit" required>
              <SelectField placeholder="Select unit..." options={UNIT_OPTIONS} value={transferDurationUnit} onChange={setTransferDurationUnit} />
            </Field>
            <Field label="Duration" required>
              <NumberInput min="1" value={transferDurationValue} onChange={(e) => setTransferDurationValue(e.target.value)} placeholder="e.g. 2" />
            </Field>
          </div>
        )}
        {revertDateObj && (
          <p className="text-xs text-text-secondary">
            Returns to the current branch around <span className="font-body-medium text-text-primary">{formatRevert(revertDateObj)}</span>
          </p>
        )}
        {!isPermanentTransfer && (
          <TransferHoursWarning therapistId={therapistId} therapistName={therapistName} toBranch={orgBranches.find((b) => b.id === transferToBranch)}
            startDate={transferStartDate} startTime={transferStartTime} revertDate={revertDateObj} use24h={use24h} />
        )}
        <Field label="Note (optional)">
          <TextInput value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="Reason for transfer..." />
        </Field>
      </FormBody>
    );
  }

  return (
    <PanelShell
      variant={variant}
      title={title}
      onClose={onClose}
      dirty={dirty}
      guardRef={guardRef}
      busy={busy}
      reason={reason}
      cancelLabel={cancelLabel}
      primary={primary}
      hideFooter={hideFooter}
    >
      {body}
    </PanelShell>
  );
};

export default TransferManagementModal;
