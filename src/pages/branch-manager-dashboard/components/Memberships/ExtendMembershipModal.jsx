import React, { useState, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import { extendMembership } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Suggests today + the tier's validity window as a starting point -- admin can
// still pick any future date.
function suggestedExpiry(validityDays) {
  const d = new Date();
  d.setDate(d.getDate() + (Number(validityDays) > 0 ? Number(validityDays) : 365));
  return d.toISOString().slice(0, 10);
}

const ExtendMembershipModal = ({ membership, branchId, onClose, onSuccess }) => {
  const [newExpiryDate, setNewExpiryDate] = useState(() => suggestedExpiry(membership.tierValidityDays));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const minDate = tomorrowIso();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!newExpiryDate || newExpiryDate <= todayIso()) {
      setError('New expiry date must be after today.');
      return;
    }
    setSubmitting(true);
    const { error: rpcError } = await extendMembership({
      membershipId: membership.id,
      newExpiryDate,
      notes: notes.trim() || null,
      branchId,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message || 'Failed to extend membership.');
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
        aria-labelledby="extend-title"
      >
        <form onSubmit={handleSubmit} className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-sm">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <h2 id="extend-title" className="font-heading font-heading-semibold text-base text-text-primary">Reactivate membership</h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="bg-background border border-border rounded-spa px-3 py-2">
              <p className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary">{membership.tierName}</p>
              <p className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary mt-2">Current balance</p>
              <p className="font-data font-data-medium text-base text-text-primary">{formatNPR(membership.balance)}</p>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-spa px-3 py-2 flex items-start space-x-2">
              <Icon name="Info" size={14} className="text-primary flex-shrink-0 mt-0.5" />
              <p className="font-body text-xs text-text-secondary">
                This membership has lapsed, but the remaining balance is still available. Extend the validity period to
                continue using the existing balance — no new payment is needed.
              </p>
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">New expiry date</label>
              <input
                type="date"
                min={minDate}
                value={newExpiryDate}
                onChange={(e) => setNewExpiryDate(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
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
              <span>Extend membership</span>
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default ExtendMembershipModal;
