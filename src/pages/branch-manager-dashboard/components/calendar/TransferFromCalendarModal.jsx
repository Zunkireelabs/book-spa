import React, { useState, useEffect } from 'react';
import { transferTherapist, fetchAllBranches } from '../../../../services/api';
import { useAvailabilityConflictGuard } from '../../../../hooks/useAvailabilityConflictGuard';
import { transferChange } from '../../../../services/availabilityConflicts';
import { computeRevertDate, DURATION_UNIT_OPTIONS, formatRevert, toYmd, toHm } from '../../../../utils/transferPreview';
import {
  PanelShell, FormBody, Field, TextInput, NumberInput, SelectField, Segmented, DateField, TimeField, InlineError,
} from '../../../../components/ui/PanelFormKit';

// Transfer-creation entry point reachable from the Calendar's empty-slot choice menu — mirrors the Attendance panel's
// transfer form (creation half only) so both entry points call the exact same transferTherapist() API and produce identical
// staff_transfers rows. Renders as a docked SidePanel on the calendar (variant="panel"). While open it reports a live
// draft (`onDraftChange`) so the grid shades the window the therapist will be away.
const TransferFromCalendarModal = ({
  variant = 'modal', therapistId, therapistName, currentBranchId, defaultDate, defaultTime, guardRef, onClose, onSuccess, onDraftChange,
}) => {
  const { confirmConflicts, conflictModal } = useAvailabilityConflictGuard();
  const [orgBranches, setOrgBranches] = useState([]);
  const [transferMode, setTransferMode] = useState('temporary');
  const [toBranch, setToBranch] = useState('');
  const [startDate, setStartDate] = useState(defaultDate || '');
  const [startTime, setStartTime] = useState(defaultTime || '');
  const [durationUnit, setDurationUnit] = useState('');
  const [durationValue, setDurationValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchAllBranches().then(({ data }) => setOrgBranches(data || []));
  }, []);

  const isPermanent = transferMode === 'permanent';
  const isFormComplete = isPermanent
    ? !!toBranch && !!startDate
    : !!toBranch && !!startDate && !!startTime && !!durationUnit && !!durationValue && Number(durationValue) > 0;
  const dirty = !!toBranch || !!durationUnit || !!durationValue || !!note.trim() || isPermanent
    || startDate !== (defaultDate || '') || startTime !== (defaultTime || '');

  const revertDate = !isPermanent ? computeRevertDate(startDate, startTime, durationValue, durationUnit) : null;

  // Live shading preview on the therapist's column: from the start moment to the estimated return (or open-ended if permanent).
  useEffect(() => {
    onDraftChange?.({
      kind: 'transfer', therapistId, date: startDate, startTime: isPermanent ? '00:00' : startTime,
      endDate: revertDate ? toYmd(revertDate) : null, endTime: revertDate ? toHm(revertDate) : null,
      permanent: isPermanent, therapistName,
    });
  }, [therapistId, startDate, startTime, isPermanent, revertDate && revertDate.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDraftChange?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!toBranch) { setError('Select a destination branch.'); return; }
    if (!startDate) { setError('Select a start date.'); return; }
    if (!isPermanent) {
      if (!startTime) { setError('Select a start time.'); return; }
      if (!durationUnit) { setError('Select a duration unit.'); return; }
      if (!durationValue || Number(durationValue) <= 0) { setError('Enter a valid duration.'); return; }
    }

    setSubmitting(true);
    setError(null);

    // Bookings the therapist still has at this branch inside the window are listed first (kept either way).
    const proceed = await confirmConflicts({
      therapistId,
      change: transferChange({
        fromTs: `${startDate}T${isPermanent ? '00:00' : startTime}:00+05:45`,
        toTs: revertDate ? `${toYmd(revertDate)}T${toHm(revertDate)}:00+05:45` : null,
        toBranchId: toBranch,
      }),
      summary: `Moving ${therapistName} to another branch from ${startDate}${isPermanent ? '' : ` ${startTime}`}.`,
      titleFor: (n) => `${n} upcoming booking${n === 1 ? '' : 's'} at this branch while away`,
      saveLabel: 'Transfer anyway',
    });
    if (!proceed) { setSubmitting(false); return; }

    const result = await transferTherapist({
      therapistId,
      toBranchId: toBranch,
      permanent: isPermanent,
      startTime: isPermanent ? null : startTime,
      durationValue: isPermanent ? null : Number(durationValue),
      durationUnit: isPermanent ? null : durationUnit,
      note: note.trim() || null,
      effectiveDate: startDate,
    });

    if (result.error) {
      setError(result.error.message || 'Transfer failed.');
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onSuccess?.({ applied: result.data?.applied, startDate, startTime: isPermanent ? null : startTime });
  };

  const reason = !toBranch ? 'Select a destination branch' : !startDate ? 'Pick a start date'
    : !isPermanent && !startTime ? 'Pick a start time'
    : !isPermanent && !durationUnit ? 'Pick a duration unit'
    : !isPermanent && !(Number(durationValue) > 0) ? 'Enter a duration' : '';
  const scheduled = startDate && startDate > new Date().toISOString().split('T')[0];

  return (
    <>
    <PanelShell
      variant={variant}
      title={`Transfer therapist · ${therapistName}`}
      onClose={onClose}
      dirty={dirty}
      guardRef={guardRef}
      busy={submitting}
      reason={reason}
      primary={{ label: submitting ? 'Transferring…' : scheduled ? 'Schedule transfer' : 'Transfer', onClick: handleSubmit, disabled: !isFormComplete, loading: submitting }}
    >
      <FormBody>
        <Segmented options={[['temporary', 'Temporary'], ['permanent', 'Permanent']]} value={transferMode} onChange={setTransferMode} />

        <p className="font-body text-[13px] text-text-secondary">
          {isPermanent
            ? <>Move {therapistName} to another branch permanently.</>
            : <>Move {therapistName} to another branch for a set duration. They'll automatically return once it elapses.</>}
        </p>

        <InlineError message={error} />

        <Field label="Destination branch" required>
          <SelectField
            placeholder="Select a branch..."
            options={orgBranches.filter((b) => b.id !== currentBranchId).map((b) => ({ value: b.id, label: b.name }))}
            value={toBranch}
            onChange={setToBranch}
          />
        </Field>

        <div className={isPermanent ? '' : 'grid grid-cols-2 gap-3'}>
          <DateField label="Start date" required value={startDate} onChange={setStartDate} />
          {!isPermanent && <TimeField label="Transfer time" required value={startTime} onChange={setStartTime} fromTime="06:00" toTime="23:50" />}
        </div>

        {!isPermanent && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration unit" required>
              <SelectField placeholder="Select unit..." options={DURATION_UNIT_OPTIONS} value={durationUnit} onChange={setDurationUnit} />
            </Field>
            <Field label="Duration" required>
              <NumberInput min="1" value={durationValue} onChange={(e) => setDurationValue(e.target.value)} placeholder="e.g. 2" />
            </Field>
          </div>
        )}

        {revertDate && (
          <p className="text-xs text-text-secondary">
            Returns around <span className="font-body-medium text-text-primary">{formatRevert(revertDate)}</span>
          </p>
        )}

        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for transfer..." />
        </Field>
      </FormBody>
    </PanelShell>
    {conflictModal}
    </>
  );
};

export default TransferFromCalendarModal;
