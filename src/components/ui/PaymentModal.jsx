import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import PaymentMethodSelector from './PaymentMethodSelector';
import MembershipWalletCard from './MembershipWalletCard';
import ReferralRewardCard from './ReferralRewardCard';
import VoucherWalletCard from './VoucherWalletCard';
import {
  fetchMembershipForBooking,
  fetchReferralRewardForBooking,
  fetchPendingReferralRewardsForBooking,
  resolveCustomerReferralReward,
  searchVouchersForPayment,
  fetchVouchersForBooking,
} from '../../services/api';
import { buildPaymentMethodTree } from '../../services/paymentMethods';
import { addTenderRow, removeTenderRow, updateTenderRow } from '../../utils/tenderRows';
import { useOrg } from '../../contexts/OrgContext';
import { useAuth } from '../../contexts/AuthContext';
import { MEMBERSHIP_ENABLED, CUSTOMER_REFERRALS_ENABLED, VOUCHER_ENABLED } from '../../lib/featureFlags';

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
  const { profile } = useAuth();
  const userRole = profile?.role || 'staff';
  const canResolveReferralReward = ['manager', 'admin'].includes(userRole);
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
    const final = Number(b.final_amount ?? b.finalAmount ?? b.base_amount ?? b.baseAmount ?? 0);
    return Math.max(round2(final - already), 0);
  };

  const finalAmount = Number(booking.final_amount ?? booking.finalAmount ?? 0);
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
  // `memberships` SELECT RLS covers manager/admin/admin_viewer/staff
  // (migration-080, reopened to staff by migration-088) — every role sees the
  // exact same balance/status at checkout, no role branching needed here.
  const [membership, setMembership] = useState(null);
  const bookingId = booking.bookingId || booking.id;
  useEffect(() => {
    if (!MEMBERSHIP_ENABLED || !bookingId) return;
    let cancelled = false;
    (async () => {
      const { data } = await fetchMembershipForBooking(bookingId);
      if (!cancelled) setMembership(data || null);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  // The Membership option is added to the mode selector only when there's a
  // wallet attached to this booking's customer AND the wallet still has balance.
  const membershipUsable = !!(membership && membership.balance > 0 && membership.status !== 'depleted');
  const membershipLeaf = membershipUsable
    ? { value: 'Membership', label: 'Membership' }
    : null;

  // Once the membership wallet loads, default the tender to it when the balance
  // fully covers the total due — otherwise staff have to notice the wallet card
  // and manually switch off Cash. Only fires while the tender is still untouched
  // (pristine), so it never overwrites a choice staff already made.
  useEffect(() => {
    if (!membershipUsable || membership.balance < grandTotal) return;
    const pristine = tenders.length === 1
      && tenders[0].paymentMode === firstLeafValue(PAYMENT_TREE)
      && tenders[0].amount === String(grandTotal || '');
    if (pristine) {
      setTenders([{ amount: String(grandTotal || ''), paymentMode: 'Membership' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipUsable, membership?.balance, grandTotal]);

  // How much of the Membership wallet is already committed by other tenders in
  // this submission. Used to cap each Membership tender input.
  const membershipCommitted = useMemo(() => {
    if (!membershipUsable) return 0;
    return round2(
      tenders.reduce((s, t) => s + (t.paymentMode === 'Membership' && Number(t.amount) > 0 ? Number(t.amount) : 0), 0)
    );
  }, [tenders, membershipUsable]);
  const walletRemaining = membershipUsable ? Math.max(0, round2(membership.balance - membershipCommitted)) : 0;

  // --- referral reward wallet + voucher (migration-070) ---
  const [referralReward, setReferralReward] = useState(null);
  useEffect(() => {
    if (!CUSTOMER_REFERRALS_ENABLED || !bookingId) return;
    let cancelled = false;
    (async () => {
      const { data } = await fetchReferralRewardForBooking(bookingId);
      if (!cancelled) setReferralReward(data || null);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  const referralWalletUsable = referralReward && referralReward.walletBalance > 0;
  const referralWalletLeaf = referralWalletUsable
    ? { value: 'ReferralWallet', label: 'Referral Wallet' }
    : null;

  // Referral rewards are a bonus on top of normal payment — unlike Membership,
  // there's no auto-select default here; staff opt in explicitly (or leave the
  // reward untouched for the customer's next visit).
  const referralWalletCommitted = useMemo(() => {
    if (!referralWalletUsable) return 0;
    return round2(
      tenders.reduce((s, t) => s + (t.paymentMode === 'ReferralWallet' && Number(t.amount) > 0 ? Number(t.amount) : 0), 0)
    );
  }, [tenders, referralWalletUsable]);
  const referralWalletRemaining = referralWalletUsable
    ? Math.max(0, round2(referralReward.walletBalance - referralWalletCommitted))
    : 0;

  const appliedVoucherReferralIds = useMemo(
    () => tenders.filter(t => t.paymentMode === 'ReferralVoucher').map(t => t.referralId),
    [tenders]
  );
  const availableVouchers = useMemo(
    () => (referralReward?.vouchers || []).filter(v => !appliedVoucherReferralIds.includes(v.referralId)),
    [referralReward, appliedVoucherReferralIds]
  );

  const applyReferralVoucher = (voucher) => {
    setTenders(prev => [
      ...prev,
      { amount: String(voucher.value), paymentMode: 'ReferralVoucher', referralId: voucher.referralId, voucherLabel: voucher.label },
    ]);
  };

  // --- voucher wallet (migration-075/084/090) ---
  // A single "Voucher" payment method — no separate "search" entry, to avoid
  // two confusingly-similar dropdown options. This booking's own customer's
  // linked, non-expired vouchers (migration-082's optional p_customer_id at
  // issuance) are pooled into ONE combined balance — same UX as Membership/
  // Referral Wallet: staff picks "Voucher", types an amount, done
  // (record_voucher_wallet_payment_pooled draws it from those vouchers
  // server-side). A VoucherWallet tender with no voucherId is always treated
  // as this pooled draw at submit time. Picking a *specific* voucher (a
  // walk-in/gift voucher not linked to this customer) is still possible via
  // the "Use a specific voucher code" link inside the row, which reveals the
  // manual search box (t.manualSearch, a local UI-only flag) — once a voucher
  // is picked there, that tender carries a voucherId and is redeemed
  // individually via record_voucher_wallet_payment, same as before.
  const [customerVouchers, setCustomerVouchers] = useState([]);
  useEffect(() => {
    if (!VOUCHER_ENABLED || !bookingId) return;
    let cancelled = false;
    (async () => {
      const { data } = await fetchVouchersForBooking(bookingId);
      if (!cancelled) setCustomerVouchers(data || []);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  const voucherPoolBalance = useMemo(
    () => round2(customerVouchers.reduce((s, v) => s + Number(v.remaining_balance || 0), 0)),
    [customerVouchers]
  );
  const voucherPoolUsable = voucherPoolBalance > 0;
  const voucherLeaf = VOUCHER_ENABLED ? { value: 'VoucherWallet', label: 'Voucher' } : null;

  const voucherPoolCommitted = useMemo(() => {
    if (!voucherPoolUsable) return 0;
    return round2(
      tenders.reduce((s, t) => s + (t.paymentMode === 'VoucherWallet' && !t.voucherId && Number(t.amount) > 0 ? Number(t.amount) : 0), 0)
    );
  }, [tenders, voucherPoolUsable]);

  const voucherWalletCommittedByVoucher = useMemo(() => {
    const map = new Map();
    tenders.forEach((t) => {
      if (t.paymentMode === 'VoucherWallet' && t.voucherId && Number(t.amount) > 0) {
        map.set(t.voucherId, round2((map.get(t.voucherId) || 0) + Number(t.amount)));
      }
    });
    return map;
  }, [tenders]);

  // One entry per distinct voucher referenced by any tender (all tenders for
  // the same voucherId carry the same voucherRemainingBalance, set when it
  // was picked) — used to validate committed amounts against each voucher's
  // own balance in handleSubmit.
  const appliedVoucherBalances = useMemo(() => {
    const map = new Map();
    tenders.forEach((t) => {
      if (t.paymentMode === 'VoucherWallet' && t.voucherId && !map.has(t.voucherId)) {
        map.set(t.voucherId, { code: t.voucherLabel, remainingBalance: t.voucherRemainingBalance });
      }
    });
    return Array.from(map.entries()).map(([voucherId, v]) => ({ voucherId, ...v }));
  }, [tenders]);

  const selectVoucherForTender = (i, v) => {
    updateTender(i, {
      voucherId: v.voucher_id,
      voucherLabel: v.voucher_code,
      voucherRemainingBalance: Number(v.remaining_balance),
      amount: String(round2(Math.min(Number(v.remaining_balance), Math.max(leftover, 0) || Number(v.remaining_balance)))),
    });
  };

  // --- pending self-service referral reward this customer earned as a referrer
  // (migration-072's "requires_manual_reward" — the customer flow never
  // auto-credits a self-service referral, so we prompt staff here at their
  // next checkout instead of relying on someone reopening the referred
  // customer's own booking). Always credited as wallet — see migration-076. ---
  const [pendingReferralRewards, setPendingReferralRewards] = useState([]);
  const [rewardAmount, setRewardAmount] = useState('');
  const [rewardSubmitting, setRewardSubmitting] = useState(false);
  const [rewardError, setRewardError] = useState(null);

  useEffect(() => {
    if (!CUSTOMER_REFERRALS_ENABLED || !bookingId) return;
    let cancelled = false;
    (async () => {
      const { data } = await fetchPendingReferralRewardsForBooking(bookingId);
      if (!cancelled) setPendingReferralRewards(data || []);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  const activePendingReward = pendingReferralRewards[0] || null;

  useEffect(() => {
    setRewardAmount('');
    setRewardError(null);
  }, [activePendingReward?.referralId]);

  const handleResolveReferralReward = async () => {
    if (!activePendingReward?.referralId) return;
    setRewardSubmitting(true);
    setRewardError(null);
    try {
      const { error } = await resolveCustomerReferralReward({
        referralId: activePendingReward.referralId,
        rewardType: 'wallet',
        rewardAmount: rewardAmount ? Number(rewardAmount) : null,
        rewardCatalogId: null,
      });
      if (error) {
        setRewardError(error.message || 'Failed to save reward. Please try again.');
        return;
      }
      setPendingReferralRewards(prev => prev.filter(r => r.referralId !== activePendingReward.referralId));
    } catch (err) {
      setRewardError(err?.message || 'Failed to save reward. Please try again.');
    } finally {
      setRewardSubmitting(false);
    }
  };

  // Blocks final payment only when the reward is actually resolvable here (staff
  // without manager/admin rights can't call resolve_customer_referral_reward at
  // all, so they aren't blocked — the reward just waits for a manager/admin).
  const referralRewardBlocksPayment = !!activePendingReward && canResolveReferralReward;

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

  const updateTender = (i, patch) => updateTenderRow(setTenders, i, patch);
  const addTender = () => addTenderRow(setTenders, { amount: '', paymentMode: firstLeafValue(PAYMENT_TREE) });
  const removeTender = (i) => removeTenderRow(setTenders, i);

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
          consumed.push({
            amount: round2(amt),
            paymentMode: t.paymentMode,
            ...(t.paymentMode === 'ReferralVoucher' ? { referralId: t.referralId } : {}),
            ...(t.paymentMode === 'VoucherWallet' ? { voucherId: t.voucherId } : {}),
          });
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
    if (referralRewardBlocksPayment) {
      setError('Apply this customer\'s referral wallet reward before completing payment.');
      return;
    }
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
    if (referralWalletUsable && referralWalletCommitted > referralReward.walletBalance) {
      setError(`Referral wallet tenders total ${formatNPR(referralWalletCommitted)} but the balance is only ${formatNPR(referralReward.walletBalance)}.`);
      return;
    }
    if (voucherPoolUsable && voucherPoolCommitted > voucherPoolBalance) {
      setError(`Voucher tenders total ${formatNPR(voucherPoolCommitted)} but the voucher balance is only ${formatNPR(voucherPoolBalance)}.`);
      return;
    }
    for (const v of appliedVoucherBalances) {
      const committed = voucherWalletCommittedByVoucher.get(v.voucherId) || 0;
      if (committed > v.remainingBalance) {
        setError(`Voucher ${v.code} tenders total ${formatNPR(committed)} but its remaining balance is only ${formatNPR(v.remainingBalance)}.`);
        return;
      }
    }
    setError(null);
    const cleanedTenders = tenders
      .filter(t => Number(t.amount) > 0)
      .map(t => ({
        amount: round2(t.amount),
        paymentMode: t.paymentMode,
        ...(t.paymentMode === 'ReferralVoucher' ? { referralId: t.referralId } : {}),
        ...(t.paymentMode === 'VoucherWallet' ? { voucherId: t.voucherId } : {}),
      }));
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

          <MembershipWalletCard membership={membership} pendingDeduction={membershipCommitted} />

          {activePendingReward && (
            <div className="rounded-spa border border-amber-300 bg-amber-50 p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <Icon name="Gift" size={14} className="text-amber-700 flex-shrink-0" />
                <p className="font-body font-body-medium text-sm text-amber-900">
                  {activePendingReward.referredName} they referred has completed a visit — this customer has earned a referral reward.
                </p>
              </div>

              {canResolveReferralReward ? (
                <>
                  <p className="font-body font-body-medium text-xs text-text-primary">Wallet credit amount</p>
                  <input
                    type="number"
                    min="0"
                    value={rewardAmount}
                    onChange={(e) => setRewardAmount(e.target.value)}
                    placeholder="e.g. 500 (leave blank for the org default)"
                    className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResolveReferralReward}
                    loading={rewardSubmitting}
                    disabled={rewardSubmitting}
                  >
                    Apply as wallet credit
                  </Button>
                  {rewardError && (
                    <p className="font-caption text-xs text-error">{rewardError}</p>
                  )}
                </>
              ) : (
                <p className="font-caption text-xs text-amber-800">
                  Ask a manager or admin to apply this referral's wallet reward.
                </p>
              )}
            </div>
          )}

          <ReferralRewardCard
            referralReward={referralReward ? { walletBalance: referralReward.walletBalance, vouchers: availableVouchers } : null}
            pendingWalletDeduction={referralWalletCommitted}
            onApplyVoucher={applyReferralVoucher}
          />

          <VoucherWalletCard
            vouchers={appliedVoucherBalances.map(v => ({
              voucherId: v.voucherId,
              code: v.code,
              balance: v.remainingBalance,
              pendingDeduction: voucherWalletCommittedByVoucher.get(v.voucherId) || 0,
            }))}
            poolBalance={voucherPoolBalance}
            poolPendingDeduction={voucherPoolCommitted}
          />

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
                const isReferralWallet = t.paymentMode === 'ReferralWallet';
                const isReferralVoucher = t.paymentMode === 'ReferralVoucher';
                const isVoucherWallet = t.paymentMode === 'VoucherWallet';
                const isVoucherPoolRow = isVoucherWallet && !t.voucherId && voucherPoolUsable && !t.manualSearch;
                const overWallet = isMembership && Number(t.amount) > Number(membership?.balance || 0);
                const overReferralWallet = isReferralWallet && Number(t.amount) > Number(referralReward?.walletBalance || 0);
                const overVoucherPool = isVoucherPoolRow && voucherPoolCommitted > voucherPoolBalance;
                const overVoucherWallet = isVoucherWallet && t.voucherId &&
                  (voucherWalletCommittedByVoucher.get(t.voucherId) || 0) > t.voucherRemainingBalance;

                // A VoucherWallet tender with no specific voucher picked yet: defaults
                // to the pooled combined-balance entry (just an amount field, like
                // Membership) when this customer has one; a small link switches this
                // one row into the manual search box instead, for a walk-in/gift
                // voucher not linked to this customer.
                if (isVoucherPoolRow) {
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="w-36 flex-shrink-0">
                          <PaymentMethodSelector
                            paymentMethods={paymentMethods}
                            extraLeaf={[membershipLeaf, referralWalletLeaf, voucherLeaf]}
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
                            className={`w-full rounded-spa border bg-surface pl-11 pr-3 py-2 font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 spa-transition-fast ${overVoucherPool ? 'border-error focus:border-error' : 'border-border focus:border-primary'}`}
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
                      <div className="flex items-center justify-between">
                        <p className={`text-[11px] font-caption ${overVoucherPool ? 'text-error' : 'text-text-tertiary'}`}>
                          {overVoucherPool
                            ? `Exceeds voucher balance (${formatNPR(voucherPoolBalance)}).`
                            : `Voucher available: ${formatNPR(Math.max(0, round2(voucherPoolBalance - voucherPoolCommitted)))}`}
                        </p>
                        <button
                          type="button"
                          onClick={() => updateTender(i, { manualSearch: true })}
                          className="text-[11px] font-caption text-primary hover:underline flex-shrink-0"
                        >
                          Use a specific voucher code
                        </button>
                      </div>
                    </div>
                  );
                }

                if (isVoucherWallet && !t.voucherId) {
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="w-36 flex-shrink-0">
                          <PaymentMethodSelector
                            paymentMethods={paymentMethods}
                            extraLeaf={[membershipLeaf, referralWalletLeaf, voucherLeaf]}
                            value={t.paymentMode}
                            onChange={(v) => updateTender(i, { paymentMode: v })}
                            size="md"
                          />
                        </div>
                        <div className="flex-1">
                          <VoucherSearchInline onSelect={(v) => selectVoucherForTender(i, v)} />
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
                      {voucherPoolUsable && (
                        <button
                          type="button"
                          onClick={() => updateTender(i, { manualSearch: false })}
                          className="text-[11px] font-caption text-primary hover:underline"
                        >
                          ← Use combined voucher balance
                        </button>
                      )}
                    </div>
                  );
                }

                if (isVoucherWallet) {
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-spa border border-primary/30 bg-primary/5 flex-shrink-0">
                          <Icon name="Ticket" size={14} className="text-primary" />
                          <span className="font-data font-data-medium text-xs text-text-primary">{t.voucherLabel}</span>
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
                            className={`w-full rounded-spa border bg-surface pl-11 pr-3 py-2 font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 spa-transition-fast ${overVoucherWallet ? 'border-error focus:border-error' : 'border-border focus:border-primary'}`}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeTender(i)}
                          className="p-2 rounded-spa hover:bg-error/10 text-error spa-transition-fast"
                          aria-label="Remove voucher"
                        >
                          <Icon name="Trash2" size={16} />
                        </button>
                      </div>
                      <p className={`text-[11px] font-caption ${overVoucherWallet ? 'text-error' : 'text-text-tertiary'}`}>
                        {overVoucherWallet
                          ? `Exceeds this voucher's balance (${formatNPR(t.voucherRemainingBalance)}).`
                          : `Voucher balance: ${formatNPR(t.voucherRemainingBalance)}`}
                      </p>
                    </div>
                  );
                }

                if (isReferralVoucher) {
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-spa border border-accent/30 bg-accent/5">
                        <Icon name="Gift" size={14} className="text-accent flex-shrink-0" />
                        <span className="font-body font-body-medium text-sm text-text-primary truncate">{t.voucherLabel}</span>
                        <span className="font-data font-data-medium text-sm text-accent ml-auto">{formatNPR(t.amount)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTender(i)}
                        className="p-2 rounded-spa hover:bg-error/10 text-error spa-transition-fast"
                        aria-label="Remove voucher"
                      >
                        <Icon name="Trash2" size={16} />
                      </button>
                    </div>
                  );
                }

                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-36 flex-shrink-0">
                        <PaymentMethodSelector
                          paymentMethods={paymentMethods}
                          extraLeaf={[membershipLeaf, referralWalletLeaf, voucherLeaf]}
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
                          className={`w-full rounded-spa border bg-surface pl-11 pr-3 py-2 font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 spa-transition-fast ${overWallet || overReferralWallet ? 'border-error focus:border-error' : 'border-border focus:border-primary'}`}
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
                    {isReferralWallet && (
                      <p className={`text-[11px] font-caption ml-[8.5rem] ${overReferralWallet ? 'text-error' : 'text-text-tertiary'}`}>
                        {overReferralWallet
                          ? `Exceeds referral wallet balance (${formatNPR(referralReward?.walletBalance || 0)}).`
                          : `Referral wallet available: ${formatNPR(referralWalletRemaining)}`}
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
            disabled={entered <= 0 || referralRewardBlocksPayment}
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

// Inline search box used inside a tender row once "Voucher" is picked from the
// Payment Method dropdown, before a specific voucher has been selected yet.
// Self-contained (owns its own debounced search state) so it can be dropped
// into any tender row without threading per-row search state through the
// parent's tenders array.
const VoucherSearchInline = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const { data } = await searchVouchersForPayment(query.trim());
      if (cancelled) return;
      setResults(data || []);
      setSearching(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return (
    <div className="space-y-1">
      <div className="relative">
        <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by voucher code, guest name, or phone..."
          className="w-full h-10 pl-9 pr-3 rounded-spa border border-border bg-surface text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>
      {searching && (
        <p className="font-caption text-xs text-text-tertiary">Searching...</p>
      )}
      {results.length > 0 && (
        <div className="rounded-spa border border-border divide-y divide-border overflow-hidden">
          {results.map((v) => (
            <button
              key={v.voucher_id}
              type="button"
              onClick={() => onSelect(v)}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-background spa-transition-fast"
            >
              <span className="min-w-0">
                <span className="block font-data font-data-medium text-xs text-text-primary truncate">{v.voucher_code}</span>
                <span className="block font-caption text-[11px] text-text-tertiary truncate">{v.guest_name}</span>
              </span>
              <span className="font-data font-data-medium text-sm text-primary flex-shrink-0 ml-2">
                {formatNPR(v.remaining_balance)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PaymentModal;
