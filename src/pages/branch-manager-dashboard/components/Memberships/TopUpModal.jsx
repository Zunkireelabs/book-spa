import React, { useState, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { topUpMembership, MEMBERSHIP_DEPOSIT_MODES } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const TopUpModal = ({ membership, branchId, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const amountNum = Number(amount) || 0;
  const remainingToThreshold = Math.max(0, (membership.tierAdvanceAmount || 0) - (membership.totalDeposited || 0));
  const willActivate = membership.status === 'pending' && amountNum + (membership.totalDeposited || 0) >= (membership.tierAdvanceAmount || 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (amountNum <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    setSubmitting(true);
    const { error: rpcError } = await topUpMembership({
      membershipId: membership.id,
      amount: amountNum,
      paymentMode,
      notes: notes.trim() || null,
      branchId,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message || 'Failed to record top up.');
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
        aria-labelledby="topup-title"
      >
        <form onSubmit={handleSubmit} className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-sm">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <h2 id="topup-title" className="font-heading font-heading-semibold text-base text-text-primary">Top up wallet</h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="bg-background border border-border rounded-spa px-3 py-2">
              <p className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary">Current balance</p>
              <p className="font-data font-data-medium text-base text-text-primary">{formatNPR(membership.balance)}</p>
              {membership.status === 'pending' && remainingToThreshold > 0 && (
                <p className="font-caption text-[11px] text-text-tertiary mt-1">
                  {formatNPR(remainingToThreshold)} more to activate {membership.tierName}.
                </p>
              )}
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Amount (NPR)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 10000"
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Payment mode</label>
              <CustomSelect
                value={paymentMode}
                onChange={setPaymentMode}
                options={MEMBERSHIP_DEPOSIT_MODES.map((m) => ({ value: m, label: m }))}
              />
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional reference"
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            {willActivate && (
              <div className="bg-success/5 border border-success/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                <Icon name="CheckCircle2" size={14} className="text-success flex-shrink-0 mt-0.5" />
                <p className="font-body text-xs text-success">This top up will activate the membership.</p>
              </div>
            )}

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
              className="px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5"
            >
              {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span>Record top up</span>
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default TopUpModal;
