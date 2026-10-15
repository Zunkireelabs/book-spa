import React, { useState, useEffect } from 'react';
import Icon from '../AppIcon';
import {
  PanelShell, FormBody, Field, TextInput, NumberInput, SelectField, Segmented, TabBar, DateField, TimeField, InlineError, InfoRows,
} from './PanelFormKit';
import { computeRevertDate as computeRevertDateUtil, DURATION_UNIT_OPTIONS as UNIT_OPTIONS, formatRevert, toYmd, toHm, validateExtension } from '../../utils/transferPreview';
import { friendlyError } from '../../utils/friendlyError';
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

// Standalone transfer-management modal: create a new transfer, or — when this therapist
// already has an active/recently-completed one for this branch — extend it, reschedule/mark
// their return, or (origin branch) cancel it outright. Extracted out of AttendancePanel.jsx so
// it can be reused from other call sites (e.g. the Calendar) without duplicating this logic;
// unlike AttendancePanel (which precomputes a branch-wide transferStatusByTherapist map), this
// component fetches this one therapist's current transfer status itself on mount, so callers
// only need to hand it a therapist + branch.
const TransferManagementModal = ({ variant = 'modal', therapistId, therapistName, currentBranchId, defaultStartDate, guardRef, onClose, onSuccess, onDraftChange }) => {
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
  const fmtDT = (v) => formatRevert(new Date(v));
  const todayLocal = toLocalYMD(new Date());
  const nowHm = toHm(new Date());
  const t12 = (hm) => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`; };
  const staff = (staffLabel || 'Therapist');

  // Live shading preview of the transfer window (create view only).
  const revertDateObj = isPermanentTransfer ? null : computeRevertDateUtil(transferStartDate, transferStartTime, transferDurationValue, transferDurationUnit);
  const showCreate = !loadingStatus && !activeTransfer;
  useEffect(() => {
    if (!showCreate) { onDraftChange?.(null); return; }
    onDraftChange?.({
      kind: 'transfer', therapistId, date: transferStartDate, startTime: isPermanentTransfer ? '00:00' : transferStartTime,
      endDate: revertDateObj ? toYmd(revertDateObj) : null, endTime: revertDateObj ? toHm(revertDateObj) : null,
      permanent: isPermanentTransfer, therapistName,
    });
  }, [showCreate, therapistId, transferStartDate, transferStartTime, isPermanentTransfer, revertDateObj && revertDateObj.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDraftChange?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

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
  let title; let dirty; let reason = ''; let primary; let cancelLabel = 'Close'; let body;

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

  if (activeTransfer && isOriginCancelView) {
    title = `Manage transfer · ${therapistName}`;
    dirty = (originAction === 'edit' && (!!editReturnDate || !!editReturnTime)) || (originAction === 'cancel' && useCustomReturnTime);
    if (originAction === 'edit') {
      primary = { label: editing ? 'Saving…' : 'Save new return time', onClick: handleEditReturnTime, disabled: !editReturnDate || !editReturnTime, loading: editing };
      reason = !editReturnDate ? 'Pick a return date' : !editReturnTime ? 'Pick a return time' : '';
    } else {
      primary = { label: cancellingActive ? 'Cancelling…' : 'Cancel transfer', onClick: handleCancelTransferNow, disabled: reverting, loading: cancellingActive };
    }
    body = (
      <>
        <TabBar
          tabs={[{ id: 'cancel', label: 'Cancel transfer', icon: 'Undo2' }, { id: 'edit', label: 'Edit transfer', icon: 'CalendarClock' }]}
          value={originAction}
          onChange={(id) => { if (busy) return; if (id === 'cancel') { setOriginAction('cancel'); setEditError(null); } else { setOriginAction('edit'); setCancelActiveError(null); setRevertError(null); } }}
        />
        <FormBody>
          <p className="font-body text-[13px] text-text-secondary">
            {therapistName} is currently transferred to <span className="font-body-medium text-text-primary">{activeTransfer.toBranch}</span>.
          </p>
          <InfoRows rows={[
            ['Since', `${formatPrettyDate(activeTransfer.effectiveDate)} ${t12(activeTransfer.startTime?.slice(0, 5))}`],
            ['Scheduled return', fmtDT(activeTransfer.revertAt), 'amber'],
          ]} />
          {originAction === 'edit' ? (
            <>
              <p className="text-xs text-text-secondary">Push {therapistName}'s return further out — the transfer stays active until the new time.</p>
              <InlineError message={editError} />
              {editDateTime}
            </>
          ) : (
            <>
              <InlineError message={cancelActiveError} />
              <p className="text-xs text-text-secondary">
                Cancelling brings {therapistName} back to this branch right now. If they're still booked at {activeTransfer.toBranch}, cancelling will
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
    primary = { label: extending ? 'Adding…' : 'Add extra time', onClick: handleExtendTransfer, disabled: !isExtendFormComplete || reverting, loading: extending };
    reason = !extendDurationUnit ? 'Pick a unit' : !(Number(extendDurationValue) > 0) ? 'Enter an amount' : '';
    body = (
      <FormBody>
        <p className="font-body text-[13px] text-text-secondary">
          {therapistName} is currently transferred here from <span className="font-body-medium text-text-primary">{activeTransfer.fromBranch}</span>.
        </p>
        <InfoRows rows={[
          ['Destination branch', activeTransfer.toBranch],
          ['Start', `${formatPrettyDate(activeTransfer.effectiveDate)} ${t12(activeTransfer.startTime?.slice(0, 5))}`],
          ['Current return', fmtDT(activeTransfer.revertAt), 'amber'],
          ['Status', 'Active'],
        ]} />
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
          <div className="border border-border rounded-spa px-3 py-2 text-[13px] space-y-0.5">
            <p className="font-body-medium text-text-primary">Transfer completed</p>
            <p className="text-text-secondary">
              Returned to {completedTransfer.fromBranch} from {completedTransfer.toBranch}
              {completedTransfer.revertedAt ? ` at ${fmtDT(completedTransfer.revertedAt)}` : ''}.
            </p>
          </div>
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
    >
      {body}
    </PanelShell>
  );
};

export default TransferManagementModal;
