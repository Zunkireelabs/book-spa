import React, { useState, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import { giftBirthdayPerk } from '../../../../services/api';

const BirthdayPerkModal = ({ membership, onClose, onSuccess }) => {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: rpcError } = await giftBirthdayPerk({
      membershipId: membership.id,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message || 'Failed to record birthday perk.');
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
        aria-labelledby="birthday-title"
      >
        <form onSubmit={handleSubmit} className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-sm">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <h2 id="birthday-title" className="font-heading font-heading-semibold text-base text-text-primary flex items-center space-x-2">
              <Icon name="Gift" size={16} className="text-accent" />
              <span>Birthday perk</span>
            </h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="bg-accent/5 border border-accent/20 rounded-spa px-3 py-2 flex items-start space-x-2">
              <Icon name="Gift" size={14} className="text-accent flex-shrink-0 mt-0.5" />
              <p className="font-body text-xs text-text-secondary">
                Records a one-time birthday gift for <span className="font-body-medium text-text-primary">{membership.customerName}</span> on
                their {membership.tierName}. Does not move money — the gift is delivered as a free 60-min Massage with Sauna/Jacuzzi.
              </p>
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. Booked for 14 June, served by Asha."
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
              className="px-3 py-2 rounded-spa bg-accent text-white text-sm font-body font-body-medium hover:bg-accent/90 disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5"
            >
              {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span>Record gift</span>
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default BirthdayPerkModal;
