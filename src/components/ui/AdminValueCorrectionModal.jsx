import React, { useState, useEffect } from 'react';
import Icon from '../AppIcon';

const REASON_MIN = 10;

/**
 * Small admin-only "retype the correct figure" dialog, shared by the voucher
 * balance and package session corrections.
 *
 * Deliberately generic over the *value*, not over the *operation*: the caller
 * supplies `onSubmit`, so each entity keeps its own RPC and its own refusal
 * messages (a claim linked to a payment, sessions already redeemed) rather than
 * this component trying to know about any of them.
 *
 * @param {string}   title        dialog heading
 * @param {string}   label        field label, e.g. "Correct remaining balance"
 * @param {string}   currentLabel human-readable current value, shown for contrast
 * @param {'number'|'integer'} kind
 * @param {string}   warning      what the admin should understand before saving
 * @param {Function} onSubmit     async ({ value, reason }) => ({ error })
 */
const AdminValueCorrectionModal = ({
  title,
  label,
  currentLabel,
  kind = 'number',
  warning,
  onSubmit,
  onClose,
  onSuccess,
}) => {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, submitting]);

  const reasonOk = reason.trim().length >= REASON_MIN;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (value === '') {
      setError('Enter the corrected value.');
      return;
    }
    const num = Number(value);
    if (Number.isNaN(num)) {
      setError('Enter a valid number.');
      return;
    }
    if (kind === 'integer' && !Number.isInteger(num)) {
      setError('Enter a whole number.');
      return;
    }
    if (num < 0) {
      setError('Value cannot be negative.');
      return;
    }
    if (!reasonOk) {
      setError(`A reason of at least ${REASON_MIN} characters is required.`);
      return;
    }

    setSubmitting(true);
    const { error: rpcError } = await onSubmit({ value: num, reason: reason.trim() });
    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message || 'Correction failed.');
      return;
    }
    onSuccess();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={submitting ? undefined : onClose} aria-hidden="true" />
      <div
        className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-value-correction-title"
      >
        <form onSubmit={handleSubmit} className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-sm">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <h2 id="admin-value-correction-title" className="font-heading font-heading-semibold text-base text-text-primary">
              {title}
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
              <p className="font-body text-xs text-text-secondary">{warning}</p>
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">{label}</label>
              <input
                type="number"
                min="0"
                step={kind === 'integer' ? '1' : 'any'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <p className="mt-1 font-caption text-[11px] text-text-tertiary">Currently: {currentLabel}</p>
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">
                Reason <span className="text-error">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Required. Explain what was wrong and why this figure is correct."
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
              disabled={submitting || !reasonOk}
              className="px-3 py-2 rounded-spa bg-warning text-white text-sm font-body font-body-medium hover:bg-warning/90 disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5"
            >
              {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span>Apply correction</span>
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default AdminValueCorrectionModal;
