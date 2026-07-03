import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import PaymentMethodSelector from './PaymentMethodSelector';
import { fetchMembershipForBooking } from '../../services/api';
import { buildPaymentMethodTree } from '../../services/paymentMethods';
import { useOrg } from '../../contexts/OrgContext';

// First immediately-selectable leaf value in the tree — a plain method, or a
// group's first sub-method (the group name itself isn't selectable once it has
// sub-methods). Used to seed the default tender payment mode.
function firstLeafValue(tree) {
  for (const item of tree) {
    if (!item.subMethods || item.subMethods.length === 0) return item.value;
    if (item.subMethods.length > 0) return item.subMethods[0].value;
  }
  return undefined;
}

const MEMBERSHIP_STATUS_STYLES = {
  active:   { container: 'bg-primary/5 border-primary/20',    pill: 'bg-success/10 text-success',  label: 'Active' },
  pending:  { container: 'bg-amber-50 border-amber-200',      pill: 'bg-amber-100 text-amber-800', label: 'Pending' },
  lapsed:   { container: 'bg-warning/5 border-warning/20',    pill: 'bg-warning/10 text-warning',  label: 'Lapsed' },
  depleted: { container: 'bg-gray-50 border-gray-200',        pill: 'bg-gray-100 text-gray-600',   label: 'Depleted' },
};

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const PaymentModal = ({
  booking,
  additionalBookings = [],
  onConfirm,
  onClose,
  isSubmitting,
  dueHolderSuggestions = [],
}) => {
  const { paymentMethods } = useOrg();
  const PAYMENT_TREE = useMemo(
    () => buildPaymentMethodTree(paymentMethods),
    [paymentMethods]
  );

  const hasPreviousDue = additionalBookings.length > 0;

  // Remaining balance for any booking-like object — prefers a precomputed amountDue
  // (e.g. from getCustomerOutstandingBalance) and otherwise derives it from
  // final_amount minus whatever's already been paid, so a partially-paid bundled
  // booking is charged its true remainder, not its full original amount.
  const bookingRemaining = (b) => {
    if (b.amountDue !== undefined && b.amountDue !== null) return Number(b.amountDue);
    const already = Number(b.amountPaid ?? b.amount_paid ?? 0);
    const final = Number(b.final_amount || b.finalAmount || b.base_amount || b.baseAmount || 0);
    return Math.max(round2(final - already), 0);
  };

  const finalAmount = Number(booking.final_amount || booking.finalAmount || 0);
  const alreadyPaid = round2(booking.amountPaid || booking.amount_paid || 0);
  const remaining = round2(Math.max(finalAmount - alreadyPaid, 0));

  const additionalRemaining = round2(additionalBookings.reduce((s, b) => s + bookingRemaining(b), 0));
  const grandTotal = round2(remaining + additionalRemaining);

  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  // Split payment — one or more tenders, always available (even when a previous
  // due is bundled in) so staff can pay across multiple methods or leave part
  // unpaid, rather than being forced into a single payment mode for everything.
  const [tenders, setTenders] = useState([{ amount: String(grandTotal || ''), paymentMode: firstLeafValue(PAYMENT_TREE) }]);
  const [dueHolderName, setDueHolderName] = useState(booking.dueHolderName || booking.due_holder_name || '');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // --- membership wallet (Phase 3) ---
  const [membership, setMembership] = useState(null);
  const bookingId = booking.bookingId || booking.id;
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    (async () => {
      const { data } = await fetchMembershipForBooking(bookingId);
      if (!cancelled) setMembership(data || null);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  // The Membership option is added to the mode selector only when there's a
  // wallet attached to this booking's customer AND the wallet still has balance.
  const membershipUsable = membership && membership.balance > 0 && membership.status !== 'depleted';
  const membershipLeaf = membershipUsable
    ? { value: 'Membership', label: `Membership (${membership.tierName})` }
    : null;

  // How much of the Membership wallet is already committed by other tenders in
  // this submission. Used to cap each Membership tender input.
  const membershipCommitted = useMemo(() => {
    if (!membershipUsable) return 0;
    return round2(
      tenders.reduce((s, t) => s + (t.paymentMode === 'Membership' && Number(t.amount) > 0 ? Number(t.amount) : 0), 0)
    );
  }, [tenders, membershipUsable]);
  const walletRemaining = membershipUsable ? Math.max(0, round2(membership.balance - membershipCommitted)) : 0;

  const entered = useMemo(
    () => round2(tenders.reduce((s, t) => s + (Number(t.amount) > 0 ? Number(t.amount) : 0), 0)),
    [tenders]
  );
  const leftover = round2(Math.max(grandTotal - entered, 0));

  const filteredSuggestions = useMemo(() => {
    const q = dueHolderName.trim().toLowerCase();
    return dueHolderSuggestions
      .filter(n => n && n.toLowerCase().includes(q) && n.toLowerCase() !== q)
      .slice(0, 6);
  }, [dueHolderName, dueHolderSuggestions]);

  const updateTender = (i, patch) => {
    setTenders(prev => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };
  const addTender = () => setTenders(prev => [...prev, { amount: '', paymentMode: firstLeafValue(PAYMENT_TREE) }]);
  const removeTender = (i) => setTenders(prev => prev.filter((_, idx) => idx !== i));

  // Waterfall-allocate the entered tenders: the primary booking first (up to its
  // own remaining — this is the only place a partial "leave as due" applies), then
  // each additional/previous-due booking in listed order, fully or not at all —
  // an additional booking is never left partially paid, it's either fully covered
  // by what's left in the pool or skipped (stays untouched, still fully due).
  const allocateTenders = (cleanedTenders) => {
    const pool = cleanedTenders.map(t => ({ ...t }));
    let idx = 0;
    const poolRemaining = () => round2(pool.slice(idx).reduce((s, t) => s + t.amount, 0));
    const take = (target) => {
      const consumed = [];
      let needed = target;
      while (needed > 0.001 && idx < pool.length) {
        const t = pool[idx];
        const amt = Math.min(t.amount, needed);
        if (amt > 0) {
          consumed.push({ amount: round2(amt), paymentMode: t.paymentMode });
          t.amount = round2(t.amount - amt);
          needed = round2(needed - amt);
        }
        if (t.amount <= 0.001) idx++;
      }
      return consumed;
    };

    const primaryTenders = take(remaining);
    const additionalAllocations = [];
    for (const pb of additionalBookings) {
      const need = bookingRemaining(pb);
      if (poolRemaining() + 0.001 >= need) {
        additionalAllocations.push({ bookingId: pb.bookingId, tenders: take(need) });
      }
    }
    return { primaryTenders, additionalAllocations };
  };

  const handleSubmit = async () => {
    if (entered <= 0) {
      setError('Enter a payment amount.');
      return;
    }
    if (entered > grandTotal) {
      setError(`Entered amount (${formatNPR(entered)}) exceeds the total due (${formatNPR(grandTotal)}).`);
      return;
    }
    if (leftover > 0 && !dueHolderName.trim()) {
      setError('Enter who the remaining due is under before leaving a balance unpaid.');
      return;
    }
    if (membershipUsable && membershipCommitted > membership.balance) {
      setError(`Membership tenders total ${formatNPR(membershipCommitted)} but the wallet balance is only ${formatNPR(membership.balance)}.`);
      return;
    }
    setError(null);
    const cleanedTenders = tenders
      .filter(t => Number(t.amount) > 0)
      .map(t => ({ amount: round2(t.amount), paymentMode: t.paymentMode }));
    const { primaryTenders, additionalAllocations } = allocateTenders(cleanedTenders);
    const result = await onConfirm({
      tenders: primaryTenders,
      additionalAllocations,
      dueHolderName: leftover > 0 ? dueHolderName.trim() : '',
      notes,
    });
    if (result?.error) setError(result.error.message || 'Failed to record payment.');
  };

  return (
    <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal-overlay flex items-center justify-center p-4">
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
              <Icon name="CreditCard" size={20} className="text-success" />
            </div>
            <div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
                Record Payment
              </h2>
              <p className="font-caption font-caption-normal text-sm text-text-secondary">
                {booking.booking_number || booking.id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-spa hover:bg-background spa-transition-fast spa-touch-target"
          >
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Financial Summary (read-only) */}
          <div className="bg-background rounded-spa p-4 space-y-3">
            <h4 className="font-heading font-heading-medium text-sm text-text-secondary uppercase tracking-wider">
              Payment Summary
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-body font-body-normal text-sm text-text-secondary truncate pr-2">
                  {booking.service?.name || booking.service || 'This booking'}
                </span>
                <span className="font-body font-body-medium text-sm text-text-primary flex-shrink-0">
                  {formatNPR(remaining)}
                </span>
              </div>
              {!hasPreviousDue && alreadyPaid > 0 && (
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">Already paid</span>
                  <span className="font-body font-body-medium text-sm text-success">- {formatNPR(alreadyPaid)}</span>
                </div>
              )}
              {hasPreviousDue && (
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-warning">
                    Previous due ({additionalBookings.length})
                  </span>
                  <span className="font-body font-body-medium text-sm text-warning flex-shrink-0">
                    {formatNPR(additionalRemaining)}
                  </span>
                </div>
              )}
              <div className="border-t border-border pt-2 flex items-center justify-between">
                <span className="font-body font-body-semibold text-base text-text-primary">
                  {hasPreviousDue ? 'Total Due' : 'Balance Due'}
                </span>
                <span className="font-heading font-heading-semibold text-lg text-success">
                  {formatNPR(grandTotal)}
                </span>
              </div>
            </div>
          </div>

          {/* Membership wallet banner (Phase 3) — surfaces when this booking's
              customer has a wallet. Active = primary color, lapsed = warning, depleted = gray. */}
          {membership && (() => {
            const styleKey = membership.status || 'pending';
            const styles = MEMBERSHIP_STATUS_STYLES[styleKey] || MEMBERSHIP_STATUS_STYLES.pending;
            return (
              <div className={`rounded-spa border ${styles.container} px-3 py-2.5`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 min-w-0">
                    <Icon name="Wallet" size={14} className="text-primary flex-shrink-0" />
                    <span className="font-body font-body-medium text-sm text-text-primary truncate">{membership.tierName}</span>
                    {membership.membershipNumber && (
                      <span className="font-data font-data-medium text-[11px] tracking-widest text-text-secondary">{membership.membershipNumber}</span>
                    )}
                    <span className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[10px] font-caption font-caption-medium ${styles.pill}`}>
                      {styles.label}
                    </span>
                  </div>
                  <span className="font-data font-data-medium text-sm text-primary flex-shrink-0">{formatNPR(membership.balance)}</span>
                </div>
                {membership.status === 'lapsed' && (
                  <p className="mt-1.5 font-caption text-[11px] text-warning">
                    Membership expired on {membership.expiryDate || '—'}. Wallet balance is still spendable but
                    discount privileges no longer apply.
                  </p>
                )}
                {membership.status === 'pending' && (
                  <p className="mt-1.5 font-caption text-[11px] text-amber-700">
                    Pending activation — wallet is not yet usable for booking payments. Top up to NPR {Number(membership.tierAdvanceAmount).toLocaleString('en-IN')} to activate.
                  </p>
                )}
                {membership.status === 'depleted' && (
                  <p className="mt-1.5 font-caption text-[11px] text-text-tertiary">
                    Wallet is depleted.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Split payment — one or more tenders, even when a previous due is bundled in */}
          <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block font-body font-body-medium text-sm text-text-primary">
                  Payment Method{tenders.length > 1 ? 's' : ''}
                </label>
                <button
                  type="button"
                  onClick={addTender}
                  className="flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <Icon name="Plus" size={14} /> Add method
                </button>
              </div>

              {tenders.map((t, i) => {
                const isMembership = t.paymentMode === 'Membership';
                const overWallet = isMembership && Number(t.amount) > Number(membership?.balance || 0);
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-36 flex-shrink-0">
                        <PaymentMethodSelector
                          paymentMethods={paymentMethods}
                          extraLeaf={membershipLeaf}
                          value={t.paymentMode}
                          onChange={(v) => updateTender(i, { paymentMode: v })}
                          size="md"
                        />
                      </div>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">NPR</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={t.amount}
                          onChange={(e) => updateTender(i, { amount: e.target.value })}
                          placeholder="0"
                          className={`w-full rounded-spa border bg-surface pl-11 pr-3 py-2 font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 spa-transition-fast ${overWallet ? 'border-error focus:border-error' : 'border-border focus:border-primary'}`}
                        />
                      </div>
                      {tenders.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTender(i)}
                          className="p-2 rounded-spa hover:bg-error/10 text-error spa-transition-fast"
                          aria-label="Remove method"
                        >
                          <Icon name="Trash2" size={16} />
                        </button>
                      )}
                    </div>
                    {isMembership && (
                      <p className={`text-[11px] font-caption ml-[8.5rem] ${overWallet ? 'text-error' : 'text-text-tertiary'}`}>
                        {overWallet
                          ? `Exceeds wallet balance (${formatNPR(membership?.balance || 0)}).`
                          : `Wallet available: ${formatNPR(walletRemaining)}`}
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Entered / leftover */}
              <div className="flex items-center justify-between text-sm pt-1">
                <span className="text-text-secondary">Entered</span>
                <span className="font-data text-text-primary">{formatNPR(entered)}</span>
              </div>
              {leftover > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-warning font-body-medium">Leave as due</span>
                  <span className="font-data text-warning font-body-medium">{formatNPR(leftover)}</span>
                </div>
              )}

              {/* Due holder (required when leaving a balance) */}
              {leftover > 0 && (
                <div className="space-y-1 relative">
                  <label className="block font-body font-body-medium text-sm text-text-primary">
                    Due under <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={dueHolderName}
                    onChange={(e) => { setDueHolderName(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    placeholder="Type the responsible person's name..."
                    className="w-full rounded-spa border border-border bg-surface px-3 py-2 font-body text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary spa-transition-fast"
                  />
                  {showSuggestions && filteredSuggestions.length > 0 && (
                    <div className="absolute z-dropdown left-0 right-0 mt-1 bg-surface border border-border rounded-spa shadow-spa-elevated max-h-44 overflow-y-auto">
                      {filteredSuggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={() => { setDueHolderName(name); setShowSuggestions(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-background spa-transition-fast"
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">
              Notes <span className="text-text-secondary font-body-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this payment..."
              rows={2}
              className="w-full rounded-spa border border-border bg-surface px-3 py-2 font-body font-body-normal text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary spa-transition-fast resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start space-x-2 p-3 bg-error/5 border border-error/20 rounded-spa">
              <Icon name="AlertCircle" size={16} className="text-error mt-0.5 shrink-0" />
              <p className="font-body font-body-normal text-sm text-error">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-5 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="success"
            onClick={handleSubmit}
            loading={isSubmitting}
            disabled={entered <= 0}
            iconName="Check"
            iconPosition="left"
          >
            {leftover > 0 ? 'Record & Leave Due' : 'Confirm Payment'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;
