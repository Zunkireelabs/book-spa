import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../AppIcon';
import CustomSelect from './CustomSelect';
import { adminCorrectBooking, adminDeleteBooking } from '../../services/api';

const REASON_MIN = 10;

// Only fields an admin can sensibly retype. The RPC enforces its own, wider
// whitelist server-side; this is the deliberately narrower UI surface, so a
// mis-click cannot rewrite something obscure. Adding a field here is safe only
// if it also appears in the RPC's v_allowed array.
const CORRECTABLE_FIELDS = [
  { value: 'status',          label: 'Status',            kind: 'status' },
  { value: 'base_amount',     label: 'Base amount (NPR)', kind: 'number' },
  { value: 'discount_amount', label: 'Discount (NPR)',    kind: 'number' },
  { value: 'date',            label: 'Date',              kind: 'date'   },
  { value: 'start_time',      label: 'Start time',        kind: 'time'   },
  { value: 'customer_name',   label: 'Customer name',     kind: 'text'   },
  { value: 'customer_phone',  label: 'Customer phone',    kind: 'text'   },
];

const STATUS_OPTIONS = [
  { value: 'Pending',     label: 'Pending' },
  { value: 'Confirmed',   label: 'Confirmed' },
  { value: 'In-Progress', label: 'In-Progress' },
  { value: 'Completed',   label: 'Completed' },
  { value: 'Cancelled',   label: 'Cancelled' },
  { value: 'No Show',     label: 'No Show' },
];

const AdminCorrectionModal = ({ booking, onClose, onSuccess }) => {
  const [mode, setMode] = useState('correct');   // 'correct' | 'delete'
  const [field, setField] = useState('status');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, submitting]);

  // Clear the value whenever the target field changes — carrying a date string
  // over into a numeric field would send nonsense to the RPC.
  useEffect(() => { setValue(''); }, [field]);

  const activeField = useMemo(
    () => CORRECTABLE_FIELDS.find((f) => f.value === field) || CORRECTABLE_FIELDS[0],
    [field],
  );

  const reasonOk = reason.trim().length >= REASON_MIN;
  const deleteConfirmed = confirmText.trim().toUpperCase() === 'DELETE';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!reasonOk) {
      setError(`A reason of at least ${REASON_MIN} characters is required.`);
      return;
    }

    setSubmitting(true);

    if (mode === 'delete') {
      if (!deleteConfirmed) {
        setSubmitting(false);
        setError('Type DELETE to confirm.');
        return;
      }
      const { error: rpcError } = await adminDeleteBooking({
        bookingId: booking.bookingId,
        reason: reason.trim(),
      });
      setSubmitting(false);
      if (rpcError) {
        setError(rpcError.message || 'Failed to delete booking.');
        return;
      }
      onSuccess({ deleted: true });
      return;
    }

    if (value === '' || value === null) {
      setSubmitting(false);
      setError('Enter the corrected value.');
      return;
    }

    const parsed = activeField.kind === 'number' ? Number(value) : value;
    if (activeField.kind === 'number' && Number.isNaN(parsed)) {
      setSubmitting(false);
      setError('Enter a valid number.');
      return;
    }

    const { error: rpcError } = await adminCorrectBooking({
      bookingId: booking.bookingId,
      changes: { [field]: parsed },
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message || 'Failed to correct booking.');
      return;
    }
    onSuccess({ deleted: false });
  };

  const inputClass =
    'w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={submitting ? undefined : onClose} aria-hidden="true" />
      <div
        className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-correction-title"
      >
        <form onSubmit={handleSubmit} className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-md">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <h2 id="admin-correction-title" className="font-heading font-heading-semibold text-base text-text-primary">
              Admin correction
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="p-1.5 rounded-spa hover:bg-background spa-transition-fast disabled:opacity-40"
            >
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="bg-warning/5 border border-warning/20 rounded-spa px-3 py-2 flex items-start space-x-2">
              <Icon name="AlertTriangle" size={14} className="text-warning flex-shrink-0 mt-0.5" />
              <p className="font-body text-xs text-text-secondary">
                This booking is normally frozen{booking?.isLocked ? ' because its day is closed' : ''}. Changing it alters figures
                that may already have been reconciled. Every change is recorded in the audit log with your reason.
              </p>
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Action</label>
              <CustomSelect
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'correct', label: 'Correct a field' },
                  { value: 'delete',  label: 'Delete permanently' },
                ]}
              />
            </div>

            {mode === 'correct' ? (
              <>
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Field</label>
                  <CustomSelect value={field} onChange={setField} options={CORRECTABLE_FIELDS} />
                </div>

                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Corrected value</label>
                  {activeField.kind === 'status' ? (
                    <CustomSelect value={value} onChange={setValue} options={STATUS_OPTIONS} placeholder="Select status" />
                  ) : (
                    <input
                      type={activeField.kind === 'number' ? 'number' : activeField.kind === 'date' ? 'date' : activeField.kind === 'time' ? 'time' : 'text'}
                      step={activeField.kind === 'number' ? 'any' : undefined}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      className={inputClass}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 space-y-2">
                <p className="font-body text-xs text-error">
                  Deleting removes this booking entirely. It will disappear from past reports that counted it. A booking with a
                  payment, refund, referral or package redemption attached cannot be deleted — cancel it instead.
                </p>
                <div>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">
                    Type <span className="font-data">DELETE</span> to confirm
                  </label>
                  <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={inputClass} />
                </div>
              </div>
            )}

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">
                Reason <span className="text-error">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Required. Explain what was wrong and why this change is correct."
                className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
              {!reasonOk && reason.length > 0 && (
                <p className="mt-1 font-caption text-[11px] text-text-tertiary">
                  {REASON_MIN - reason.trim().length} more character{REASON_MIN - reason.trim().length === 1 ? '' : 's'} needed.
                </p>
              )}
            </div>

            {error && (
              <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                <p className="font-body text-xs text-error">{error}</p>
              </div>
            )}
          </div>

          <div className="border-t border-border px-5 py-3 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-2 rounded-spa border border-border text-sm font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !reasonOk || (mode === 'delete' && !deleteConfirmed)}
              className={`px-3 py-2 rounded-spa text-white text-sm font-body font-body-medium disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5 ${
                mode === 'delete' ? 'bg-error hover:bg-error/90' : 'bg-warning hover:bg-warning/90'
              }`}
            >
              {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span>{mode === 'delete' ? 'Delete booking' : 'Apply correction'}</span>
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default AdminCorrectionModal;
