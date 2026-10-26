import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../AppIcon';
import Button from './Button';
import CustomSelect from './CustomSelect';
import {
  fetchMembershipForBooking,
  fetchReferralRewardForBooking,
  fetchPendingReferralRewardsForBooking,
  resolveCustomerReferralReward,
  searchVouchersForPayment,
  fetchVouchersForBooking,
  fetchBookingById,
  getActivePackagesForCustomer,
  fetchBranchStaffUsers,
  getPaymentMethodQrs,
  fetchMemberDiscountContext,
  applyMemberDiscount,
} from '../../services/api';
import { memberDiscountFor, effectOf, defaultOn } from '../../services/memberDiscount';
import { nepalNow } from '../../utils/customerDirectory';
import { buildPaymentMethodTree } from '../../services/paymentMethods';
import { addTenderRow, removeTenderRow, updateTenderRow } from '../../utils/tenderRows';
import { useOrg } from '../../contexts/OrgContext';
import { useBranch } from '../../contexts/BranchContext';
import { pendingQrRows, qrSignature, isQrConfirmed } from '../../utils/paymentQr';
import { computeChange, quickCashOptions, buildReceiptText, buildReceiptHtml, buildWhatsAppUrl } from '../../utils/checkoutReceipt';
import { useAuth } from '../../contexts/AuthContext';
import { MEMBERSHIP_ENABLED, CUSTOMER_REFERRALS_ENABLED, VOUCHER_ENABLED, PRODUCTS_ENABLED } from '../../lib/featureFlags';
import {
  allocateProductsFirst, dueState, isTreatmentOnly, treatmentOnlyEntered, treatmentOnlyOverflow, splitAcrossLines, lineTotal, parseStockError,
} from '../../services/checkoutAllocation';
import { useCheckoutProducts, ProductsBlock, BusyNotice } from './CheckoutProducts';

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

// Credit-type tender modes: they draw on a wallet/voucher/package rather than being
// a payment method staff pick from the org's configured list.
const CREDIT_MODES = ['Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher', 'SessionPackage'];
const isCreditMode = (m) => CREDIT_MODES.includes(m);

const METHOD_ICONS = [
  [/cash/i, 'Banknote'],
  [/qr|fonepay/i, 'QrCode'],
  [/card|visa|master/i, 'CreditCard'],
  [/esewa|khalti|ime|wallet|pay/i, 'Smartphone'],
  [/bank/i, 'Landmark'],
  [/cheque|check/i, 'FileText'],
];
const methodIcon = (mode) => {
  if (mode === 'Membership' || mode === 'ReferralWallet') return 'Wallet';
  if (mode === 'VoucherWallet') return 'Ticket';
  if (mode === 'ReferralVoucher') return 'Gift';
  if (mode === 'SessionPackage') return 'PackageCheck';
  const hit = METHOD_ICONS.find(([re]) => re.test(String(mode)));
  return hit ? hit[1] : 'CircleDollarSign';
};

// Small presentational pieces (module scope so they keep a stable identity across renders).
const Check = ({ on, disabled }) => (
  <span className={`w-[14px] h-[14px] rounded-[4px] border grid place-items-center flex-none ${on ? 'bg-primary border-primary text-white' : 'bg-white border-[#CFD0CC]'} ${disabled ? 'opacity-70' : ''}`}>
    {on && <Icon name="Check" size={10} strokeWidth={3} />}
  </span>
);
const SectionLabel = ({ children, hint }) => (
  <div className="flex items-baseline justify-between text-[11px] font-medium text-[#8A8A90] tracking-[.04em] uppercase mb-2">
    <span>{children}</span>{hint && <span className="normal-case tracking-normal font-normal">{hint}</span>}
  </div>
);
// Amount field: shows "1,800" while state keeps the raw "1800" (so every calculation downstream is untouched).
const sanitizeAmount = (s) => {
  const [a, ...rest] = String(s).replace(/[^0-9.]/g, '').split('.');
  return rest.length ? `${a}.${rest.join('')}` : a;
};
const formatAmountDisplay = (raw) => {
  if (raw == null || raw === '') return '';
  const [i, d] = String(raw).split('.');
  const intPart = i === '' ? '' : Number(i).toLocaleString('en-IN');
  return d === undefined ? intPart : `${intPart || '0'}.${d}`;
};
const AmountInput = forwardRef(({ value, onChange, ...rest }, ref) => {
  const innerRef = useRef(null);
  const caretRef = useRef(null); // count of digits/dots left of the caret after the last edit
  const display = formatAmountDisplay(value);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (caretRef.current == null || !el || document.activeElement !== el) { caretRef.current = null; return; }
    let seen = 0, pos = 0;
    while (pos < display.length && seen < caretRef.current) { if (/[0-9.]/.test(display[pos])) seen++; pos++; }
    el.setSelectionRange(pos, pos);
    caretRef.current = null;
  }, [display]);
  return (
    <input
      {...rest}
      ref={(el) => { innerRef.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; }}
      type="text" inputMode="decimal" value={display}
      onChange={(e) => {
        const el = e.target;
        caretRef.current = (el.value.slice(0, el.selectionStart ?? el.value.length).match(/[0-9.]/g) || []).length;
        onChange(sanitizeAmount(el.value));
      }}
    />
  );
});
// The REST row of a split: the first non-credit row that has a method, while staff haven't typed in it.
// Its amount is always "total minus every other row" (see the sync effect in PaymentModal).
const restIndexOf = (rows, restOn) => {
  if (!restOn || rows.length < 2) return -1;
  return rows.findIndex((t) => t.paymentMode && !isCreditMode(t.paymentMode));
};

// Per-row method dropdown menu: grouped listbox (design-system pattern, never a native <select>), portalled so the
// scroll areas can't clip it. Methods already used on another row are shown disabled with "in use".
const MethodMenu = ({ rect, tree, usedValues, activeValue, onPick, onClose }) => {
  const ref = useRef(null);
  const groups = useMemo(() => tree.map((item) => (item.subMethods && item.subMethods.length
    ? { title: item.label, items: item.subMethods }
    : { title: null, items: [item] })), [tree]);
  const flat = useMemo(() => groups.flatMap((g) => g.items.map((it) => ({ ...it, disabled: usedValues.has(String(it.value)) }))), [groups, usedValues]);
  const [hi, setHi] = useState(() => {
    const a = flat.findIndex((o) => !o.disabled && String(o.value) === String(activeValue));
    return a >= 0 ? a : flat.findIndex((o) => !o.disabled);
  });
  useEffect(() => {
    ref.current?.focus();
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || e.target.closest?.('[data-method-trigger]')) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const move = (dir) => {
    if (!flat.some((o) => !o.disabled)) return;
    let i = hi;
    for (let n = 0; n < flat.length; n++) { i = (i + dir + flat.length) % flat.length; if (!flat[i].disabled) break; }
    setHi(i);
    requestAnimationFrame(() => ref.current?.querySelector(`#mm-opt-${i}`)?.scrollIntoView({ block: 'nearest' }));
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setHi(flat.findIndex((o) => !o.disabled)); }
    else if (e.key === 'End') { e.preventDefault(); for (let i = flat.length - 1; i >= 0; i--) if (!flat[i].disabled) { setHi(i); break; } }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (hi >= 0 && !flat[hi].disabled) onPick(flat[hi].value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'Tab') { e.preventDefault(); onClose(); }
  };
  const width = Math.max(rect.width, 224);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const flipUp = rect.bottom + 330 > window.innerHeight && rect.top > 330;
  let idx = -1;
  return (
    <div ref={ref} role="listbox" tabIndex={-1} aria-label="Payment method" data-checkout-menu aria-activedescendant={hi >= 0 ? `mm-opt-${hi}` : undefined}
      onKeyDown={onKeyDown}
      style={{ position: 'fixed', left, width, ...(flipUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) }}
      className="z-notification bg-white border border-[#E7E8E6] rounded-[10px] p-1 shadow-[0_12px_32px_-8px_rgba(14,13,12,.25)] max-h-[320px] overflow-y-auto text-[13px] outline-none">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium uppercase tracking-[.04em] text-[#8A8A90]">{g.title}</div>}
          {g.items.map((it) => {
            idx += 1;
            const i = idx;
            const o = flat[i];
            const selected = String(activeValue) === String(it.value);
            return (
              <div key={it.value} id={`mm-opt-${i}`} role="option" aria-selected={selected} aria-disabled={o.disabled || undefined}
                onMouseEnter={() => !o.disabled && setHi(i)} onClick={() => !o.disabled && onPick(it.value)}
                className={`flex items-center gap-2 px-2.5 h-9 rounded-md select-none ${o.disabled ? 'text-[#B4B4BA] cursor-not-allowed' : 'cursor-pointer text-[#0E0D0C]'} ${hi === i && !o.disabled ? 'bg-[#F4F4F2]' : ''} ${selected ? 'font-medium text-primary' : ''}`}>
                <Icon name={methodIcon(it.value)} size={14} strokeWidth={1.6} className={o.disabled ? 'text-[#CFD0CC]' : 'text-[#515152]'} />
                <span className="flex-1 truncate">{it.label}</span>
                {o.disabled ? <span className="text-[11px] text-[#B4B4BA]">in use</span> : selected && <Icon name="Check" size={13} strokeWidth={2.4} />}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

// Member discount line under a service (V22): on (gold, "Remove"), removed ("Add back"), a better member rate than the
// booking's own discount ("Use N% instead"), or a quiet "no discount on these services" for an active member.
const fmtN = (n) => Number(n || 0).toLocaleString('en-IN');
const StarDot = ({ muted = false }) => (
  <span className={`w-[18px] h-[18px] rounded-full grid place-items-center flex-none ${muted ? 'bg-[#F1F1EF] text-[#B4B4BA]' : 'bg-[#FBF3DF] text-[#C99A2E]'}`}>
    <Icon name="Star" size={9} className="fill-current" strokeWidth={0} />
  </span>
);
const MemberLine = ({ st, onToggle }) => {
  if (!st?.md) return null;
  const { md, on } = st;
  if (md.kind === 'noRule') {
    return (
      <div className="flex items-center gap-2 min-h-[30px] pl-6 text-[12.5px] text-[#8A8A90]" data-member-line="none">
        <StarDot muted />No {md.tierName} discount on {md.label} services
      </div>
    );
  }
  if (on && st.memberAmount > 0) {
    return (
      <div className="flex items-start gap-2 pl-6 py-1.5" data-member-line="on">
        <span className="mt-0.5"><StarDot /></span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-[#9A6B0B] truncate">{md.tierName} · {md.pct}% off {md.label.toLowerCase()}</div>
          <div className="text-[11.5px] text-[#8A8A90]">{md.capped ? `Capped at NPR ${fmtN(md.amount)} (already paid NPR ${fmtN(md.paid)})` : 'Added automatically'}</div>
        </div>
        <span className="text-[13px] text-[#9A6B0B] tabular-nums whitespace-nowrap">−{fmtN(st.memberAmount)}</span>
        <button type="button" onClick={() => onToggle(false)} className="text-[11.5px] text-[#8A8A90] underline underline-offset-2 hover:text-[#0E0D0C]" data-member-remove>Remove</button>
      </div>
    );
  }
  if (md.kind === 'better') {
    return (
      <div className="ml-6 mt-1 mb-1.5 flex items-center gap-2.5 rounded-lg border border-dashed border-[#E7C766] bg-[#FFFBF0] px-3 py-2" data-member-line="better">
        <Icon name="Star" size={11} className="fill-current text-[#C99A2E] flex-none" strokeWidth={0} />
        <span className="flex-1 min-w-0 text-[12.5px] text-[#92600A]">{md.tierName} gets <b className="font-semibold">{md.pct}%</b> on {md.label.toLowerCase()}. Save the guest NPR {fmtN(md.extra)} more.</span>
        <button type="button" onClick={() => onToggle(true)} className="h-7 px-2.5 rounded-md border border-[#E7C766] bg-white text-[12px] font-semibold text-[#92600A] whitespace-nowrap hover:bg-[#FFF6DD]" data-member-use>Use {md.pct}% instead</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 min-h-[30px] pl-6 text-[12.5px] text-[#8A8A90]" data-member-line="off">
      <StarDot muted /><span className="flex-1">Member discount removed</span>
      <button type="button" onClick={() => onToggle(true)} className="text-[12.5px] font-medium text-primary hover:underline" data-member-addback>Add back {md.pct}%</button>
    </div>
  );
};

const CreditRow = ({ icon, title, sub, applied, onApply, onRemove, disabledText }) => (
  <div className="flex items-center gap-2.5 min-h-[44px] border-b border-[#F1F1EF] last:border-b-0 py-1.5">
    <span className="w-7 h-7 rounded-[7px] border border-[#E7E8E6] bg-white grid place-items-center text-[#515152] flex-none"><Icon name={icon} size={15} strokeWidth={1.6} /></span>
    <span className="flex-1 min-w-0">
      <span className="block font-medium text-[13px] text-[#0E0D0C] truncate">{title}</span>
      <span className="block text-[12px] text-[#8A8A90] tabular-nums truncate">{sub}</span>
    </span>
    {disabledText ? (
      <span className="text-[11.5px] text-[#8A8A90] text-right max-w-[110px] leading-tight">{disabledText}</span>
    ) : (
      <button
        type="button"
        onClick={applied ? onRemove : onApply}
        className={`h-[26px] px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1 flex-none border ${applied ? 'border-transparent bg-[#EEF3EC] text-primary' : 'border-[#E7E8E6] bg-white text-[#0E0D0C] hover:bg-[#F7F7F5]'}`}
      >
        {applied && <Icon name="Check" size={12} strokeWidth={2.4} />}{applied ? 'Applied' : 'Apply'}
      </button>
    )}
  </div>
);


const PaymentModal = ({
  booking,
  additionalBookings: initialAdditional = [],
  addOnCandidates = null, // optional: every bundle-able booking; `additionalBookings` is then just the initially ticked subset
  onConfirm,
  onClose,
  isSubmitting,
  dueHolderSuggestions = [],
}) => {
  const { paymentMethods, orgName } = useOrg();
  const { branchName } = useBranch();
  const { profile } = useAuth();
  const userRole = profile?.role || 'staff';
  const canResolveReferralReward = ['manager', 'admin'].includes(userRole);
  const PAYMENT_TREE = useMemo(
    () => buildPaymentMethodTree(paymentMethods),
    [paymentMethods]
  );

  // Bundle-able bookings (related group services / earlier balances). Without an explicit
  // candidate list, the passed `additionalBookings` are the candidates, all ticked (the
  // behaviour every caller had before the Checkout dialog made them individually optional).
  const candidates = addOnCandidates || initialAdditional;
  const [checkedAddOns, setCheckedAddOns] = useState(() => new Set(initialAdditional.map((b) => b.bookingId)));
  const additionalBookings = useMemo(
    () => candidates.filter((b) => checkedAddOns.has(b.bookingId)),
    [candidates, checkedAddOns]
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

  // ── Member discount (V22) ─────────────────────────────────────────────────────────────────────
  // The tier's rate is previewed here for the main booking and every add-on (read fresh from the DB), and saved by
  // apply_member_discount() only when staff press Collect. `memberOn` is the staff choice per booking (Remove / Add back /
  // Use N% instead); `memberState[id].delta` is how much less that booking costs than its saved amounts.
  const mainBookingId = booking.bookingId || booking.id;
  const memberIds = useMemo(() => [mainBookingId, ...candidates.map((b) => b.bookingId)].filter(Boolean), [mainBookingId, candidates]);
  const memberIdsKey = memberIds.join(',');
  const [memberCtx, setMemberCtx] = useState(null);
  const [memberOn, setMemberOn] = useState({});
  const memberSavedRef = useRef(new Set()); // bookings whose member change was already saved in this checkout
  const memberToday = useMemo(() => nepalNow().today, []);
  useEffect(() => {
    if (!MEMBERSHIP_ENABLED || !memberIds.length) return undefined;
    let cancelled = false;
    fetchMemberDiscountContext(memberIds).then(({ data }) => { if (!cancelled && data) setMemberCtx(data); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIdsKey]);
  const memberState = useMemo(() => {
    const out = {};
    memberIds.forEach((id) => {
      const ctx = memberCtx?.[id];
      const md = ctx ? memberDiscountFor({ booking: ctx.booking, membership: ctx.membership, today: memberToday }) : null;
      const on = memberOn[id] ?? defaultOn(md);
      out[id] = { md, on, ...effectOf(md, on) };
    });
    return out;
  }, [memberIds, memberCtx, memberOn, memberToday]);
  const memberDelta = (id) => memberState[id]?.delta || 0;
  const setMemberChoice = (id, on) => setMemberOn((m) => ({ ...m, [id]: on }));
  // What an add-on still owes after its member line.
  const bookingDue = (b) => Math.max(0, round2(bookingRemaining(b) - memberDelta(b.bookingId)));

  const finalAmount = Number(booking.final_amount ?? booking.finalAmount ?? 0);
  const alreadyPaid = round2(booking.amountPaid || booking.amount_paid || 0);
  const remaining = round2(Math.max(finalAmount - alreadyPaid - memberDelta(mainBookingId), 0));

  const additionalRemaining = round2(additionalBookings.reduce((s, b) => s + bookingDue(b), 0));
  // "Member saves NPR X" and the struck-through amount: only the bookings in this payment.
  const includedMemberIds = [mainBookingId, ...additionalBookings.map((b) => b.bookingId)];
  const memberSavings = round2(includedMemberIds.reduce((s, id) => s + (memberState[id]?.memberAmount || 0), 0));
  const memberDeltaIncluded = round2(includedMemberIds.reduce((s, id) => s + (memberState[id]?.on ? Math.max(0, memberDelta(id)) : 0), 0));
  // Products at checkout (V26): paid first, in full; only the treatment can stay due. `treatmentDue` is what the bookings still owe.
  const [bookingRowInfo, setBookingRowInfo] = useState(null); // guest name/phone/therapist for the header + receipt (and the seller default)
  const productBranchId = booking.branchId || booking.branch_id;
  const cp = useCheckoutProducts({
    enabled: PRODUCTS_ENABLED && !!mainBookingId && !!productBranchId,
    branchId: productBranchId,
    customerId: bookingRowInfo?.customer_id || null,
    defaultSellerId: bookingRowInfo?.therapist?.id || bookingRowInfo?.therapist_id || null,
  });
  const productsTotal = cp.total;
  const treatmentDue = round2(remaining + additionalRemaining);
  const grandTotal = round2(treatmentDue + productsTotal);

  const [notes, setNotes] = useState('');
  // Customer gratuity — NOT part of the amount-due math at all (deliberately kept
  // out of tenders/entered/leftover/grandTotal), so it never interacts with the
  // OVERPAYMENT guard below. Logged as a separate, independent write
  // (booking_tips, migration-240) regardless of whether this payment goes through
  // the plain recordPayment() path or the atomic bundled recordGroupPayment RPC —
  // see BookingActionModal's handlePaymentConfirm.
  const [tip, setTip] = useState('');
  const [showTip, setShowTip] = useState(false);
  // Who actually received the tip — not necessarily the assigned therapist, a
  // guest may hand it to whichever staff member (service or support) they
  // interacted with (migration-242). Any active branch staff user, not just
  // therapists. Multiple staff can split one tip, each with their own
  // manually-entered amount — tipRecipients holds one row per recipient.
  const tipRecipientKeyRef = useRef(0);
  const nextTipRecipientKey = () => (tipRecipientKeyRef.current += 1);
  const [tipRecipients, setTipRecipients] = useState([{ key: 0, receivedBy: '', amount: '' }]);
  const [branchStaffOptions, setBranchStaffOptions] = useState([]);
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

  // Branch staff roster for the "who received this tip" picker (migration-242) —
  // fetched lazily, only once the Tip field is actually opened.
  const branchId = booking.branchId || booking.branch_id;
  useEffect(() => {
    if (!showTip || !branchId || branchStaffOptions.length > 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await fetchBranchStaffUsers(branchId);
      if (!cancelled) setBranchStaffOptions(data || []);
    })();
    return () => { cancelled = true; };
  }, [showTip, branchId, branchStaffOptions.length]);

  // Single-recipient case (the common path) keeps its one row's amount in sync
  // with the entered tip total automatically, so staff never has to re-type it
  // — matches pre-multi-recipient behavior exactly. Once a second row exists,
  // staff is entering manual per-recipient amounts, so auto-sync stops.
  useEffect(() => {
    if (tipRecipients.length !== 1) return;
    setTipRecipients(([row]) => [{ ...row, amount: tip }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip]);

  const updateTipRecipient = (key, patch) =>
    setTipRecipients(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const addTipRecipient = () =>
    setTipRecipients(prev => [...prev, { key: nextTipRecipientKey(), receivedBy: '', amount: '' }]);
  const removeTipRecipient = (key) =>
    setTipRecipients(prev => {
      const next = prev.filter(r => r.key !== key);
      return next.length === 1 ? [{ ...next[0], amount: tip }] : next;
    });

  const tipRecipientsTotal = useMemo(
    () => round2(tipRecipients.reduce((s, r) => s + (Number(r.amount) > 0 ? Number(r.amount) : 0), 0)),
    [tipRecipients]
  );

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

  // --- session packages (migration-141) ---
  // Prepaid session bundles for a specific service — "Redeem 1 Session" always
  // settles this booking's ENTIRE own remaining balance (never a partial or a
  // bundled additional booking): the session's value was already collected when
  // the package was purchased, so recordPayment computes the redemption's
  // payments.amount server-side as this bookingId's own `remaining` minus any
  // other NPR tenders. To keep that invariant intact through the client-side
  // waterfall allocator below (which otherwise could spill a partial tender's
  // dollar value onto a bundled additional booking), redeeming a package always
  // REPLACES the entire tenders array with a single full-covering tender — same
  // "replace, don't append" approach as the Membership auto-fill effect above —
  // rather than being added alongside other tenders.
  const [customerPackages, setCustomerPackages] = useState([]);
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    (async () => {
      const { data: bookingRow } = await fetchBookingById(bookingId);
      if (cancelled || !bookingRow) return;
      setBookingRowInfo(bookingRow);
      const { data } = await getActivePackagesForCustomer(
        bookingRow.customer_id,
        bookingRow.customer_phone,
        bookingRow.service_id
      );
      if (!cancelled) setCustomerPackages(data || []);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  const packagesUsable = customerPackages.length > 0;

  // Deliberately NOT in any extraLeaf array — a SessionPackage tender always
  // needs a specific packageId, and picking it from the raw payment-method
  // dropdown proved confusing to staff (buried among Cash/Card/etc.). The
  // package card's own "Claim" button is the single entry point instead —
  // same reasoning as ReferralVoucher (also never in extraLeaf): the only
  // way to create either tender type is its own card's action button
  // (applyReferralVoucher / redeemPackage below), which sets every required
  // field at once.
  const selectedPackageTender = tenders.find((t) => t.paymentMode === 'SessionPackage') || null;

  const redeemPackage = (pkg) => {
    setTenders([{
      amount: String(remaining),
      paymentMode: 'SessionPackage',
      packageId: pkg.packageId,
      packageLabel: pkg.packageName,
    }]);
  };

  const undoPackage = () => {
    setTenders([{ amount: String(grandTotal || ''), paymentMode: firstLeafValue(PAYMENT_TREE) }]);
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
            ...(t.paymentMode === 'SessionPackage' ? { packageId: t.packageId } : {}),
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
    // Bundled bookings the pool couldn't cover — either the staff deliberately
    // under-tendered (leftover > 0, expected) or, if leftover is 0, the pool
    // still fell short of covering everything (an inconsistency that must
    // block submission rather than silently drop the booking — see
    // BK-20260913-0037, where a bundled Jacuzzi payment vanished unnoticed).
    const skippedBookings = [];
    for (const pb of additionalBookings) {
      const need = bookingDue(pb);
      if (poolRemaining() + 0.001 >= need) {
        additionalAllocations.push({ bookingId: pb.bookingId, bookingNumber: pb.bookingNumber, tenders: take(need) });
      } else {
        skippedBookings.push({ bookingId: pb.bookingId, bookingNumber: pb.bookingNumber, need });
      }
    }
    return { primaryTenders, additionalAllocations, skippedBookings };
  };

  const cleanedTendersPreview = useMemo(() => tenders
    .filter(t => Number(t.amount) > 0)
    .filter(t => t.paymentMode !== 'SessionPackage' || !!t.packageId)
    .map(t => ({ amount: round2(t.amount), paymentMode: t.paymentMode })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenders]);

  // Live preview so staff see which bundled bookings would be left unpaid
  // BEFORE submitting, instead of finding out after the fact.
  const skippedBookingsPreview = useMemo(
    () => allocateTenders(cleanedTendersPreview).skippedBookings,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cleanedTendersPreview, remaining, additionalBookings]
  );

  // Member discount (V22): the changes still to save at Collect, and saving them (then re-checking the amounts against what
  // this screen shows). Returns an error message, or null when everything matches.
  const memberPendingChanges = includedMemberIds
    .map((id) => ({ id, action: memberState[id]?.action }))
    .filter((c) => c.action && !memberSavedRef.current.has(c.id));
  const memberOnly = grandTotal <= 0.001 && memberPendingChanges.length > 0; // the member discount leaves nothing to collect
  const saveMemberChanges = async () => {
    if (!memberPendingChanges.length) return null;
    for (const c of memberPendingChanges) {
      const { error: mdError } = await applyMemberDiscount({ bookingId: c.id, remove: c.action === 'remove' });
      if (mdError) return `Member discount not saved: ${mdError.message}. Nothing was paid.`;
      memberSavedRef.current.add(c.id);
    }
    const { data: fresh, error: freshError } = await fetchMemberDiscountContext(includedMemberIds);
    if (freshError || !fresh) return 'Could not re-check the amounts after the member discount. Nothing was paid; close checkout and open it again.';
    const expected = [[mainBookingId, remaining], ...additionalBookings.map((b) => [b.bookingId, bookingDue(b)])];
    const off = expected.filter(([id, due]) => {
      const f = fresh[id]?.booking;
      return !f || Math.abs(Math.max(0, round2(f.finalAmount - f.amountPaid)) - due) > 0.01;
    });
    return off.length ? 'The amount due changed while saving the member discount. Nothing was paid; close checkout and open it again.' : null;
  };

  const handleSubmit = async () => {
    if (memberOnly) {
      const memberError = await saveMemberChanges();
      if (memberError) { setError(memberError); return; }
      setReceipt({ ...buildReceipt([], 0, []), tenders: [], total: 0, leftover: 0, walletAfter: [], memberOnly: true });
      return;
    }
    if (referralRewardBlocksPayment) {
      setError('Apply this customer\'s referral wallet reward before completing payment.');
      return;
    }
    if (tenders.some((t) => !t.paymentMode)) {
      setError('Choose a payment method for every row.');
      return;
    }
    if (entered <= 0 && leftover <= 0) {
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
    if (showTip && Number(tip) > 0) {
      if (tipRecipients.some(r => !r.receivedBy || !(Number(r.amount) > 0))) {
        setError('Select who received the tip and enter an amount for every recipient.');
        return;
      }
      if (Math.abs(tipRecipientsTotal - round2(Number(tip))) > 0.001) {
        setError(`Tip recipient amounts (${formatNPR(tipRecipientsTotal)}) must add up to the tip total (${formatNPR(tip)}).`);
        return;
      }
    }
    setError(null);
    const cleanedTenders = tenders
      .filter(t => Number(t.amount) > 0)
      .filter(t => t.paymentMode !== 'SessionPackage' || !!t.packageId)
      .map(t => ({
        amount: round2(t.amount),
        paymentMode: t.paymentMode,
        ...(t.paymentMode === 'ReferralVoucher' ? { referralId: t.referralId } : {}),
        ...(t.paymentMode === 'VoucherWallet' ? { voucherId: t.voucherId } : {}),
        ...(t.paymentMode === 'SessionPackage' ? { packageId: t.packageId } : {}),
      }));
    // Products are paid first, in full, by money methods; vouchers and packages pay the treatment only (the server enforces the same).
    const productSplit = allocateProductsFirst(cleanedTenders, productsTotal);
    if (productSplit.shortfall > 0.001) {
      setError(`Products come to ${formatNPR(productsTotal)} and are paid in full today. Cash, card, wallets and the membership wallet cover ${formatNPR(round2(productsTotal - productSplit.shortfall))}; vouchers and packages pay the treatment only.`);
      return;
    }
    if (treatmentOnlyOverflow(cleanedTenders, treatmentDue) > 0.001) {
      setError(`Vouchers and packages pay the treatment only (${formatNPR(treatmentDue)}); reduce them or use another method for the rest.`);
      return;
    }
    const { primaryTenders, additionalAllocations, skippedBookings } = allocateTenders(productSplit.treatment);
    // Safety net: nothing should be left unallocated when the staff entered
    // the full amount due. If it happens anyway (stale balance, rounding),
    // block rather than silently drop a bundled booking's payment.
    if (skippedBookings.length > 0 && leftover <= 0.001) {
      setError(`Could not allocate payment to: ${skippedBookings.map(s => s.bookingNumber || s.bookingId).join(', ')}. Please re-check the entered amounts and try again.`);
      return;
    }
    const tipAmount = Number(tip) > 0 ? round2(Number(tip)) : 0;
    const tipSplits = tipAmount > 0
      ? tipRecipients.map(r => ({ receivedBy: r.receivedBy, amount: round2(Number(r.amount)) }))
      : [];

    // Member discount (V22): save each booking's member change first, then re-read the amounts and make sure they are what
    // this screen shows. If either step fails, nothing is paid.
    const memberError = await saveMemberChanges();
    if (memberError) { setError(memberError); return; }

    const result = await onConfirm({
      tenders: primaryTenders,
      additionalAllocations,
      dueHolderName: leftover > 0 ? dueHolderName.trim() : '',
      notes,
      tipAmount,
      tipSplits,
      // V26: with products the whole checkout is ONE database call (products + treatment); `productTenders` is what the screen
      // allocated to the products, and the server re-derives it from the tender order.
      products: cp.count > 0 ? cp.payloadLines : [],
      productTenders: productSplit.product.map((x) => ({ amount: x.amount, paymentMode: x.paymentMode })),
    });
    if (result?.error) {
      const stock = parseStockError(result.error);
      if (stock) { cp.markBusy(stock.variantId, stock.left, stock.message); setError(null); return; }
      setError(result.error.message || 'Failed to record payment.');
      return;
    }
    setReceipt(buildReceipt(cleanedTenders, tipAmount, tipSplits, { split: productSplit, sales: result?.data?.sales || null }));
  };

  // ───────────────────────── Checkout UI state (no money logic below this line) ─────────────────────────
  const [receipt, setReceipt] = useState(null); // snapshot shown by the success state
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (cp.count > 0) setTouched(true); }, [cp.count]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showVoucherSearch, setShowVoucherSearch] = useState(false);
  const [restOn, setRestOn] = useState(true); // false once staff type into the REST row themselves
  const [leaveDue, setLeaveDue] = useState(false); // the "Leave as due" choice for an uncovered gap
  const [menu, setMenu] = useState(null); // { idx, rect } — the open per-row method menu
  const [pendingOpen, setPendingOpen] = useState(null); // row index whose menu should open once it has rendered
  const methodBtnRefs = useRef({});
  const listRef = useRef(null);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const measureFade = () => {
    const el = listRef.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollHeight - el.clientHeight - el.scrollTop > 2;
    setFade((f) => (f.top === top && f.bottom === bottom ? f : { top, bottom }));
  };
  useLayoutEffect(measureFade);
  useEffect(() => { window.addEventListener('resize', measureFade); return () => window.removeEventListener('resize', measureFade); }, []);
  const [activeIdx, setActiveIdx] = useState(null);
  const [popover, setPopover] = useState(null); // { kind: 'sub' | 'more', value?, rect }
  const dialogRef = useRef(null);
  const firstAmountRef = useRef(null);
  const submittingRef = useRef(false);

  const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
  const svcName = (b) => (typeof b.service === 'string' ? b.service : b.service?.name) || b.serviceName || b.service_name_snapshot || 'Service';
  const guestName = bookingRowInfo?.customer_name || booking.customerName || '';
  const guestPhone = bookingRowInfo?.customer_phone || booking.customerPhone || '';
  const tierName = membership?.tierName || null;
  const bookingNumber = booking.booking_number || booking.id;
  const busy = !!isSubmitting;

  const leafLabel = (value) => {
    for (const item of PAYMENT_TREE) {
      if (String(item.value) === String(value)) return item.label;
      const sub = (item.subMethods || []).find((s) => String(s.value) === String(value));
      if (sub) return sub.label;
    }
    return String(value);
  };
  const tenderLabel = (t) => {
    switch (t.paymentMode) {
      case 'Membership': return 'Membership wallet';
      case 'ReferralWallet': return 'Referral wallet';
      case 'VoucherWallet': return t.voucherLabel ? `Voucher ${t.voucherLabel}` : 'Vouchers';
      case 'ReferralVoucher': return t.voucherLabel || 'Referral voucher';
      case 'SessionPackage': return t.packageLabel || 'Package';
      default: return leafLabel(t.paymentMode);
    }
  };
  const isCash = (t) => /^cash$/i.test(String(t.paymentMode));

  // Change helper: at most one Cash row exists, and its calc/received state lives on that row (the receipt
  // reads it from there). While the Cash amount is 0/empty the helper is only hidden, so retyping the amount
  // keeps it; once the row stops being Cash it is cleared (a removed row takes its state with it).
  const cashIdx = tenders.findIndex(isCash);
  const cashAmount = cashIdx >= 0 ? Number(tenders[cashIdx].amount) || 0 : 0;
  // Focus "Guest handed over" only when the helper is opened from its link, not when it reappears after the
  // Cash amount is retyped (that would steal the keystrokes still going into the Cash box).
  const focusReceivedRef = useRef(false);
  useEffect(() => {
    const stale = (t) => (t.calc || t.received) && !isCash(t);
    if (tenders.some(stale)) setTenders((cur) => cur.map((t) => (stale(t) ? { ...t, calc: false, received: '' } : t)));
  }, [tenders]);

  // The tender the method picker edits: the one last touched, else the last non-credit row.
  const lastNonCreditIdx = (() => {
    for (let i = tenders.length - 1; i >= 0; i--) if (!isCreditMode(tenders[i].paymentMode)) return i;
    return -1;
  })();
  const activeTenderIdx = activeIdx != null && tenders[activeIdx] && !isCreditMode(tenders[activeIdx].paymentMode) ? activeIdx : lastNonCreditIdx;

  // When a bundled booking (earlier balance / group service) is ticked or unticked, the total moves and the
  // "rest of the bill" row — the last non-credit row — absorbs the change. Never adds a second row for it
  // (a new row appears only when there is no cash/card row at all, e.g. a wallet covered everything).
  // Ticking only grows the bill when the rows fully covered it before, so a deliberately part-paid
  // bill keeps its leftover; unticking only trims when the rows would now exceed the total.
  const prevTotalRef = useRef(grandTotal);
  useEffect(() => {
    const prev = prevTotalRef.current;
    prevTotalRef.current = grandTotal;
    if (prev === grandTotal) return;
    setTenders((cur) => {
      if (restIndexOf(cur, restOn) >= 0) return cur; // the REST row absorbs any change in the total
      const enteredNow = sumTenders(cur);
      if (grandTotal > prev) {
        if (enteredNow + 0.001 < prev) return cur;
        const delta = round2(grandTotal - prev);
        // V22: a lone wallet row that covered the old total keeps covering it (e.g. the member discount was removed),
        // as long as the wallet has enough.
        if (cur.length === 1 && cur[0].paymentMode === 'Membership' && membershipUsable && membership.balance + 0.001 >= grandTotal) {
          return [{ ...cur[0], amount: String(grandTotal) }];
        }
        let idx = -1;
        for (let i = cur.length - 1; i >= 0; i--) if (!isCreditMode(cur[i].paymentMode)) { idx = i; break; }
        if (idx < 0) return [...cur, defaultRow(delta)];
        return cur.map((t, i) => (i === idx ? { ...t, amount: String(round2((Number(t.amount) || 0) + delta)) } : t));
      }
      let over = round2(enteredNow - grandTotal);
      if (over <= 0.001) return cur;
      const next = cur.map((t) => ({ ...t }));
      const trim = (credit) => {
        for (let i = next.length - 1; i >= 0 && over > 0.001; i--) {
          if (isCreditMode(next[i].paymentMode) !== credit) continue;
          if (credit && (next[i].paymentMode === 'SessionPackage' || next[i].paymentMode === 'ReferralVoucher')) continue;
          const have = Number(next[i].amount) || 0;
          const cut = Math.min(have, over);
          next[i].amount = cut >= have ? '' : String(round2(have - cut));
          over = round2(over - cut);
        }
      };
      trim(false); trim(true);
      return next.filter((t) => Number(t.amount) > 0);
    });
  }, [grandTotal]);

  const defaultRow = (amount = '') => ({ amount: amount === '' ? '' : String(amount), paymentMode: firstLeafValue(PAYMENT_TREE) });
  const sumTenders = (list) => round2(list.reduce((s, t) => s + (Number(t.amount) > 0 ? Number(t.amount) : 0), 0));

  // Apply a wallet/voucher: adds a credit tender (first in the list) sized to what it can cover and
  // shrinks the cash/card rows by the same amount so the total stays exactly covered.
  const applyCredit = (mode, available, extra = {}) => {
    setTouched(true);
    setTenders((prev) => {
      const credit = sumTenders(prev.filter((t) => isCreditMode(t.paymentMode)));
      // Vouchers, packages and the referral wallet pay the treatment only; the membership wallet can pay anything.
      const cap = isTreatmentOnly(mode) ? Math.max(0, treatmentDue - treatmentOnlyEntered(prev)) : grandTotal - credit;
      const a = round2(Math.max(0, Math.min(available, cap)));
      if (a <= 0) return prev;
      let next = prev.map((t) => ({ ...t }));
      const ri = restIndexOf(next, restOn); // the REST row re-balances itself; only the other rows are trimmed here
      let overflow = round2(sumTenders(next) - (ri >= 0 ? Number(next[ri].amount) || 0 : 0) + a - grandTotal);
      for (let i = next.length - 1; i >= 0 && overflow > 0.001; i--) {
        if (isCreditMode(next[i].paymentMode) || i === ri) continue;
        const cur = Number(next[i].amount) || 0;
        const cut = Math.min(cur, overflow);
        next[i].amount = cut >= cur ? '' : String(round2(cur - cut));
        overflow = round2(overflow - cut);
      }
      next = next.filter((t, i) => isCreditMode(t.paymentMode) || Number(t.amount) > 0 || !t.paymentMode || i === ri);
      next.unshift({ amount: String(a), paymentMode: mode, ...extra });
      const rest = round2(grandTotal - sumTenders(next));
      if (rest > 0.001 && !next.some((t) => !isCreditMode(t.paymentMode))) next.push(defaultRow(rest));
      return next;
    });
  };

  // Un-apply: drop the matching credit rows and give the freed amount back to the cash/card row.
  const removeCredit = (pred) => {
    setTouched(true);
    setTenders((prev) => {
      const next = prev.filter((t) => !pred(t)).map((t) => ({ ...t }));
      const need = round2(grandTotal - sumTenders(next));
      if (need > 0.001 && restIndexOf(next, restOn) < 0) {
        let idx = -1;
        for (let i = next.length - 1; i >= 0; i--) if (!isCreditMode(next[i].paymentMode)) { idx = i; break; }
        if (idx >= 0) next[idx].amount = String(round2((Number(next[idx].amount) || 0) + need));
        else next.push(defaultRow(need));
      }
      return next;
    });
  };

  const amountRefs = useRef({});
  const focusRow = (i) => {
    setActiveIdx(i);
    requestAnimationFrame(() => { const el = amountRefs.current[i]; if (el) { el.focus(); el.select?.(); } });
  };
  // Single-payment mode: the segmented picker changes THAT row's method.
  const pickMethod = (value) => {
    setTouched(true);
    setPopover(null);
    if (tenders.length === 1 && !isCreditMode(tenders[0].paymentMode)) updateTender(0, { paymentMode: value });
  };

  // ── split mode ──
  const restIdx = restIndexOf(tenders, restOn);
  // REST = total minus every other row, never below 0. Kept in state so everything downstream (entered, leftover,
  // submit, receipt) keeps reading plain tender amounts.
  useEffect(() => {
    if (restIdx < 0 || !tenders[restIdx]) return;
    const others = round2(tenders.reduce((sum, t, i) => (i === restIdx ? sum : sum + (Number(t.amount) > 0 ? Number(t.amount) : 0)), 0));
    const want = Math.max(0, round2(grandTotal - others));
    if ((Number(tenders[restIdx].amount) || 0) !== want) updateTender(restIdx, { amount: String(want) });
  }, [tenders, grandTotal, restIdx]);

  const openMenu = (idx) => {
    const el = methodBtnRefs.current[idx];
    if (el) setMenu({ idx, rect: el.getBoundingClientRect() });
  };
  // Closing the menu without choosing drops a new row that still has no method.
  const closeMenu = () => {
    setMenu(null);
    setTenders((prev) => (prev.some((t) => !t.paymentMode) ? prev.filter((t) => t.paymentMode) : prev));
  };
  useEffect(() => {
    if (pendingOpen == null) return;
    openMenu(pendingOpen);
    setPendingOpen(null);
  }, [pendingOpen, tenders.length]);
  const chooseMethod = (value) => {
    const idx = menu?.idx;
    if (idx == null) return;
    setTouched(true);
    updateTender(idx, { paymentMode: value });
    closeMenu();
    focusRow(idx);
  };
  // "Split across methods" / "Add another method": always available. The new row has NO method (staff choose it),
  // its menu opens straight away, and it is prefilled with what's still uncovered (empty when fully covered).
  const addSplit = () => {
    setTouched(true);
    if (tenders.length <= 1) setRestOn(true);
    addTenderRow(setTenders, { amount: leftover > 0 ? String(leftover) : '', paymentMode: '' });
    setPendingOpen(tenders.length);
  };
  const dropRow = (i) => {
    setTouched(true);
    removeTender(i);
    if (tenders.length - 1 <= 1) setRestOn(true);
  };
  const overrideRest = (i) => { setRestOn(false); focusRow(i); };
  const startLeaveDue = () => {
    setTouched(true);
    setLeaveDue(true);
    if (!dueHolderName.trim() && guestName) setDueHolderName(guestName);
  };
  useEffect(() => { if (leaveDue && leftover <= 0.001) setLeaveDue(false); }, [leaveDue, leftover]);

  // A specific voucher chosen through "Redeem a voucher code": one compact credit row, sized to what it can
  // cover, with the cash/card rows shrinking by the same amount (same mechanics as the wallet).
  const applyVoucherCode = (v) => {
    if (tenders.some((t) => t.paymentMode === 'VoucherWallet' && t.voucherId === v.voucher_id)) { setShowVoucherSearch(false); return; }
    applyCredit('VoucherWallet', Number(v.remaining_balance), {
      voucherId: v.voucher_id,
      voucherLabel: v.voucher_code,
      voucherRemainingBalance: Number(v.remaining_balance),
    });
    setShowVoucherSearch(false);
  };
  const toggleAddOn = (id) => {
    setTouched(true);
    setCheckedAddOns((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  // ── Payment QR (migration-303): a static merchant QR per method. Optional and UI-only: a fetch or image failure
  // just means the row behaves like any other method, and confirmation is a gate, never part of the payload. ──
  const [qrMap, setQrMap] = useState({});
  const [qrBroken, setQrBroken] = useState(() => new Set()); // methods whose QR image failed to load
  const [qrOpenIdx, setQrOpenIdx] = useState(null); // split: the row whose QR card is open
  const [presentIdx, setPresentIdx] = useState(null); // the row shown full screen to the guest
  const presentConfirmRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    getPaymentMethodQrs().then(({ data }) => { if (!cancelled) setQrMap(data || {}); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const qrFor = (t) => (t && t.paymentMode && Number(t.amount) > 0 ? qrMap[t.paymentMode] || null : null);
  const qrUsable = (t) => !!qrFor(t)?.url && !qrBroken.has(t.paymentMode);
  const usableQrMap = useMemo(
    () => Object.fromEntries(Object.entries(qrMap).filter(([m, q]) => q?.url && !qrBroken.has(m))),
    [qrMap, qrBroken]
  );
  const pendingQr = pendingQrRows(tenders, usableQrMap);
  // A lone QR row needs no separate confirm step: the primary itself reads "Confirm NPR X received".
  const qrSingle = tenders.length === 1 && !isCreditMode(tenders[0].paymentMode) && qrUsable(tenders[0]);
  const markQrBroken = (method) => setQrBroken((prev) => (prev.has(method) ? prev : new Set(prev).add(method)));
  const confirmQrRow = (i) => {
    setTouched(true);
    updateTender(i, { qrConfirmed: qrSignature(tenders[i]) });
    setQrOpenIdx(null);
    setPresentIdx(null);
  };
  useEffect(() => { if (presentIdx != null) requestAnimationFrame(() => presentConfirmRef.current?.focus()); }, [presentIdx]);
  // Row indexes shift when a row is added or removed, so close any open QR card / overlay rather than re-point it.
  useEffect(() => { setQrOpenIdx(null); setPresentIdx(null); }, [tenders.length]);

  // ── validation shown as the primary button's reason (handleSubmit keeps its own guards as a safety net) ──
  const walletOver = (membershipUsable && membershipCommitted > membership.balance)
    || (referralWalletUsable && referralWalletCommitted > referralReward.walletBalance)
    || (voucherPoolUsable && voucherPoolCommitted > voucherPoolBalance)
    || appliedVoucherBalances.some((v) => (voucherWalletCommittedByVoucher.get(v.voucherId) || 0) > v.remainingBalance);
  const tipActive = showTip && Number(tip) > 0;
  const productDue = dueState({ treatmentDue, productsTotal, tenders: tenders.filter((t) => t.paymentMode && Number(t.amount) > 0) });
  const busyFirst = Object.keys(cp.busy)[0];
  const blockReason = (() => {
    if (memberOnly) return '';
    if (busyFirst) return `Fix ${cp.lines.find((l) => l.variantId === busyFirst)?.name || 'the product'} first`;
    if (referralRewardBlocksPayment) return 'Apply the referral reward first';
    if (tenders.some((t) => !t.paymentMode)) return 'Choose a method for the new row';
    if (entered <= 0 && leftover <= 0) return 'Enter an amount';
    if (entered > grandTotal) return `Over the total by NPR ${fmt(round2(entered - grandTotal))}`;
    if (walletOver) return 'A wallet or voucher amount exceeds its balance';
    if (productDue.belowProducts) return `Products need NPR ${fmt(productDue.shortBy)} more from a money method`;
    if (treatmentOnlyOverflow(tenders.filter((t) => t.paymentMode && Number(t.amount) > 0), treatmentDue) > 0.001) return 'Vouchers and packages pay the treatment only';
    if (leftover > 0 && !leaveDue) return `${fmt(leftover)} not covered yet`;
    if (leftover > 0 && !dueHolderName.trim()) return 'Add who the remaining due is under';
    if (!qrSingle && pendingQr.length === 1) return `Confirm the ${tenderLabel(tenders[pendingQr[0]])} payment`;
    if (!qrSingle && pendingQr.length > 1) return `Confirm ${pendingQr.length} QR payments`;
    if (tipActive && tipRecipients.some((r) => !r.receivedBy || !(Number(r.amount) > 0))) return 'Choose who received the tip';
    if (tipActive && Math.abs(tipRecipientsTotal - round2(Number(tip))) > 0.001) return 'Tip split must add up to the tip';
    return '';
  })();
  const canSubmit = !blockReason && !busy;
  const primaryLabel = memberOnly ? 'Save member discount' : qrSingle
    ? `Confirm NPR ${fmt(entered)} received${leftover > 0 ? ` · ${fmt(leftover)} due` : ''}`
    : entered > 0 ? (leftover > 0 ? `Collect ${fmt(entered)} · ${fmt(leftover)} due` : `Collect NPR ${fmt(entered)}`) : `Leave NPR ${fmt(leftover)} due`;

  const doSubmit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    try { await handleSubmit(); } finally { submittingRef.current = false; }
  };

  const requestClose = () => {
    if (busy) return;
    if (receipt) { onClose?.({ paid: true }); return; }
    if (touched) { setConfirmDiscard(true); return; }
    onClose?.();
  };

  // Snapshot for the success state / receipt (taken at submit, so the booking refreshing underneath can't change it).
  const buildReceipt = (cleaned, tipAmount, tipSplits, extra = null) => {
    const staffName = (id) => branchStaffOptions.find((s) => s.id === id)?.name || 'staff';
    const gross = Number(booking.base_amount ?? booking.baseAmount ?? 0) > 0 ? Number(booking.base_amount ?? booking.baseAmount) : finalAmount;
    const mainMember = memberState[mainBookingId];
    const memberLine = (st) => ({ label: `★ ${st.md.tierName} ${st.md.pct}% off`, amount: -st.memberAmount, sub: true, member: true });
    const discount = mainMember?.memberAmount > 0 ? 0 : round2(Number(booking.discount_amount ?? booking.discountAmount ?? 0) - (mainMember?.action === 'remove' ? mainMember.md.amount : 0));
    const lines = [{ label: svcName(booking), amount: gross }];
    if (mainMember?.memberAmount > 0) lines.push(memberLine(mainMember));
    if (discount > 0) lines.push({ label: 'Discount', amount: -discount, sub: true });
    if (alreadyPaid > 0) lines.push({ label: 'Already paid', amount: -alreadyPaid, sub: true });
    additionalBookings.forEach((b) => {
      const st = memberState[b.bookingId];
      const memberHere = st?.md?.kind === 'apply' && st.on; // add-on lines show what is still due, so only a fresh member discount gets its own line
      lines.push({ label: `${svcName(b)} · ${b.bookingNumber || ''}`.replace(/ · $/, ''), amount: round2(bookingDue(b) + (memberHere ? st.delta : 0)) });
      if (memberHere) lines.push({ ...memberLine(st), amount: -st.delta });
    });
    const tenderRows = tenders
      .filter((t) => t.paymentMode && Number(t.amount) > 0 && (t.paymentMode !== 'SessionPackage' || t.packageId))
      .map((t) => {
        const change = isCash(t) ? computeChange(t.received, t.amount) : null;
        return {
          label: tenderLabel(t),
          amount: round2(t.amount),
          detail: change ? `received ${fmt(Number(t.received))}, change ${fmt(change)}` : '',
        };
      });
    const walletAfter = [];
    if (membershipUsable && membershipCommitted > 0) walletAfter.push({ label: 'Wallet balance now', amount: round2(membership.balance - membershipCommitted) });
    if (referralWalletUsable && referralWalletCommitted > 0) walletAfter.push({ label: 'Referral wallet now', amount: round2(referralReward.walletBalance - referralWalletCommitted) });
    if (voucherPoolUsable && voucherPoolCommitted > 0) walletAfter.push({ label: 'Voucher balance now', amount: round2(voucherPoolBalance - voucherPoolCommitted) });
    // Products (V26): the receipt is one document in two parts; the treatment keeps its methods, the products get theirs.
    let productPart = null;
    if (cp.count > 0 && extra?.split) {
      const shortSeller = (id) => { const w = String(cp.sellerName(id) || '').trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : (w[0] || ''); };
      const sums = (list, labelOf) => {
        const m = new Map();
        list.forEach((e) => { const k = labelOf(e); m.set(k, round2((m.get(k) || 0) + e.amount)); });
        return [...m].map(([label, amount]) => ({ label, amount }));
      };
      const labelFor = (e) => tenderLabel(tenders.find((t) => t.paymentMode === e.paymentMode && (e.paymentMode !== 'VoucherWallet' || t.voucherId === e.voucherId)) || e);
      const sales = extra.sales || [];
      const stockBits = cp.lines.map((l) => {
        const sale = sales.find((x) => x.variantId === l.variantId);
        return sale ? `${l.name}${l.size ? ` ${l.size}` : ''} ${sale.stockBefore} → ${sale.stockAfter}` : null;
      }).filter(Boolean);
      const sellerIds = [...new Set(cp.lines.map((l) => cp.sellerOf(l)).filter(Boolean))];
      productPart = {
        lines: cp.lines.map((l) => ({ label: `${l.name}${l.size ? ` · ${l.size}` : ''}`, qty: l.qty, amount: lineTotal(l.price, l.qty) })),
        tenders: sums(extra.split.product, (e) => labelFor(e)),
        treatmentTenders: sums(extra.split.treatment, (e) => labelFor(e)),
        total: productsTotal,
        stockLine: stockBits.length ? `Stock updated at ${branchName || 'this branch'}: ${stockBits.join(', ')}.` : '',
        creditLine: sellerIds.length ? (() => { const names = sellerIds.map(shortSeller).join(' and '); return `The sale is credited to ${names}${names.endsWith('.') ? '' : '.'}`; })() : 'No commission on this sale.',
        perLine: splitAcrossLines(cp.lines.map((l) => lineTotal(l.price, l.qty)), extra.split.product),
      };
    }
    return {
      orgName, branchName, guestName, guestPhone, bookingNumber,
      dateLabel: new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      lines, tenders: productPart ? productPart.treatmentTenders : tenderRows, total: entered, leftover, extraCount: additionalBookings.length,
      products: productPart,
      hasMember: lines.some((l) => l.member), lineTotal: round2(grandTotal - productsTotal),
      tipTotal: tipAmount,
      tipLabel: tipAmount > 0 ? `Tip to ${tipSplits.map((s) => staffName(s.receivedBy)).join(', ')}` : '',
      walletAfter,
    };
  };

  // ── keyboard: Esc = dirty guard, Enter = primary, Tab trapped inside the dialog ──
  // Registered on window (capture) so it keeps working when focus has left the dialog (e.g. after a
  // stray click on the backdrop) and so a page behind us never sees the same Esc/Enter.
  const onKeyDown = (e) => {
    if (presentIdx != null) {
      // The guest-facing QR overlay owns the keyboard: Esc closes only it; Enter activates its focused button natively.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPresentIdx(null); }
      return;
    }
    if ((e.key === 'Escape' || e.key === 'Enter') && (dialogRef.current?.querySelector('[role="listbox"]') || document.querySelector('[data-checkout-menu]'))) return; // an open CustomSelect / method menu owns the key
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (popover) { setPopover(null); return; }
      if (confirmDiscard) { setConfirmDiscard(false); return; }
      requestClose();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      const tag = e.target.tagName;
      if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' || e.defaultPrevented || confirmDiscard || popover) return;
      e.preventDefault();
      e.stopPropagation();
      if (receipt) onClose?.({ paid: true });
      else doSubmit();
      return;
    }
    if (e.key === 'Tab' && dialogRef.current && (dialogRef.current.contains(e.target) || e.target === document.body)) {
      const items = Array.from(dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
        .filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.target === document.body) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (e.target === first || e.target === dialogRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && e.target === last) { e.preventDefault(); first.focus(); }
    }
  };

  const keyHandlerRef = useRef(onKeyDown);
  keyHandlerRef.current = onKeyDown;
  useEffect(() => {
    const h = (e) => keyHandlerRef.current(e);
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (firstAmountRef.current) { firstAmountRef.current.focus(); firstAmountRef.current.select?.(); }
      else dialogRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => { if (receipt) dialogRef.current?.focus(); }, [receipt]);

  const printReceipt = () => {
    const w = window.open('', '_blank', 'width=420,height=680');
    if (!w) return;
    w.document.write(buildReceiptHtml(receipt));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };
  const whatsappUrl = receipt ? buildWhatsAppUrl(receipt.guestPhone, buildReceiptText(receipt)) : null;

  // ───────────────────────── render helpers ─────────────────────────
  const openPopover = (kind, value, el) => setPopover({ kind, value, rect: el.getBoundingClientRect() });

  const topItems = PAYMENT_TREE.slice(0, 4);
  const moreItems = PAYMENT_TREE.slice(4);
  const activeTender = activeTenderIdx >= 0 ? tenders[activeTenderIdx] : null;
  const itemIsActive = (item) => !!activeTender && (String(activeTender.paymentMode) === String(item.value)
    || (item.subMethods || []).some((s) => String(s.value) === String(activeTender.paymentMode)));
  const onSegClick = (item, el) => {
    if (item.subMethods && item.subMethods.length > 0) openPopover('sub', item.value, el);
    else pickMethod(item.value);
  };

  const inputBase = 'h-8 w-[120px] rounded-[7px] border bg-white px-2.5 text-right text-[13px] font-medium tabular-nums text-[#0E0D0C] focus:outline-none focus:border-[#B9C7B6] focus:ring-[3px] focus:ring-primary/10';

  // ───────────────────────── render ─────────────────────────
  const dueFraction = grandTotal > 0 ? Math.min(entered / grandTotal, 1) : 0;
  const fullyCovered = grandTotal > 0 && leftover <= 0.001 && entered > 0;

  const singleMode = tenders.length === 1 && !isCreditMode(tenders[0].paymentMode);

  // The QR card under a row: the code, what to collect, and (in a split) the row's own confirm button.
  const qrWhere = [orgName, branchName].filter(Boolean).join(', ');
  const renderQrCard = (t, i) => {
    const usable = qrUsable(t);
    const label = tenderLabel(t);
    return (
      <div className="border-t border-[#F1F1EF] px-3 py-3 flex gap-4" data-testid="qr-card">
        <div className="w-[140px] h-[140px] flex-none rounded-[8px] border border-[#E7E8E6] bg-white p-2 grid place-items-center">
          {usable
            ? <img src={qrFor(t).url} alt={`${label} QR code`} onError={() => markQrBroken(t.paymentMode)} className="w-full h-full object-contain" />
            : <Icon name="QrCode" size={28} strokeWidth={1.4} className="text-[#B4B4BA]" />}
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <div className="text-[14px] font-semibold">{label}</div>
          <div className="text-[12.5px] text-[#515152] tabular-nums mt-0.5">NPR {fmt(t.amount)}{qrWhere ? ` · ${qrWhere}` : ''}</div>
          {usable ? (
            <>
              <p className="text-[12.5px] text-[#8A8A90] mt-2 leading-[1.5]">Ask the guest to scan and pay. Once the payment shows in your {label} app, confirm it {singleMode ? 'below' : 'here'}.</p>
              <div className="mt-2.5 flex items-center gap-3 flex-wrap">
                {!singleMode && (
                  <button type="button" onClick={() => confirmQrRow(i)}
                    className="h-8 px-3 rounded-[7px] border border-[#E7E8E6] bg-white text-[12.5px] font-medium inline-flex items-center gap-1.5 hover:bg-[#F7F7F5]">
                    <Icon name="Check" size={13} strokeWidth={2.2} className="text-primary" />Confirm NPR {fmt(t.amount)} received
                  </button>
                )}
                <button type="button" onClick={() => setPresentIdx(i)} className="text-primary font-medium text-[12.5px] inline-flex items-center gap-1.5 hover:underline">
                  <Icon name="Maximize2" size={13} strokeWidth={2} />Present to guest
                </button>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-[#8A8A90] mt-2 inline-flex items-center gap-1.5"><Icon name="AlertCircle" size={13} className="flex-none" />QR couldn't load. Take the payment as usual.</p>
          )}
        </div>
      </div>
    );
  };

  // "Present to guest": the QR full screen over Checkout. Only what the guest needs (QR, amount, method, who is
  // being paid); no booking or guest details. Esc / ✕ / a click outside close only this overlay.
  const presentT = presentIdx != null ? tenders[presentIdx] : null;
  const confirmFromOverlay = () => {
    if (qrSingle) { setPresentIdx(null); doSubmit(); }
    else confirmQrRow(presentIdx);
  };
  const presentEl = presentT && qrUsable(presentT) && (
    <div className="fixed inset-0 z-notification flex items-center justify-center p-4 bg-[rgba(24,22,20,.86)] backdrop-blur-xl" data-testid="qr-present"
      role="dialog" aria-modal="true" aria-label={`${tenderLabel(presentT)} QR for the guest`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); setPresentIdx(null); } }}>
      <div className="relative bg-white rounded-[16px] px-8 pt-7 pb-6 flex flex-col items-center text-center max-w-[calc(100vw-32px)] shadow-[0_24px_64px_-12px_rgba(14,13,12,.45)]">
        <button type="button" aria-label="Close QR" onClick={() => setPresentIdx(null)}
          className="absolute top-3 right-3 w-8 h-8 rounded-md grid place-items-center text-[#8A8A90] hover:bg-[#F4F4F2]"><Icon name="X" size={18} /></button>
        {qrWhere && <div className="text-[13px] text-[#8A8A90]">{qrWhere}</div>}
        <div className="mt-0.5 text-[15px] font-semibold">{tenderLabel(presentT)}</div>
        <img src={qrFor(presentT).url} alt={`${tenderLabel(presentT)} QR code`} onError={() => { markQrBroken(presentT.paymentMode); setPresentIdx(null); }}
          className="mt-5 object-contain w-[min(calc(100vh-280px),480px)] h-[min(calc(100vh-280px),480px)] max-w-full" />
        <div className="mt-4 text-[30px] leading-none font-semibold tabular-nums"><span className="text-[15px] font-medium text-[#8A8A90] mr-1.5">NPR</span>{fmt(presentT.amount)}</div>
        <p className="text-[13px] text-[#8A8A90] mt-2">Scan with your banking or wallet app to pay</p>
        <button ref={presentConfirmRef} type="button" onClick={confirmFromOverlay} disabled={qrSingle && !canSubmit}
          className="mt-5 h-10 px-5 rounded-[9px] bg-primary text-white text-[13.5px] font-medium inline-flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25">
          <Icon name="Check" size={15} strokeWidth={2.2} />Confirm NPR {fmt(presentT.amount)} received
        </button>
        {qrSingle && !canSubmit && blockReason && <p className="mt-2 text-[12px] text-[#B45309]">{blockReason}</p>}
      </div>
    </div>
  );
  const menuEl = menu && tenders[menu.idx] && createPortal(
    <MethodMenu rect={menu.rect} tree={PAYMENT_TREE}
      usedValues={new Set(tenders.filter((x, xi) => xi !== menu.idx && x.paymentMode).map((x) => String(x.paymentMode)))}
      activeValue={tenders[menu.idx].paymentMode} onPick={chooseMethod} onClose={closeMenu} />,
    document.body
  );
  const popoverEl = popover && createPortal(
    <PopoverList
      rect={popover.rect}
      onClose={() => setPopover(null)}
      groups={popover.kind === 'sub'
        ? [{ title: null, items: (PAYMENT_TREE.find((i) => i.value === popover.value)?.subMethods || []) }]
        : moreItems.map((i) => (i.subMethods && i.subMethods.length ? { title: i.label, items: i.subMethods } : { title: null, items: [i] }))}
      activeValue={activeTender?.paymentMode}
      onPick={pickMethod}
    />,
    document.body
  );

  const dialog = receipt ? (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Payment collected"
      className="checkout-dialog bg-white rounded-[14px] w-[440px] max-w-[calc(100vw-32px)] h-[min(640px,calc(100vh-64px))] flex flex-col outline-none shadow-[0_0_0_1px_rgba(14,13,12,.06),0_2px_4px_rgba(14,13,12,.04),0_24px_64px_-12px_rgba(14,13,12,.28)] animate-fade-in">
      <div className="px-7 py-7 text-center overflow-y-auto flex-1 min-h-0"><div className="min-h-full flex flex-col justify-center">
        <div className="w-10 h-10 rounded-full bg-[#EEF3EC] text-primary grid place-items-center mx-auto"><Icon name="Check" size={20} strokeWidth={2.2} /></div>
        <div className="mt-3.5 text-[12.5px] text-[#8A8A90]">{receipt.memberOnly ? 'Member discount saved · nothing left to pay' : 'Payment collected'}</div>
        <div className="text-[30px] font-semibold tracking-[-1px] mt-0.5 tabular-nums"><span className="text-[15px] font-medium text-[#8A8A90] mr-1.5 tracking-normal">NPR</span>{fmt(receipt.total)}</div>
        <div className="text-[13px] text-[#515152] mt-0.5">
          {receipt.guestName && <>{receipt.guestName} · </>}
          {receipt.leftover > 0
            ? <span className="text-[#B45309]">NPR {fmt(receipt.leftover)} still due</span>
            : <>{receipt.bookingNumber}{receipt.extraCount > 0 ? ` + ${receipt.extraCount} more` : ''} {receipt.extraCount > 0 ? 'are' : 'is'} fully paid</>}
        </div>
        <div className="mt-5 border-t border-[#E7E8E6] text-left text-[13px] pb-1">
          {receipt.products && <div className="pt-3 pb-1 text-[11px] font-medium text-[#8A8A90] tracking-[.04em] uppercase">Treatment</div>}
          {(receipt.hasMember || receipt.products) && (
            <div data-receipt-lines>
              {receipt.lines.map((l, i) => (
                <div key={`l${i}`} className={`flex justify-between items-center h-9 border-b border-[#F1F1EF] ${l.member ? 'text-[#9A6B0B]' : l.sub ? 'text-[#8A8A90]' : 'text-[#515152]'}`}>
                  <span className="inline-flex items-center gap-1.5">{l.member && <Icon name="Star" size={11} className="fill-current" strokeWidth={0} />}{l.member ? l.label.replace(/^★ /, '') : l.label}</span>
                  <span className="tabular-nums">{l.amount < 0 ? `−${fmt(-l.amount)}` : fmt(l.amount)}</span>
                </div>
              ))}
              {!receipt.products && <div className="flex justify-between items-center h-9 border-b border-[#F1F1EF] font-semibold"><span>Total</span><span className="tabular-nums">{fmt(receipt.lineTotal)}</span></div>}
            </div>
          )}
          {receipt.tenders.map((t, i) => (
            <div key={i} className="flex justify-between items-center h-9 border-b border-[#F1F1EF]">
              <span className="text-[#515152]">{t.label}{t.detail && <span className="text-[#8A8A90]"> · {t.detail}</span>}</span>
              <span className="tabular-nums">{fmt(t.amount)}</span>
            </div>
          ))}
          {receipt.products && (
            <div data-receipt-products>
              <div className="pt-4 pb-1 text-[11px] font-medium text-[#8A8A90] tracking-[.04em] uppercase">Products</div>
              {receipt.products.lines.map((l, i) => (
                <div key={`p${i}`} className="flex justify-between items-center h-9 border-b border-[#F1F1EF] text-[#515152]">
                  <span>{l.label} <span className="text-[#8A8A90]">× {l.qty}</span></span><span className="tabular-nums">{fmt(l.amount)}</span>
                </div>
              ))}
              {receipt.products.tenders.map((t, i) => (
                <div key={`pt${i}`} className="flex justify-between items-center h-9 border-b border-[#F1F1EF] text-[#8A8A90]"><span>{t.label}</span><span className="tabular-nums">{fmt(t.amount)}</span></div>
              ))}
              {(receipt.products.stockLine || receipt.products.creditLine) && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#F7F7F5] px-3 py-2.5 text-[12.5px] text-[#515152]" data-receipt-stock>
                  <Icon name="Package" size={13} className="mt-0.5 flex-none text-[#8A8A90]" />
                  <span>{receipt.products.stockLine} {receipt.products.creditLine}</span>
                </div>
              )}
            </div>
          )}
          {receipt.tipTotal > 0 && (
            <div className="flex justify-between items-center h-9 border-b border-[#F1F1EF] text-[#8A8A90]"><span>{receipt.tipLabel}, recorded separately</span><span className="tabular-nums">{fmt(receipt.tipTotal)}</span></div>
          )}
          {receipt.walletAfter.map((w, i) => (
            <div key={i} className="flex justify-between items-center h-9 border-b border-[#F1F1EF] last:border-b-0 text-[#8A8A90]"><span>{w.label}</span><span className="tabular-nums">{fmt(w.amount)}</span></div>
          ))}
        </div>
      </div></div>
      <div className="h-16 px-5 border-t border-[#E7E8E6] flex items-center gap-2 flex-none">
        <button type="button" onClick={printReceipt} className="h-9 px-3.5 rounded-[7px] border border-[#E7E8E6] bg-white text-[13px] font-medium inline-flex items-center gap-2 hover:bg-[#F7F7F5]"><Icon name="Printer" size={15} strokeWidth={1.6} />Print</button>
        {whatsappUrl && (
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="h-9 px-3.5 rounded-[7px] border border-[#E7E8E6] bg-white text-[13px] font-medium inline-flex items-center gap-2 hover:bg-[#F7F7F5]"><Icon name="MessageCircle" size={15} strokeWidth={1.6} />WhatsApp</a>
        )}
        <button type="button" autoFocus onClick={() => onClose?.({ paid: true })} className="ml-auto h-9 pl-4 pr-3 rounded-[7px] bg-primary text-white text-[13px] font-medium inline-flex items-center gap-2 shadow-[0_1px_2px_rgba(45,90,39,.25)]">Done<kbd className="text-[10.5px] px-1.5 rounded border border-white/25 bg-white/10 font-sans">↵</kbd></button>
      </div>
    </div>
  ) : (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Checkout"
      className={`checkout-dialog relative bg-white rounded-[14px] ${cp.available ? 'w-[960px]' : 'w-[900px]'} max-w-[calc(100vw-32px)] h-[min(640px,calc(100vh-64px))] flex flex-col outline-none shadow-[0_0_0_1px_rgba(14,13,12,.06),0_2px_4px_rgba(14,13,12,.04),0_24px_64px_-12px_rgba(14,13,12,.28)] animate-fade-in text-[13px] text-[#0E0D0C]`}>
      {/* Header */}
      <div className="h-[60px] pl-6 pr-5 flex items-center gap-3 border-b border-[#E7E8E6] flex-none">
        <h2 className="text-[15px] font-semibold tracking-[-.2px]">Checkout</h2>
        <span className="flex items-center gap-2 text-[#8A8A90] min-w-0">
          {guestName && <b className="font-medium text-[#515152] truncate">{guestName}</b>}
          <span className="whitespace-nowrap">· {bookingNumber}</span>
          {tierName && (
            <span className="inline-flex items-center gap-1 h-5 px-[7px] rounded-full bg-[#FBF3DF] text-[#9A6B0B] text-[11px] font-semibold">
              <Icon name="Star" size={10} className="fill-current" strokeWidth={0} />{tierName}
            </span>
          )}
        </span>
        <kbd className="ml-auto text-[10.5px] font-medium text-[#8A8A90] border border-[#E7E8E6] rounded px-[5px] py-px bg-white font-sans">Esc</kbd>
        <button type="button" onClick={requestClose} disabled={busy} aria-label="Close" className="w-[30px] h-[30px] rounded-[7px] grid place-items-center text-[#8A8A90] hover:bg-[#F4F4F2]"><Icon name="X" size={16} /></button>
      </div>

      {/* Body */}
      <div className={`grid grid-cols-1 ${cp.available ? 'min-[960px]:grid-cols-[430px_minmax(0,1fr)]' : 'min-[960px]:grid-cols-[380px_minmax(0,1fr)]'} min-[960px]:grid-rows-[minmax(0,1fr)] flex-1 overflow-y-auto min-[960px]:overflow-hidden min-h-0`}
        onInputCapture={() => setTouched(true)}
        onClickCapture={(e) => { if (e.target.closest && e.target.closest('button, input, label')) setTouched(true); }}>
        {/* Left: paying for */}
        <div className={`px-6 pt-5 ${Number(tip) > 0 ? 'pb-44' : 'pb-5'} min-[960px]:border-r border-b min-[960px]:border-b-0 border-[#E7E8E6] bg-[#FCFCFB] min-[960px]:overflow-y-auto min-h-0`}>
          <SectionLabel>Paying for</SectionLabel>
          <div className="flex items-center gap-2.5 h-[38px]">
            <Check on disabled />
            <span className="flex-1 min-w-0 truncate">{svcName(booking)}{bookingRowInfo?.service?.duration_minutes ? ` · ${bookingRowInfo.service.duration_minutes} min` : ''}{bookingRowInfo?.therapist?.name && <small className="text-[#8A8A90] text-[12px]"> · {bookingRowInfo.therapist.name}</small>}</span>
            <span className="font-medium tabular-nums">{fmt(Number(booking.base_amount ?? booking.baseAmount ?? 0) > 0 ? Number(booking.base_amount ?? booking.baseAmount) : finalAmount)}</span>
          </div>
          {Number(booking.discount_amount ?? booking.discountAmount ?? 0) > 0
            && memberState[mainBookingId]?.md?.kind !== 'saved'
            && !(memberState[mainBookingId]?.md?.kind === 'better' && memberState[mainBookingId]?.on) && (
            <div className="flex items-center h-[30px] text-[#8A8A90]">
              <span className="flex-1 pl-6 truncate">Discount{memberCtx?.[mainBookingId]?.booking?.discountReason ? ` · ${memberCtx[mainBookingId].booking.discountReason}` : ''}</span>
              <span className="tabular-nums">−{fmt(Number(booking.discount_amount ?? booking.discountAmount))}</span>
            </div>
          )}
          <MemberLine st={memberState[mainBookingId]} onToggle={(v) => setMemberChoice(mainBookingId, v)} />
          {alreadyPaid > 0 && (
            <div className="flex items-center h-[30px] text-[#8A8A90]"><span className="flex-1 pl-6">Already paid</span><span className="tabular-nums">−{fmt(alreadyPaid)}</span></div>
          )}

          {candidates.length > 0 && (
            <div className="mt-5">
              <SectionLabel>Add to this payment</SectionLabel>
              {candidates.map((b) => {
                const on = checkedAddOns.has(b.bookingId);
                const earlier = b.amountDue !== undefined && b.amountDue !== null;
                const d = b.date ? new Date(`${b.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
                return (
                  <React.Fragment key={b.bookingId}>
                  <button type="button" role="checkbox" aria-checked={on} onClick={() => toggleAddOn(b.bookingId)}
                    className="w-full flex items-center gap-2.5 h-[38px] border-b border-[#F1F1EF] last:border-b-0 text-left">
                    <Check on={on} />
                    <span className="flex-1 min-w-0 truncate">
                      {earlier ? 'Earlier balance' : svcName(b)}
                      <small className="text-[#8A8A90] text-[12px]"> · {earlier ? `${svcName(b)} · ${b.bookingNumber || ''}${d ? `, ${d}` : ''}` : `${b.bookingNumber || ''} · same group`}</small>
                    </span>
                    <span className={`tabular-nums font-medium ${on ? '' : 'text-[#515152]'}`}>{fmt(bookingDue(b))}</span>
                  </button>
                  {on && <MemberLine st={memberState[b.bookingId]} onToggle={(v) => setMemberChoice(b.bookingId, v)} />}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {skippedBookingsPreview.length > 0 && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-[#FEF7E8] border border-[#F3E2B8] text-[12px] text-[#92600A]">
              <Icon name="AlertTriangle" size={13} className="mt-0.5 flex-none" />
              <span>Entered amount won't cover {skippedBookingsPreview.map((s) => s.bookingNumber || s.bookingId).join(', ')}. {skippedBookingsPreview.length > 1 ? 'These stay' : 'This stays'} unpaid.</span>
            </div>
          )}

          {activePendingReward && (
            <div className="mt-5 rounded-lg border border-[#F3E2B8] bg-[#FEF7E8] p-3 space-y-2">
              <div className="flex items-start gap-2 text-[12.5px] text-[#92600A]">
                <Icon name="Gift" size={14} className="mt-0.5 flex-none" />
                <p>{activePendingReward.referredName} they referred has completed a visit. This customer has earned a referral reward.</p>
              </div>
              {canResolveReferralReward ? (
                <>
                  <input type="text" inputMode="decimal" value={rewardAmount} onChange={(e) => setRewardAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="Wallet credit, e.g. 500 (blank = org default)"
                    className="w-full h-9 px-3 rounded-[7px] border border-[#E7E8E6] bg-white text-[13px] focus:outline-none focus:border-[#B9C7B6] focus:ring-[3px] focus:ring-primary/10" />
                  <Button type="button" variant="outline" size="sm" onClick={handleResolveReferralReward} loading={rewardSubmitting} disabled={rewardSubmitting}>Apply as wallet credit</Button>
                  {rewardError && <p className="text-xs text-error">{rewardError}</p>}
                </>
              ) : (
                <p className="text-[12px] text-[#92600A]">Ask a manager or admin to apply this referral's wallet reward.</p>
              )}
            </div>
          )}

          {cp.available && <ProductsBlock cp={cp} guestName={guestName} disabled={busy} />}

          {(membershipUsable || referralWalletUsable || (referralReward?.vouchers || []).length > 0 || voucherPoolUsable || VOUCHER_ENABLED || packagesUsable) && (
            <div className="mt-5">
              <SectionLabel>Guest credit</SectionLabel>
              {membershipUsable && (
                <CreditRow icon="Wallet" title="Membership wallet"
                  applied={membershipCommitted > 0}
                  sub={membershipCommitted > 0 ? `${fmt(membershipCommitted)} applied · ${fmt(walletRemaining)} remains` : `${fmt(membership.balance)} available`}
                  onApply={() => applyCredit('Membership', membership.balance)}
                  onRemove={() => removeCredit((t) => t.paymentMode === 'Membership')} />
              )}
              {referralWalletUsable && (
                <CreditRow icon="Wallet" title="Referral wallet"
                  applied={referralWalletCommitted > 0}
                  sub={referralWalletCommitted > 0 ? `${fmt(referralWalletCommitted)} applied · ${fmt(referralWalletRemaining)} remains` : `${fmt(referralReward.walletBalance)} available`}
                  onApply={() => applyCredit('ReferralWallet', referralReward.walletBalance)}
                  onRemove={() => removeCredit((t) => t.paymentMode === 'ReferralWallet')} />
              )}
              {(referralReward?.vouchers || []).map((v) => {
                const applied = appliedVoucherReferralIds.includes(v.referralId);
                return (
                  <CreditRow key={v.referralId} icon="Gift" title={v.label || 'Referral voucher'} sub={`${fmt(v.value)} voucher`}
                    applied={applied}
                    onApply={() => { setTouched(true); applyReferralVoucher(v); }}
                    onRemove={() => removeCredit((t) => t.paymentMode === 'ReferralVoucher' && t.referralId === v.referralId)} />
                );
              })}
              {voucherPoolUsable && (
                <CreditRow icon="Ticket" title="Vouchers"
                  applied={voucherPoolCommitted > 0}
                  sub={voucherPoolCommitted > 0 ? `${fmt(voucherPoolCommitted)} applied · ${fmt(round2(voucherPoolBalance - voucherPoolCommitted))} remains` : `${fmt(voucherPoolBalance)} available`}
                  onApply={() => applyCredit('VoucherWallet', voucherPoolBalance)}
                  onRemove={() => removeCredit((t) => t.paymentMode === 'VoucherWallet' && !t.voucherId)} />
              )}
              {customerPackages.map((p) => {
                const selected = selectedPackageTender?.packageId === p.packageId;
                return (
                  <CreditRow key={p.packageId} icon="PackageCheck" title={p.packageName}
                    sub={`${p.sessionsRemaining} of ${p.sessionsTotal} sessions left`}
                    applied={selected}
                    disabledText={!selected && remaining <= 0 ? 'Booking already settled' : (!selected && tenders.length > 1 ? 'Clear other payments first' : null)}
                    onApply={() => { setTouched(true); redeemPackage(p); }}
                    onRemove={() => { setTouched(true); undoPackage(); }} />
                );
              })}
              {appliedVoucherBalances.map((v) => {
                const committed = voucherWalletCommittedByVoucher.get(v.voucherId) || 0;
                return (
                  <CreditRow key={v.voucherId} icon="Ticket" title={`Voucher ${v.code}`} applied
                    sub={`${fmt(committed)} applied · ${fmt(Math.max(0, round2(v.remainingBalance - committed)))} remains`}
                    onRemove={() => removeCredit((t) => t.paymentMode === 'VoucherWallet' && t.voucherId === v.voucherId)} />
                );
              })}
              {VOUCHER_ENABLED && (showVoucherSearch ? (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[12px] text-[#8A8A90] mb-1.5">
                    <span>Redeem a voucher code</span>
                    <button type="button" aria-label="Close voucher search" onClick={() => setShowVoucherSearch(false)} className="w-5 h-5 rounded grid place-items-center hover:bg-[#F4F4F2]"><Icon name="X" size={13} /></button>
                  </div>
                  <VoucherSearchInline onSelect={applyVoucherCode} />
                </div>
              ) : (
                <button type="button" onClick={() => { setTouched(true); setShowVoucherSearch(true); }}
                  className="mt-2 text-[12.5px] text-primary font-medium inline-flex items-center gap-1.5 hover:underline">
                  <Icon name="Ticket" size={13} strokeWidth={1.8} />Redeem a voucher code
                </button>
              ))}
            </div>
          )}

          {/* Tip: separate booking_tips write, never part of the total */}
          <div className="mt-5">
            <SectionLabel hint="Given to staff · not in the total">Tip</SectionLabel>
            {showTip ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[#8A8A90]"><Icon name="Heart" size={14} strokeWidth={1.6} /></span>
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[#B4B4BA]">NPR</span>
                    <AmountInput value={tip} onChange={setTip} placeholder="e.g. 200" aria-label="Tip amount"
                      className="w-full h-8 rounded-[7px] border border-[#E7E8E6] bg-white pl-10 pr-2.5 text-right text-[13px] font-medium tabular-nums focus:outline-none focus:border-[#B9C7B6] focus:ring-[3px] focus:ring-primary/10" />
                  </div>
                  <button type="button" aria-label="Remove tip" onClick={() => { setShowTip(false); setTip(''); setTipRecipients([{ key: nextTipRecipientKey(), receivedBy: '', amount: '' }]); }}
                    className="w-6 h-6 rounded-md grid place-items-center text-[#8A8A90] hover:bg-[#F4F4F2]"><Icon name="X" size={14} /></button>
                </div>
                {Number(tip) > 0 && (
                  <div className="space-y-2 pl-6">
                    <div className="flex items-center justify-between text-[12px] text-[#8A8A90]">
                      <span>Received by</span>
                      {tipRecipients.length > 1 && <span className="tabular-nums">{fmt(tipRecipientsTotal)} / {fmt(round2(Number(tip)))}</span>}
                    </div>
                    {tipRecipients.map((r) => (
                      <div key={r.key} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <CustomSelect value={r.receivedBy} onChange={(v) => updateTipRecipient(r.key, { receivedBy: v })}
                            options={branchStaffOptions.map((s) => ({ value: s.id, label: s.name }))} placeholder="Who got this tip?" searchable size="sm" />
                        </div>
                        {tipRecipients.length > 1 && (
                          <AmountInput value={r.amount} onChange={(v) => updateTipRecipient(r.key, { amount: v })} placeholder="0" aria-label="Recipient amount"
                            className="w-20 h-8 rounded-[7px] border border-[#E7E8E6] bg-white px-2 text-right text-[13px] tabular-nums focus:outline-none focus:border-[#B9C7B6]" />
                        )}
                        {tipRecipients.length > 1 && (
                          <button type="button" aria-label="Remove recipient" onClick={() => removeTipRecipient(r.key)} className="w-6 h-6 rounded-md grid place-items-center text-[#8A8A90] hover:bg-[#F4F4F2]"><Icon name="X" size={13} /></button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={addTipRecipient} className="text-[12px] text-primary font-medium inline-flex items-center gap-1 hover:underline"><Icon name="Plus" size={12} />Split with another person</button>
                  </div>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => setShowTip(true)} className="inline-flex items-center gap-2 text-[#515152] hover:text-[#0E0D0C]">
                <Icon name="Heart" size={14} strokeWidth={1.6} />Add a tip
              </button>
            )}
          </div>
        </div>

        {/* Right: amount due + tenders */}
        <div className="min-w-0 min-h-0 flex flex-col">
         <div className="px-6 pt-5 flex-none">
          <div className="flex items-center justify-between gap-3 text-[12.5px] text-[#8A8A90]">
            <span>Amount due</span>
            {memberSavings > 0 && <span className="inline-flex items-center gap-1.5 text-[#9A6B0B]" data-member-saves><Icon name="Star" size={11} className="fill-current" strokeWidth={0} />Member saves NPR {fmt(memberSavings)}</span>}
          </div>
          <div className="text-[34px] leading-[1.1] font-semibold tracking-[-1.1px] mt-0.5 tabular-nums">
            {memberDeltaIncluded > 0 && <s className="text-[13px] font-normal text-[#B4B4BA] tracking-normal mr-2 align-middle" data-was>{fmt(round2(grandTotal + memberDeltaIncluded))}</s>}
            <span className="text-[16px] font-medium text-[#8A8A90] tracking-normal mr-1.5">NPR</span>{fmt(grandTotal)}
          </div>
          {productsTotal > 0 && (
            <div className="text-[12.5px] text-[#8A8A90] tabular-nums mt-0.5" data-due-split>Treatment <b className="font-medium text-[#515152]">{fmt(treatmentDue)}</b> · Products <b className="font-medium text-[#515152]">{fmt(productsTotal)}</b></div>
          )}
          <span className="sr-only" role="status" aria-live="polite">{productsTotal > 0 ? `Amount due NPR ${fmt(grandTotal)}: treatment ${fmt(treatmentDue)}, products ${fmt(productsTotal)}.` : ''}{busyFirst ? ` ${cp.busy[busyFirst].message}` : ''}</span>
          <div className="h-[3px] rounded-sm bg-[#F1F1EF] mt-3.5 mb-1.5 overflow-hidden"><i className={`block h-full transition-all ${leftover > 0.001 && entered > 0 ? 'bg-[#C99A2E]' : 'bg-primary'}`} style={{ width: `${dueFraction * 100}%` }} /></div>
          <div className="flex justify-between text-[12px] text-[#8A8A90]">
            <span className="tabular-nums">{entered > 0 ? `${fmt(Math.min(entered, grandTotal))} of ${fmt(grandTotal)} covered` : 'Nothing entered yet'}</span>
            {leftover > 0.001
              ? <span className="text-[#B45309] tabular-nums">{fmt(leftover)} left</span>
              : fullyCovered && pendingQr.length > 0
                ? <span className="text-[#B45309] inline-flex items-center gap-1.5" data-testid="qr-status"><i className="w-1.5 h-1.5 rounded-full bg-warning" />Not confirmed yet</span>
                : fullyCovered && <span className="text-primary inline-flex items-center gap-1"><Icon name="Check" size={12} strokeWidth={2.4} />Fully covered</span>}
          </div>

          {singleMode ? (
            <>
              <div className="mt-5 mb-2 text-[12.5px] text-[#515152]">How is the guest paying?</div>
              {/* Method picker: the org's configured methods. In single-payment mode it changes the one row's method. */}
              <div className="flex bg-[#F4F4F2] rounded-[9px] p-[3px] gap-[3px]" role="group" aria-label="Payment method">
                {topItems.map((item) => {
                  const on = itemIsActive(item);
                  const sub = on && item.subMethods?.length ? leafLabel(activeTender.paymentMode) : item.label;
                  return (
                    <button key={item.value} type="button" aria-pressed={on} onClick={(e) => onSegClick(item, e.currentTarget)}
                      className={`flex-auto min-w-0 h-[34px] rounded-[7px] inline-flex items-center justify-center gap-1.5 px-2.5 font-medium whitespace-nowrap ${on ? 'bg-white text-[#0E0D0C] shadow-[0_0_0_1px_rgba(14,13,12,.06),0_1px_2px_rgba(14,13,12,.08)]' : 'text-[#515152] hover:text-[#0E0D0C]'}`}>
                      {on && <Icon name={methodIcon(item.value)} size={15} strokeWidth={1.6} className="flex-none" />}
                      <span className="truncate whitespace-nowrap">{sub}</span>
                      {on && item.subMethods?.length > 0 && <Icon name="ChevronDown" size={12} className="flex-none opacity-60" />}
                    </button>
                  );
                })}
                {moreItems.length > 0 && (
                  <button type="button" aria-pressed={!!activeTender && moreItems.some(itemIsActive)} onClick={(e) => openPopover('more', null, e.currentTarget)}
                    className={`flex-auto min-w-0 h-[34px] rounded-[7px] inline-flex items-center justify-center gap-1.5 px-2.5 font-medium whitespace-nowrap ${activeTender && moreItems.some(itemIsActive) ? 'bg-white text-[#0E0D0C] shadow-[0_0_0_1px_rgba(14,13,12,.06),0_1px_2px_rgba(14,13,12,.08)]' : 'text-[#515152] hover:text-[#0E0D0C]'}`}>
                    <span className="truncate">{activeTender && moreItems.some(itemIsActive) ? leafLabel(activeTender.paymentMode) : 'More'}</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="mt-5 flex items-baseline justify-between text-[12px]">
              <span className="text-[13px] font-medium text-[#515152]">Payments</span>
              <span className="text-[#8A8A90]">Each row is one method</span>
            </div>
          )}
         </div>

         {error && (
           <div role="alert" className="mx-6 mt-3 flex-none flex items-start gap-2 px-3 py-2.5 rounded-lg bg-error/5 border border-error/20 text-[12.5px] text-error">
             <Icon name="AlertCircle" size={14} className="mt-0.5 flex-none" /><span>{error}</span>
           </div>
         )}

         {/* Only this area scrolls: the payments list, split link, gap box, note */}
         <div className="relative flex-1 min-h-0">
          <div ref={listRef} onScroll={measureFade} className="min-[960px]:h-full min-[960px]:overflow-y-auto px-6 pt-3 pb-5" data-testid="checkout-scroll">
          {/* Tender list */}
          {tenders.length > 0 && (
            <div className="border border-[#E7E8E6] rounded-[10px]">
              {tenders.map((t, i) => {
                const credit = isCreditMode(t.paymentMode);
                const isMembership = t.paymentMode === 'Membership';
                const isReferralWallet = t.paymentMode === 'ReferralWallet';
                const isVoucherWallet = t.paymentMode === 'VoucherWallet';
                const isSessionPackage = t.paymentMode === 'SessionPackage';
                const isVoucherPoolRow = isVoucherWallet && !t.voucherId && voucherPoolUsable;
                const overWallet = isMembership && Number(t.amount) > Number(membership?.balance || 0);
                const overReferralWallet = isReferralWallet && Number(t.amount) > Number(referralReward?.walletBalance || 0);
                const overVoucherPool = isVoucherPoolRow && voucherPoolCommitted > voucherPoolBalance;
                const overVoucherWallet = isVoucherWallet && t.voucherId && (voucherWalletCommittedByVoucher.get(t.voucherId) || 0) > t.voucherRemainingBalance;
                const over = overWallet || overReferralWallet || overVoucherPool || overVoucherWallet;
                let hint = '';
                if (isMembership) hint = overWallet ? `Exceeds wallet balance (${fmt(membership?.balance || 0)})` : `${fmt(walletRemaining)} remains after this`;
                else if (isReferralWallet) hint = overReferralWallet ? `Exceeds balance (${fmt(referralReward?.walletBalance || 0)})` : `${fmt(referralWalletRemaining)} remains after this`;
                else if (isVoucherPoolRow) hint = overVoucherPool ? `Exceeds voucher balance (${fmt(voucherPoolBalance)})` : `${fmt(Math.max(0, round2(voucherPoolBalance - voucherPoolCommitted)))} voucher balance left`;
                else if (isVoucherWallet && t.voucherId) hint = overVoucherWallet ? `Exceeds this voucher (${fmt(t.voucherRemainingBalance)})` : `${fmt(Math.max(0, round2(t.voucherRemainingBalance - (voucherWalletCommittedByVoucher.get(t.voucherId) || 0))))} remains on voucher`;
                else if (isSessionPackage) hint = 'One session, covers this booking';
                else if (t.paymentMode === 'ReferralVoucher') hint = 'Referral voucher';
                if (productsTotal > 0 && isTreatmentOnly(t.paymentMode)) hint = 'Covers the treatment only';
                const isActive = i === activeTenderIdx && !credit;
                const isRest = i === restIdx;
                const label = tenderLabel(t);
                const usedElsewhere = new Set(tenders.filter((x, xi) => xi !== i && x.paymentMode).map((x) => String(x.paymentMode)));
                return (
                  <div key={i} data-row={i} className={i > 0 ? 'border-t border-[#F1F1EF]' : ''}>
                    <div className="flex items-center gap-2.5 px-3 py-2.5" onFocusCapture={() => !credit && setActiveIdx(i)}>
                      {credit || singleMode ? (
                        <>
                          <span className="text-[#515152] flex-none"><Icon name={methodIcon(t.paymentMode)} size={16} strokeWidth={1.6} /></span>
                          <span className="flex-1 min-w-0">
                            <span className="block font-medium truncate">{label}</span>
                            {hint && <span className={`block text-[12px] truncate tabular-nums ${over ? 'text-error' : 'text-[#8A8A90]'}`}>{hint}</span>}
                          </span>
                        </>
                      ) : (
                        <>
                          <button type="button" data-method-trigger aria-haspopup="listbox" aria-expanded={menu?.idx === i} aria-label={`Method for row ${i + 1}: ${t.paymentMode ? label : 'not chosen'}`}
                            ref={(el) => { methodBtnRefs.current[i] = el; }}
                            onClick={() => (menu?.idx === i ? closeMenu() : openMenu(i))}
                            className={`h-8 w-[168px] flex-none rounded-[7px] border bg-white px-2.5 inline-flex items-center gap-2 text-left ${menu?.idx === i ? 'border-[#B9C7B6] ring-[3px] ring-primary/10' : 'border-[#E7E8E6] hover:bg-[#F7F7F5]'}`}>
                            <span className="text-[#515152] flex-none"><Icon name={t.paymentMode ? methodIcon(t.paymentMode) : 'CircleDollarSign'} size={15} strokeWidth={1.6} /></span>
                            <span className={`flex-1 min-w-0 truncate whitespace-nowrap ${t.paymentMode ? 'font-medium' : 'text-[#8A8A90]'}`}>{t.paymentMode ? label : 'Choose method'}</span>
                            <Icon name="ChevronDown" size={13} className="flex-none opacity-60" />
                          </button>
                          <span className="flex-1" />
                          {qrFor(t) && (isQrConfirmed(t) && qrUsable(t) ? (
                            <span className="inline-flex items-center gap-1 flex-none text-[12px]" data-testid="qr-received">
                              <span className="inline-flex items-center gap-1 text-primary font-medium"><Icon name="CheckCircle2" size={13} strokeWidth={2} />Received</span>
                              <button type="button" aria-label={`Undo: ${label} not received yet`} title="Undo" onClick={() => updateTender(i, { qrConfirmed: null })}
                                className="w-[22px] h-[22px] rounded-md grid place-items-center text-[#8A8A90] hover:bg-[#F4F4F2] hover:text-[#0E0D0C]"><Icon name="Undo2" size={13} strokeWidth={1.8} /></button>
                            </span>
                          ) : (
                            <button type="button" aria-label={`Show ${label} QR`} aria-expanded={qrOpenIdx === i} onClick={() => setQrOpenIdx(qrOpenIdx === i ? null : i)}
                              className={`h-8 px-2 rounded-[7px] border inline-flex items-center gap-1.5 text-[12px] font-medium flex-none ${qrOpenIdx === i ? 'border-[#B9C7B6] bg-[#EEF3EC] text-primary' : 'border-[#E7E8E6] text-[#515152] hover:bg-[#F7F7F5]'}`}>
                              <Icon name="QrCode" size={14} strokeWidth={1.6} />QR
                            </button>
                          ))}
                        </>
                      )}
                      {(isSessionPackage || t.paymentMode === 'ReferralVoucher' ? (
                        <span className="w-[120px] text-right font-medium tabular-nums pr-2.5">{fmt(t.amount)}</span>
                      ) : isRest ? (
                        <button type="button" aria-label={`${label} amount, rest of the bill: ${fmt(t.amount)}. Click to set it yourself`} onClick={() => overrideRest(i)} onFocus={() => overrideRest(i)}
                          className="h-8 w-[120px] flex-none rounded-[7px] bg-[#EEF3EC] px-2.5 inline-flex items-center justify-between text-primary">
                          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold tracking-[.04em]"><Icon name="Link2" size={11} strokeWidth={2.2} />REST</span>
                          <span className="text-[13px] font-medium tabular-nums">{fmt(t.amount)}</span>
                        </button>
                      ) : (
                        <AmountInput
                          ref={(el) => { amountRefs.current[i] = el; if (i === 0) firstAmountRef.current = el; }}
                          value={t.amount} aria-label={`${label} amount`} disabled={!t.paymentMode}
                          onChange={(v) => updateTender(i, { amount: v })}
                          onBlur={(e) => { if (tenders.length > 1 && !(Number(t.amount) > 0) && !e.currentTarget.closest('[data-row]')?.contains(e.relatedTarget)) removeTender(i); }}
                          className={`${inputBase} ${over ? 'border-error' : isActive && tenders.length > 1 ? 'border-[#B9C7B6]' : 'border-[#E7E8E6]'} disabled:bg-[#FAFAF9]`} />
                      ))}
                      {(tenders.length > 1 || isSessionPackage) && (
                        <button type="button" aria-label={`Remove ${label}`} onClick={() => { if (isSessionPackage) { setTouched(true); undoPackage(); } else if (credit) { setTouched(true); removeCredit((x) => x === t); if (tenders.length - 1 <= 1) setRestOn(true); } else dropRow(i); }}
                          className="w-[22px] h-[22px] rounded-md grid place-items-center text-[#8A8A90] hover:bg-[#F4F4F2] flex-none"><Icon name="X" size={14} /></button>
                      )}
                    </div>
                    {qrFor(t) && (singleMode || (qrOpenIdx === i && !(isQrConfirmed(t) && qrUsable(t)))) && renderQrCard(t, i)}
                  </div>
                );
              })}
            </div>
          )}

          {restIdx >= 0 && (
            <p className="mt-2 text-[12px] text-[#8A8A90] inline-flex items-start gap-1.5"><Icon name="Link2" size={12} className="mt-0.5 flex-none text-primary" /><span><b className="font-medium text-primary">Rest</b> = whatever the other rows don't cover. Type in it to set it yourself.</span></p>
          )}

          <div>
            <button type="button" onClick={addSplit} className="mt-2.5 text-primary font-medium text-[12.5px] inline-flex items-center gap-1.5 hover:underline">
              <Icon name={singleMode ? 'Split' : 'Plus'} size={13} strokeWidth={2} />{singleMode ? 'Split across methods' : 'Add another method'}
            </button>
          </div>

          <BusyNotice cp={cp} />

          {productsTotal > 0 && tenders.some((t) => isTreatmentOnly(t.paymentMode)) && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#F7F7F5] px-3 py-2.5 text-[12.5px] text-[#515152]" data-testid="treatment-only-note">
              <Icon name="Ticket" size={13} className="mt-0.5 flex-none text-[#8A8A90]" />
              <span>Service vouchers and packages pay for treatments, never products. Cash, card, wallets and the membership wallet can pay for anything.</span>
            </div>
          )}

          {leftover > 0.001 && productDue.belowProducts && (
            <div className="mt-3 relative rounded-[10px] border border-dashed border-[#E6C46F] bg-[#FEF7E8] px-3 py-2.5" data-testid="checkout-gap" data-products-short>
              <div className="flex items-center gap-2 text-[#92600A]"><Icon name="AlertCircle" size={14} className="flex-none" /><span><b className="font-semibold tabular-nums">NPR {fmt(productDue.shortBy)}</b> short of the products</span></div>
              <p className="mt-1 text-[12.5px] text-[#515152]">Products are always paid in full today. Only the treatment can stay due, so you can't enter less than <b className="font-medium tabular-nums">{fmt(productsTotal)}</b> in cash, card or wallets.</p>
              <div className="mt-2"><button type="button" onClick={addSplit} className="h-8 px-3 rounded-[7px] border border-[#E6C46F] bg-white text-[12.5px] font-medium text-[#0E0D0C] inline-flex items-center gap-1.5 hover:bg-[#FFFDF7]"><Icon name="Plus" size={13} strokeWidth={2} />Pay it with another method</button></div>
            </div>
          )}

          {leftover > 0.001 && !productDue.belowProducts && (
            <div className="mt-3 relative rounded-[10px] border border-dashed border-[#E6C46F] bg-[#FEF7E8] px-3 py-2.5" data-testid="checkout-gap">
              {!leaveDue ? (
                <>
                  <div className="flex items-center gap-2 text-[#92600A]"><Icon name="AlertCircle" size={14} className="flex-none" /><span><b className="font-semibold tabular-nums">NPR {fmt(leftover)}</b> not covered yet</span></div>
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" onClick={addSplit} className="h-8 px-3 rounded-[7px] border border-[#E6C46F] bg-white text-[12.5px] font-medium text-[#0E0D0C] inline-flex items-center gap-1.5 hover:bg-[#FFFDF7]"><Icon name="Plus" size={13} strokeWidth={2} />Pay it with another method</button>
                    <button type="button" onClick={startLeaveDue} className="h-8 px-3 rounded-[7px] text-[12.5px] font-medium text-[#92600A] hover:bg-[#FBEFD0]">Leave as due</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[#92600A]">
                    <span className="inline-flex items-center gap-2"><Icon name="AlertCircle" size={14} className="flex-none" /><span><b className="font-semibold tabular-nums">NPR {fmt(leftover)}</b> stays due</span></span>
                    <button type="button" onClick={() => setLeaveDue(false)} className="text-[12.5px] font-medium hover:underline">Undo</button>
                  </div>
                  {productsTotal > 0 && <p className="mt-1 text-[12px] text-[#92600A]" data-due-note>The products are paid in full; this is the treatment only.</p>}
                  <label htmlFor="due-holder" className="block text-[12px] text-[#515152] mt-2 mb-1">Who is responsible for it? <span className="text-error">*</span></label>
                  <input id="due-holder" type="text" value={dueHolderName} autoComplete="off"
                    onChange={(e) => { setDueHolderName(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    placeholder="Responsible person's name"
                    className="w-full h-9 px-3 rounded-[7px] border border-[#E7E8E6] bg-white text-[13px] focus:outline-none focus:border-[#B9C7B6] focus:ring-[3px] focus:ring-primary/10" />
                  {showSuggestions && filteredSuggestions.length > 0 && (
                    <div className="absolute z-dropdown left-3 right-3 mt-1 bg-white border border-[#E7E8E6] rounded-lg shadow-spa-elevated max-h-44 overflow-y-auto">
                      {filteredSuggestions.map((name) => (
                        <button key={name} type="button" onMouseDown={() => { setDueHolderName(name); setShowSuggestions(false); }}
                          className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F7F7F5]">{name}</button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="mt-4">
            {showNotes ? (
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Note about this payment" aria-label="Payment note" autoFocus
                className="w-full rounded-[7px] border border-[#E7E8E6] bg-white px-3 py-2 text-[13px] placeholder:text-[#B4B4BA] focus:outline-none focus:border-[#B9C7B6] focus:ring-[3px] focus:ring-primary/10 resize-none" />
            ) : (
              <button type="button" onClick={() => setShowNotes(true)} className="text-[12.5px] text-[#515152] inline-flex items-center gap-1.5 hover:text-[#0E0D0C]"><Icon name="StickyNote" size={13} strokeWidth={1.6} />Add a note</button>
            )}
          </div>

          {cashAmount > 0 && (() => {
            const cash = tenders[cashIdx];
            if (!cash.calc) {
              return (
                <div className="mt-2.5">
                  <button type="button" onClick={() => { focusReceivedRef.current = true; updateTender(cashIdx, { calc: true }); }} className="text-[12.5px] text-[#515152] inline-flex items-center gap-1.5 hover:text-[#0E0D0C]"><Icon name="Calculator" size={13} strokeWidth={1.6} />Work out change</button>
                </div>
              );
            }
            const received = Number(cash.received) || 0;
            const diff = round2(received - cashAmount);
            return (
              <div className="mt-2.5 relative rounded-[10px] border border-[#E7E8E6] bg-[#FAFAF9] px-3 py-2.5" data-testid="change-calc">
                <button type="button" aria-label="Close change calculator" onClick={() => updateTender(cashIdx, { calc: false, received: '' })}
                  className="absolute top-2 right-2 w-[22px] h-[22px] rounded-md grid place-items-center text-[#8A8A90] hover:bg-[#F1F1EF]"><Icon name="X" size={14} /></button>
                <div className="text-[12px] text-[#8A8A90] pr-7">Cash to collect <b className="font-medium text-[#0E0D0C] tabular-nums">NPR {fmt(cashAmount)}</b></div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[#515152]">Guest handed over</span>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[#B4B4BA]">NPR</span>
                    <AmountInput value={cash.received || ''} aria-label="Cash received"
                      ref={(el) => { if (el && focusReceivedRef.current) { focusReceivedRef.current = false; el.focus(); } }}
                      onChange={(v) => updateTender(cashIdx, { received: v })}
                      className="h-8 w-[120px] rounded-[7px] border border-[#E7E8E6] bg-white pl-9 pr-2.5 text-right text-[13px] font-medium tabular-nums focus:outline-none focus:border-[#B9C7B6] focus:ring-[3px] focus:ring-primary/10" />
                  </div>
                  {quickCashOptions(cashAmount).map((v) => (
                    <button key={v} type="button" onClick={() => updateTender(cashIdx, { received: String(v) })} aria-pressed={received === v}
                      className={`h-7 px-2.5 rounded-[7px] border text-[12px] font-medium tabular-nums ${received === v ? 'border-[#B9C7B6] bg-[#EEF3EC] text-primary' : 'border-[#E7E8E6] bg-white text-[#515152] hover:bg-[#F7F7F5] hover:text-[#0E0D0C]'}`}>
                      {fmt(v)}
                    </button>
                  ))}
                </div>
                <div className="mt-2 min-h-[22px] flex items-center" aria-live="polite" data-testid="change-result">
                  {!(received > 0) ? (
                    <span className="text-[12px] text-[#8A8A90]">Tap a note or type what the guest handed over</span>
                  ) : diff > 0.001 ? (
                    <span className="text-[#515152]">Give back <b className="text-[15px] font-semibold text-primary tabular-nums">NPR {fmt(diff)}</b></span>
                  ) : diff < -0.001 ? (
                    <span className="text-warning tabular-nums">NPR {fmt(-diff)} short of the cash amount</span>
                  ) : (
                    <span className="text-[#515152]">Exact amount · no change</span>
                  )}
                </div>
              </div>
            );
          })()}

          </div>
          {fade.top && <div aria-hidden className="pointer-events-none absolute left-0 right-0 top-0 h-6 bg-gradient-to-b from-white to-transparent" />}
          {fade.bottom && <div aria-hidden className="pointer-events-none absolute left-0 right-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent" />}
         </div>
        </div>
      </div>

      {/* Footer */}
      <div className="min-h-[64px] pl-6 pr-5 py-2 flex items-center gap-3 border-t border-[#E7E8E6] flex-none flex-wrap">
        <span className="text-[#8A8A90] flex gap-4 tabular-nums">
          <span>Total <b className="font-medium text-[#0E0D0C]">{fmt(grandTotal)}</b></span>
          <span>Entered <b className="font-medium text-[#0E0D0C]">{fmt(entered)}</b></span>
          <span>Left <b className="font-medium text-[#0E0D0C]">{fmt(leftover)}</b></span>
        </span>
        {blockReason && <span className="ml-auto text-[12px] text-[#B45309] text-right" data-testid="checkout-reason">{blockReason}</span>}
        <div className={`${blockReason ? '' : 'ml-auto'} flex items-center gap-2.5`}>
          <button type="button" onClick={requestClose} disabled={busy} className="h-9 px-3.5 rounded-[7px] border border-[#E7E8E6] bg-white font-medium hover:bg-[#F7F7F5]">Cancel</button>
          <button type="button" onClick={doSubmit} disabled={!canSubmit} title={blockReason || undefined}
            className="h-9 pl-4 pr-3 rounded-[7px] bg-primary border border-primary text-white font-medium inline-flex items-center gap-2 shadow-[0_1px_2px_rgba(45,90,39,.25),inset_0_1px_0_rgba(255,255,255,.15)] disabled:opacity-45 disabled:cursor-not-allowed">
            {busy ? 'Recording…' : primaryLabel}
            {!busy && <kbd className="text-[10.5px] px-1.5 rounded border border-white/25 bg-white/10 font-sans">↵</kbd>}
          </button>
        </div>
      </div>

      {confirmDiscard && (
        <div className="absolute inset-0 z-10 rounded-[14px] bg-white/70 backdrop-blur-[2px] grid place-items-center">
          <div role="alertdialog" aria-label="Discard payment" className="bg-white rounded-xl border border-[#E7E8E6] shadow-[0_12px_32px_-8px_rgba(14,13,12,.25)] p-5 w-[340px]">
            <div className="font-semibold text-[14px]">Discard this payment?</div>
            <p className="text-[#515152] mt-1">What you entered here hasn't been recorded.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setConfirmDiscard(false)} className="h-9 px-3.5 rounded-[7px] border border-[#E7E8E6] bg-white font-medium hover:bg-[#F7F7F5]">Keep editing</button>
              <button type="button" onClick={() => onClose?.()} className="h-9 px-3.5 rounded-[7px] bg-error text-white font-medium">Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Backdrop: frosted, and a click outside does NOT close (a half-entered payment is too easy to lose).
  return createPortal(
    <div className="fixed inset-0 z-modal-overlay modal-backdrop-frost flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault(); /* a click outside neither closes nor steals focus */ }}>
      {dialog}
      {popoverEl}
      {menuEl}
      {presentEl}
    </div>,
    document.body
  );
};

// Popover list used by the method picker (sub-methods of a group, or the "More" overflow).
// Portalled to <body> with fixed positioning so the dialog's scroll areas can't clip it.
const PopoverList = ({ rect, groups, activeValue, onPick, onClose }) => {
  const ref = useRef(null);
  useEffect(() => {
    const first = ref.current?.querySelector('button');
    first?.focus();
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const width = Math.max(rect.width, 200);
  const left = Math.min(rect.left, window.innerWidth - width - 12);
  const flipUp = rect.bottom + 260 > window.innerHeight;
  return (
    <div ref={ref} role="menu"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const btns = Array.from(ref.current.querySelectorAll('button'));
          const i = btns.indexOf(document.activeElement);
          btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
        }
      }}
      style={{ position: 'fixed', left, width, ...(flipUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) }}
      className="z-notification bg-white border border-[#E7E8E6] rounded-[10px] p-1 shadow-[0_12px_32px_-8px_rgba(14,13,12,.25)] max-h-64 overflow-y-auto text-[13px]">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium uppercase tracking-[.04em] text-[#8A8A90]">{g.title}</div>}
          {g.items.map((it) => (
            <button key={it.value} type="button" role="menuitem" onClick={() => onPick(it.value)}
              className={`w-full flex items-center gap-2 px-2.5 h-9 rounded-md text-left hover:bg-[#F4F4F2] focus:bg-[#F4F4F2] focus:outline-none ${String(activeValue) === String(it.value) ? 'font-medium text-primary' : 'text-[#0E0D0C]'}`}>
              <Icon name={methodIcon(it.value)} size={14} strokeWidth={1.6} className="text-[#515152]" />
              <span className="flex-1 truncate">{it.label}</span>
              {String(activeValue) === String(it.value) && <Icon name="Check" size={13} strokeWidth={2.4} />}
            </button>
          ))}
        </div>
      ))}
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
