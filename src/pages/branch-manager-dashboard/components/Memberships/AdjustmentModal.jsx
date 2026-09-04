import React, { useState, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { adjustMembership } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const AdjustmentModal = ({ membership, branchId, onClose, onSuccess }) => {
  const [direction, setDirection] = useState('credit');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const amountNum = Number(amount) || 0;
  const signedAmount = direction === 'credit' ? amountNum : -amountNum;
  const tooBig = direction === 'debit' && amountNum > Number(membership.balance || 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (amountNum <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    if (!notes.trim()) {
      setError('A note is required for every adjustment.');
      return;
    }
    if (tooBig) {
      setError(`Cannot debit more than the current balance (${formatNPR(membership.balance)}).`);
      return;
    }
    setSubmitting(true);
    const { error: rpcError } = await adjustMembership({
      membershipId: membership.id,
      amount: signedAmount,
      notes: notes.trim(),
      branchId,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message || 'Failed to record adjustment.');
      return;
    }
    onSuccess();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adjust-title"
      >
        <form onSubmit={handleSubmit} className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-sm">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <h2 id="adjust-title" className="font-heading font-heading-semibold text-base text-text-primary">Manual adjustment</h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="bg-warning/5 border border-warning/20 rounded-spa px-3 py-2 flex items-start space-x-2">
              <Icon name="AlertTriangle" size={14} className="text-warning flex-shrink-0 mt-0.5" />
              <p className="font-body text-xs text-text-secondary">
                Admin-only correction. Use for refunds, reversals, or fixing data errors. Every adjustment lands in the audit log
                with the required note.
              </p>
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Direction</label>
              <CustomSelect
                value={direction}
                onChange={setDirection}
                options={[
                  { value: 'credit', label: 'Credit (add to balance)' },
                  { value: 'debit', label: 'Debit (remove from balance)' },
                ]}
              />
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Amount (NPR)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 500"
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              {direction === 'debit' && (
                <p className="mt-1 font-caption text-[11px] text-text-tertiary">Current balance: {formatNPR(membership.balance)}</p>
              )}
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Reason / note <span className="text-error">*</span></label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Required. Explain why this adjustment is being made."
                className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
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
              className="px-3 py-2 rounded-spa border border-border text-sm font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-2 rounded-spa bg-warning text-white text-sm font-body font-body-medium hover:bg-warning/90 disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5"
            >
              {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span>Record adjustment</span>
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default AdjustmentModal;
