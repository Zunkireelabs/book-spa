import React, { useState, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import Select from '../../../../components/ui/Select';
import Input from '../../../../components/ui/Input';
import Button from '../../../../components/ui/Button';
import { transferTherapist, fetchAllBranches } from '../../../../services/api';

const DURATION_UNIT_OPTIONS = [
  { value: 'minute', label: 'Minute' },
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

// Same client-side revert-time estimate as AttendancePanel.jsx's transfer modal — the
// server (transfer_therapist(), migration-145) independently computes the authoritative
// revert_at; this is just a preview line before confirming.
function computeRevertPreview(dateStr, timeStr, value, unit) {
  if (!dateStr || !timeStr || !value || !unit) return null;
  const start = new Date(`${dateStr}T${timeStr}`);
  if (Number.isNaN(start.getTime())) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  let revert;
  if (unit === 'month') {
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

// Transfer-creation entry point reachable from the Calendar's empty-slot choice menu —
// mirrors AttendancePanel.jsx's transfer modal (creation half only, no extend/revert/cancel
// management UI, which stays Attendance-panel-only) so both entry points call the exact
// same transferTherapist() API and produce identical staff_transfers rows.
const TransferFromCalendarModal = ({ therapistId, therapistName, currentBranchId, defaultDate, defaultTime, onClose, onSuccess }) => {
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
    onSuccess?.();
  };

  return (
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !submitting && onClose()}>
      <div className="bg-surface rounded-spa-lg shadow-spa-modal max-w-md w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary">Transfer Therapist</h3>
          <button onClick={() => !submitting && onClose()} className="p-1 rounded hover:bg-background">
            <Icon name="X" size={18} className="text-text-secondary" />
          </button>
        </div>

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
          {isPermanent ? (
            <>Move <span className="font-body-medium text-text-primary">"{therapistName}"</span> to another branch permanently.</>
          ) : (
            <>Move <span className="font-body-medium text-text-primary">"{therapistName}"</span> to another branch for a set duration. They'll automatically return once it elapses.</>
          )}
        </p>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
            <Icon name="AlertCircle" size={16} />
            <span>{error}</span>
          </div>
        )}

        <Select
          label="Destination Branch"
          placeholder="Select a branch..."
          options={orgBranches.filter(b => b.id !== currentBranchId).map(b => ({ value: b.id, label: b.name }))}
          value={toBranch}
          onChange={setToBranch}
        />

        <div className={isPermanent ? '' : 'grid grid-cols-2 gap-3'}>
          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {!isPermanent && (
            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Transfer Time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
        </div>

        {!isPermanent && (
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Duration Unit"
              placeholder="Select unit..."
              options={DURATION_UNIT_OPTIONS}
              value={durationUnit}
              onChange={setDurationUnit}
            />
            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Duration</label>
              <Input
                type="number"
                min="1"
                value={durationValue}
                onChange={(e) => setDurationValue(e.target.value)}
                placeholder="e.g. 2"
              />
            </div>
          </div>
        )}

        {!isPermanent && isFormComplete && (
          <p className="font-caption text-xs text-text-tertiary">
            Will automatically move back around{' '}
            <span className="font-body-medium text-text-secondary">
              {computeRevertPreview(startDate, startTime, durationValue, durationUnit)}
            </span>.
          </p>
        )}

        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Note (optional)</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for transfer..." />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={submitting} disabled={!isFormComplete}>
            {startDate && startDate > new Date().toISOString().split('T')[0] ? 'Schedule Transfer' : 'Transfer'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TransferFromCalendarModal;
