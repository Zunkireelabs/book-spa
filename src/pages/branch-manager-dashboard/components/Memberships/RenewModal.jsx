import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { buildPaymentMethodTree } from '../../../../services/paymentMethods';
import { renewMembership, fetchMembershipTiers } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

// First immediately-selectable leaf value in the tree — a plain method, or a
// group's first sub-method. Mirrors PaymentModal.jsx's default-tender logic.
function firstLeafValue(tree) {
  for (const item of tree) {
    if (!item.subMethods || item.subMethods.length === 0) return item.value;
    if (item.subMethods.length > 0) return item.subMethods[0].value;
  }
  return undefined;
}

const RenewModal = ({ membership, onClose, onSuccess }) => {
  const { profile } = useAuth();
  const { paymentMethods } = useOrg();
  const orgId = profile?.org_id;

  const paymentTree = useMemo(() => buildPaymentMethodTree(paymentMethods), [paymentMethods]);

  const [tiers, setTiers] = useState([]);
  const [tierId, setTierId] = useState(membership.tierId || '');
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState(() => firstLeafValue(paymentTree));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: tErr } = await fetchMembershipTiers(orgId);
      if (cancelled) return;
      if (!tErr && data) setTiers(data);
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const amountNum = Number(amount) || 0;
  const selectedTier = tiers.find((t) => t.id === tierId) || null;
  const tierChanged = tierId && tierId !== membership.tierId;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (amountNum <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    setSubmitting(true);
    const { error: rpcError } = await renewMembership({
      membershipId: membership.id,
      amount: amountNum,
      paymentMode,
      tierId: tierChanged ? tierId : null,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message || 'Failed to renew membership.');
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
        aria-labelledby="renew-title"
      >
        <form onSubmit={handleSubmit} className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-sm">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <h2 id="renew-title" className="font-heading font-heading-semibold text-base text-text-primary">Renew membership</h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="bg-background border border-border rounded-spa px-3 py-2">
              <p className="font-caption text-[10px] uppercase tracking-wide text-text-tertiary">Current balance</p>
              <p className="font-data font-data-medium text-base text-text-primary">{formatNPR(membership.balance)}</p>
              <p className="font-caption text-[11px] text-text-tertiary mt-1">
                Wallet is empty. Renewing starts a fresh cycle from today.
              </p>
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Tier</label>
              <CustomSelect
                value={tierId}
                onChange={setTierId}
                options={tiers.map((t) => ({
                  value: t.id,
                  label: `${t.name} — ${formatNPR(t.advance_amount)} advance`,
                }))}
                placeholder="Select tier"
              />
              {selectedTier && (
                <p className="mt-1.5 font-caption text-xs text-text-tertiary">
                  Valid for {selectedTier.validity_days} days from today.
                  {tierChanged && <span className="text-primary"> · Tier will change from {membership.tierName}.</span>}
                </p>
              )}
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Renewal amount (NPR)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 100000"
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Payment mode</label>
              <PaymentMethodSelector
                value={paymentMode}
                onChange={setPaymentMode}
                paymentMethods={paymentMethods}
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

            <div className="bg-primary/5 border border-primary/20 rounded-spa px-3 py-2 flex items-start space-x-2">
              <Icon name="RefreshCw" size={14} className="text-primary flex-shrink-0 mt-0.5" />
              <p className="font-body text-xs text-text-secondary">
                This resets Activated/Expires to today
                {selectedTier ? ` + ${selectedTier.validity_days} days` : ''} on the same membership card — history stays intact.
              </p>
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
              <span>Renew membership</span>
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default RenewModal;
