import React, { useState, useEffect } from 'react';
import Icon from '../AppIcon';
import Select from './Select';
import Input from './Input';
import Button from './Button';
import { useIndustry } from '../../hooks/useIndustry';
import {
  transferTherapist,
  extendStaffTransfer,
  revertStaffTransferNow,
  rescheduleStaffTransferReturn,
  fetchAllBranches,
  fetchTherapistTransferStatus,
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

const DURATION_UNIT_OPTIONS = [
  { value: 'minute', label: 'Minute' },
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

// Client-side estimate only, for the modal's preview line — the server independently
// computes the authoritative revert_at (migration-145's transfer_therapist()).
function computeRevertPreview(dateStr, timeStr, value, unit) {
  if (!dateStr || !timeStr || !value || !unit) return null;
  const start = new Date(`${dateStr}T${timeStr}`);
  if (Number.isNaN(start.getTime())) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  let revert;
  if (unit === 'month') {
    // Match Postgres's `timestamp + interval 'n months'` semantics (clamp to the last valid day
    // of the target month), not JS Date.setMonth()'s overflow-into-next-month behavior — e.g.
    // Jan 31 + 1 month is Feb 28 server-side, not Mar 3. The server (transfer_therapist()) is
    // the actual source of truth for revert_at; this is just the preview shown before confirming.
    const targetMonthIndex = start.getMonth() + n;
    const targetYear = start.getFullYear() + Math.floor(targetMonthIndex / 12);
    const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
    const lastDayOfTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
    const clampedDay = Math.min(start.getDate(), lastDayOfTargetMonth);
    revert = new Date(targetYear, normalizedMonth, clampedDay, start.getHours(), start.getMinutes(), start.getSeconds());
  } else {
    const msPerUnit = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 };
    revert = new Date(start.getTime() + n * msPerUnit[unit]);
  }
  return revert.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// Standalone transfer-management modal: create a new transfer, or — when this therapist
// already has an active/recently-completed one for this branch — extend it, reschedule/mark
// their return, or (origin branch) cancel it outright. Extracted out of AttendancePanel.jsx so
// it can be reused from other call sites (e.g. the Calendar) without duplicating this logic;
// unlike AttendancePanel (which precomputes a branch-wide transferStatusByTherapist map), this
// component fetches this one therapist's current transfer status itself on mount, so callers
// only need to hand it a therapist + branch.
const TransferManagementModal = ({ therapistId, therapistName, currentBranchId, defaultStartDate, onClose, onSuccess }) => {
  const { staffLabel } = useIndustry();
  const today = new Date().toISOString().split('T')[0];

  const [loadingStatus, setLoadingStatus] = useState(true);
  const [activeTransfer, setActiveTransfer] = useState(null);
  const [completedTransfer, setCompletedTransfer] = useState(null);

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
      setActiveTransfer(active);
      setCompletedTransfer(completed);
      setLoadingStatus(false);
    });
    return () => { cancelled = true; };
  }, [therapistId, currentBranchId]);

  const isExtendFormComplete = !!extendDurationUnit && !!extendDurationValue && Number(extendDurationValue) > 0;

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
      setExtendError(result.error.message || 'Failed to extend transfer.');
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

    const isFuture = transferStartDate > today;
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

  if (loadingStatus) {
    return (
      <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-background rounded w-40" />
            <div className="h-10 bg-background rounded" />
            <div className="h-10 bg-background rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
            {isOriginCancelView ? (originAction === 'edit' ? 'Edit Transfer' : 'Cancel Transfer') : activeTransfer ? `Active Transfer — ${staffLabel}` : `Transfer ${staffLabel}`}
          </h3>
          <button onClick={() => !busy && onClose()} className="p-1 rounded hover:bg-background">
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>

        {activeTransfer && isOriginCancelView ? (
          <>
            {/* ORIGIN branch managing a transfer it initiated — two distinct actions: Cancel
                (undo it, now or at a specific past moment) vs Edit (push the return date/time
                further out, still in the future). No Add Extra Time here regardless of mode —
                only the destination manager may extend. */}
            <p className="font-body text-sm text-text-secondary">
              <span className="font-body-medium text-text-primary">"{therapistName}"</span> is currently transferred to{' '}
              <span className="font-body-medium text-text-primary">{activeTransfer.toBranch}</span>.
            </p>

            <div className="bg-primary/5 rounded-spa p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary">Since</span>
                <span className="font-body-medium text-text-primary">
                  {formatPrettyDate(activeTransfer.effectiveDate)} {activeTransfer.startTime?.slice(0, 5)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Scheduled return</span>
                <span className="font-body-medium text-accent">
                  {new Date(activeTransfer.revertAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 p-1 bg-background rounded-spa">
              <button
                type="button"
                onClick={() => { setOriginAction('cancel'); setEditError(null); }}
                disabled={busy}
                className={`px-3 py-1.5 rounded-spa text-sm font-body font-body-medium spa-transition-fast ${
                  originAction === 'cancel' ? 'bg-surface shadow-spa-resting text-text-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Cancel Transfer
              </button>
              <button
                type="button"
                onClick={() => { setOriginAction('edit'); setCancelActiveError(null); setRevertError(null); }}
                disabled={busy}
                className={`px-3 py-1.5 rounded-spa text-sm font-body font-body-medium spa-transition-fast ${
                  originAction === 'edit' ? 'bg-surface shadow-spa-resting text-text-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Edit Transfer
              </button>
            </div>

            {originAction === 'edit' ? (
              <>
                <p className="font-caption text-xs text-text-tertiary">
                  Push {therapistName}'s return further out — the transfer stays active until the new time.
                </p>
                {editError && (
                  <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                    <Icon name="AlertCircle" size={16} />
                    <span>{editError}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block font-body font-body-medium text-sm text-text-primary">New return date</label>
                    <input
                      type="date"
                      value={editReturnDate}
                      onChange={(e) => setEditReturnDate(e.target.value)}
                      disabled={editing}
                      className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block font-body font-body-medium text-sm text-text-primary">New return time</label>
                    <input
                      type="time"
                      value={editReturnTime}
                      onChange={(e) => setEditReturnTime(e.target.value)}
                      disabled={editing}
                      className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={onClose} disabled={editing}>Close</Button>
                  <Button variant="primary" size="sm" onClick={handleEditReturnTime} loading={editing}>
                    Save New Return Time
                  </Button>
                </div>
              </>
            ) : (
              <>
                {cancelActiveError && (
                  <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                    <Icon name="AlertCircle" size={16} />
                    <span>{cancelActiveError}</span>
                  </div>
                )}

                <p className="font-caption text-xs text-text-tertiary">
                  Cancelling brings {therapistName} back to this branch right now. If they're still
                  booked at {activeTransfer.toBranch}, cancelling will tell you so — you'll then need to
                  wait until that booking finishes, or pick the exact time it did below.
                </p>

                <div className="border border-border rounded-spa p-3 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useCustomReturnTime}
                      onChange={(e) => {
                        setUseCustomReturnTime(e.target.checked);
                        setRevertError(null);
                        if (e.target.checked && !customReturnDate) {
                          const now = new Date();
                          const pad = (n) => String(n).padStart(2, '0');
                          setCustomReturnDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
                          setCustomReturnTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
                        }
                      }}
                      disabled={reverting}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer"
                    />
                    <span className="font-body font-body-medium text-sm text-text-primary">
                      They already returned at a specific past time
                    </span>
                  </label>
                  {useCustomReturnTime && (
                    <div className="space-y-2 pt-1">
                      {revertError && (
                        <div className="flex items-center gap-2 p-2 bg-error/10 border border-error/20 rounded-spa text-error text-xs">
                          <Icon name="AlertCircle" size={14} />
                          <span>{revertError}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block font-body font-body-medium text-sm text-text-primary">Date</label>
                          <input
                            type="date"
                            value={customReturnDate}
                            max={toLocalYMD(new Date())}
                            onChange={(e) => setCustomReturnDate(e.target.value)}
                            disabled={reverting}
                            className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block font-body font-body-medium text-sm text-text-primary">Time</label>
                          <input
                            type="time"
                            value={customReturnTime}
                            max={customReturnDate === toLocalYMD(new Date())
                              ? new Date().toTimeString().slice(0, 5)
                              : undefined}
                            onChange={(e) => setCustomReturnTime(e.target.value)}
                            disabled={reverting}
                            className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" onClick={handleMarkReturnedAt} loading={reverting}>
                          Mark Returned Early
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={onClose} disabled={cancellingActive}>Close</Button>
                  <Button variant="primary" size="sm" onClick={handleCancelTransferNow} loading={cancellingActive} disabled={reverting}>
                    Cancel Transfer
                  </Button>
                </div>
              </>
            )}
          </>
        ) : activeTransfer ? (
          <>
            {/* ACTIVE: show current transfer details + Add Extra Time. Cannot start a
                new transfer for this staffer until this one resolves (server-enforced). */}
            <p className="font-body text-sm text-text-secondary">
              <span className="font-body-medium text-text-primary">"{therapistName}"</span> is currently transferred here from{' '}
              <span className="font-body-medium text-text-primary">{activeTransfer.fromBranch}</span>.
            </p>

            <div className="bg-primary/5 rounded-spa p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary">Destination branch</span>
                <span className="font-body-medium text-text-primary">{activeTransfer.toBranch}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Start</span>
                <span className="font-body-medium text-text-primary">
                  {formatPrettyDate(activeTransfer.effectiveDate)} {activeTransfer.startTime?.slice(0, 5)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Current return</span>
                <span className="font-body-medium text-accent">
                  {new Date(activeTransfer.revertAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Status</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-caption font-caption-medium bg-success/10 text-success">
                  <Icon name="CheckCircle" size={11} /> Active
                </span>
              </div>
            </div>

            {(extendError || revertError) && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{extendError || revertError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Add Extra Time"
                placeholder="Select unit..."
                options={DURATION_UNIT_OPTIONS}
                value={extendDurationUnit}
                onChange={setExtendDurationUnit}
              />
              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Amount</label>
                <Input
                  type="number"
                  min="1"
                  value={extendDurationValue}
                  onChange={(e) => setExtendDurationValue(e.target.value)}
                  placeholder="e.g. 2"
                />
              </div>
            </div>

            <div className="border border-border rounded-spa p-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useCustomReturnTime}
                  onChange={(e) => {
                    setUseCustomReturnTime(e.target.checked);
                    setRevertError(null);
                    if (e.target.checked && !customReturnDate) {
                      const now = new Date();
                      // Use local date/time components for both fields — toISOString() is UTC and
                      // can land on a different calendar day than toTimeString()'s local time near
                      // midnight (e.g. Nepal is UTC+5:45), silently defaulting to the wrong day.
                      const pad = (n) => String(n).padStart(2, '0');
                      setCustomReturnDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
                      setCustomReturnTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
                    }
                  }}
                  disabled={reverting}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer"
                />
                <span className="font-body font-body-medium text-sm text-text-primary">
                  Or pick a specific return time
                </span>
              </label>
              {useCustomReturnTime && (
                <div className="space-y-2 pt-1">
                  <p className="font-caption text-xs text-text-tertiary">
                    A past moment means they've already come back; a future one reschedules when they will
                    (e.g. needed for less time than originally planned).
                  </p>
                  {revertError && (
                    <div className="flex items-center gap-2 p-2 bg-error/10 border border-error/20 rounded-spa text-error text-xs">
                      <Icon name="AlertCircle" size={14} />
                      <span>{revertError}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block font-body font-body-medium text-sm text-text-primary">Date</label>
                      <input
                        type="date"
                        value={customReturnDate}
                        onChange={(e) => setCustomReturnDate(e.target.value)}
                        disabled={reverting}
                        className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block font-body font-body-medium text-sm text-text-primary">Time</label>
                      <input
                        type="time"
                        value={customReturnTime}
                        onChange={(e) => setCustomReturnTime(e.target.value)}
                        disabled={reverting}
                        className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={handleUpdateReturnTime} loading={reverting} disabled={extending}>
                      {customReturnDate && customReturnTime && new Date(`${customReturnDate}T${customReturnTime}`) > new Date()
                        ? 'Set New Return Time'
                        : 'Mark Returned Early'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={extending || reverting}>Close</Button>
              <Button variant="primary" size="sm" onClick={handleExtendTransfer} loading={extending} disabled={!isExtendFormComplete || reverting}>
                Add Extra Time
              </Button>
            </div>
          </>
        ) : (
          <>
            {completedTransfer && (
              <div className="bg-background rounded-spa border border-border p-3 space-y-1 text-sm">
                <p className="font-body font-body-medium text-text-primary flex items-center gap-1.5">
                  <Icon name="CheckCircle" size={14} className="text-success" /> Transfer completed
                </p>
                <p className="font-body text-text-secondary">
                  Returned to <span className="font-body-medium">{completedTransfer.fromBranch}</span> from{' '}
                  {completedTransfer.toBranch} at{' '}
                  {completedTransfer.revertedAt
                    ? new Date(completedTransfer.revertedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
                    : '—'}.
                </p>
              </div>
            )}

            <div className="flex rounded-spa border border-border p-0.5 bg-background w-fit">
              <button
                type="button"
                onClick={() => setTransferMode('temporary')}
                className={`px-3 py-1.5 rounded text-sm font-body font-body-medium transition-colors ${
                  transferMode === 'temporary' ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Temporary
              </button>
              <button
                type="button"
                onClick={() => setTransferMode('permanent')}
                className={`px-3 py-1.5 rounded text-sm font-body font-body-medium transition-colors ${
                  transferMode === 'permanent' ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Permanent
              </button>
            </div>

            <p className="font-body text-sm text-text-secondary">
              {isPermanentTransfer ? (
                <>Move <span className="font-body-medium text-text-primary">"{therapistName}"</span> to another branch permanently. They'll stay there until transferred again.</>
              ) : (
                <>Move <span className="font-body-medium text-text-primary">"{therapistName}"</span> to another branch for a set duration. They'll automatically return to their current branch once it elapses.</>
              )}
            </p>

            {transferError && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{transferError}</span>
              </div>
            )}

            <Select
              label="Destination Branch"
              placeholder="Select a branch..."
              options={orgBranches
                .filter(b => b.id !== currentBranchId)
                .map(b => ({ value: b.id, label: b.name }))}
              value={transferToBranch}
              onChange={setTransferToBranch}
            />

            <div className={isPermanentTransfer ? '' : 'grid grid-cols-2 gap-3'}>
              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Start Date</label>
                <input
                  type="date"
                  value={transferStartDate}
                  onChange={(e) => setTransferStartDate(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              {!isPermanentTransfer && (
                <div className="space-y-1">
                  <label className="block font-body font-body-medium text-sm text-text-primary">Transfer Time</label>
                  <input
                    type="time"
                    value={transferStartTime}
                    onChange={(e) => setTransferStartTime(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              )}
            </div>

            {!isPermanentTransfer && (
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Duration Unit"
                  placeholder="Select unit..."
                  options={DURATION_UNIT_OPTIONS}
                  value={transferDurationUnit}
                  onChange={setTransferDurationUnit}
                />
                <div className="space-y-1">
                  <label className="block font-body font-body-medium text-sm text-text-primary">Duration</label>
                  <Input
                    type="number"
                    min="1"
                    value={transferDurationValue}
                    onChange={(e) => setTransferDurationValue(e.target.value)}
                    placeholder="e.g. 2"
                  />
                </div>
              </div>
            )}

            {!isPermanentTransfer && isTransferFormComplete && (
              <p className="font-caption text-xs text-text-tertiary">
                Will automatically move back to the current branch around{' '}
                <span className="font-body-medium text-text-secondary">
                  {computeRevertPreview(transferStartDate, transferStartTime, transferDurationValue, transferDurationUnit)}
                </span>.
              </p>
            )}

            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Note (optional)</label>
              <Input
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="Reason for transfer..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={transferring}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleTransfer} loading={transferring} disabled={!isTransferFormComplete}>
                {completedTransfer ? 'Transfer Therapist Again' : (transferStartDate > today ? 'Schedule Transfer' : 'Transfer')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TransferManagementModal;
