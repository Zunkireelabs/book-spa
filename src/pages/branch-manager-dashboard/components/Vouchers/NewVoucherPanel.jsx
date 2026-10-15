import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CountryCodeSelect, { parsePhone } from '../../../../components/ui/CountryCodeSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import MembershipWalletCard from '../../../../components/ui/MembershipWalletCard';
import {
  PanelShell, FormBody, Field, SelectField, TextInput, MoneyInput, DateField, InfoRows, InlineError,
  CONTROL, CONTROL_ERROR, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { useBranch } from '../../../../contexts/BranchContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { fetchVoucherTypes, issueVoucher, createVoucherType, fetchMembershipForCustomer } from '../../../../services/api';
import { addTenderRow, removeTenderRow, updateTenderRow } from '../../../../utils/tenderRows';
import { MEMBERSHIP_ENABLED } from '../../../../lib/featureFlags';
import { toDateInputValue } from '../../../../utils/date';
import { friendlyError } from '../../../../utils/friendlyError';

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const DEFAULT_VALIDITY_DAYS = 90;
const SPLIT = 'grid grid-cols-1 sm:grid-cols-2 gap-3';
const EMPTY_NEW_TYPE = { name: '', codePrefix: '', standardPrice: '', category: 'spa' };
const VOUCHER_TYPE_CATEGORIES = [
  { value: 'spa', label: 'Spa' },
  { value: 'salon', label: 'Salon' },
  { value: 'body_scrub', label: 'Body scrub' },
  { value: 'package', label: 'Package' },
];
const plusDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + n); return toDateInputValue(d); };
const plusYear = (ymd) => { const d = new Date(`${ymd}T00:00:00`); d.setFullYear(d.getFullYear() + 1); return toDateInputValue(d); };
const longDate = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const EXPIRY_CHIPS = [
  { label: '+30', next: (from) => plusDays(from, 30) },
  { label: '+90', next: (from) => plusDays(from, 90) },
  { label: '+180', next: (from) => plusDays(from, 180) },
  { label: '+1 year', next: plusYear },
];

// "New voucher": the right-hand panel (same shell, fields and footer as New booking). Voucher code is entered manually (the
// physical booklet's code, migration-139). Callbacks are unchanged: onClose(), onIssued(issuedVoucher).
const NewVoucherPanel = ({ userRole, onClose, onIssued }) => {
  const { branchId, branchName, isOverall } = useBranch();
  const { profile } = useAuth();
  const { orgId, paymentMethods } = useOrg();
  const isAdmin = userRole === 'admin';
  const today = toDateInputValue(new Date());
  const defaultExpiry = () => plusDays(toDateInputValue(new Date()), DEFAULT_VALIDITY_DAYS);

  const [types, setTypes] = useState(null); // null while loading
  const [loadError, setLoadError] = useState(null);
  const [voucherTypeId, setVoucherTypeId] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [guestName, setGuestName] = useState('');
  const [linkedCustomer, setLinkedCustomer] = useState(null); // the customer picked from the suggestions
  const [guestCountryCode, setGuestCountryCode] = useState('+977');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestOtherInfo, setGuestOtherInfo] = useState('');
  const [actualPrice, setActualPrice] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [discountOutOfRange, setDiscountOutOfRange] = useState(false);
  const [discountTouched, setDiscountTouched] = useState(false);
  const [issuedDate, setIssuedDate] = useState(today);
  const [expiryDate, setExpiryDate] = useState(defaultExpiry);
  const [remarks, setRemarks] = useState('');
  const [showRemarks, setShowRemarks] = useState(false);
  const [membership, setMembership] = useState(null);
  const [tenders, setTenders] = useState([{ amount: '', paymentMode: 'Cash' }]);
  // Fields filled from the pick (and not typed since): cleared again when the pick is dropped.
  const phoneFromPick = useRef(false);

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [issued, setIssued] = useState(null); // the issued voucher (shown as the success state)
  const [copied, setCopied] = useState(false);
  const codeRef = useRef(null);

  const [showNewType, setShowNewType] = useState(false);
  const [newType, setNewType] = useState(EMPTY_NEW_TYPE);
  const [newTypeErrors, setNewTypeErrors] = useState({});
  const [newTypeSubmitting, setNewTypeSubmitting] = useState(false);

  // ── Data ───────────────────────────────────────────────────────────────────────────────────────
  const loadTypes = async ({ selectId } = {}) => {
    const { data, error } = await fetchVoucherTypes();
    if (error) { setLoadError(friendlyError(error, 'Failed to load voucher types.')); setTypes([]); return; }
    setTypes(data || []);
    const pick = selectId ? data?.find((t) => t.id === selectId) : data?.[0];
    if (pick) { setVoucherTypeId(pick.id); setActualPrice(String(pick.standard_price)); }
  };
  useEffect(() => { loadTypes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Focus the first field once the panel has slid in (never scroll an ancestor while it is still moving).
  useEffect(() => {
    if (issued) return undefined;
    const t = setTimeout(() => codeRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, [issued, isOverall]);

  // ── Derived ────────────────────────────────────────────────────────────────────────────────────
  const selectedType = (types || []).find((t) => t.id === voucherTypeId) || null;
  const activeMembership = membership?.status === 'active' ? membership : null;
  const tierRateForType = (type, m = activeMembership) => (type && m ? m.tierDiscountRules?.[type.category] : undefined);
  const tierName = linkedCustomer?.primaryMembership?.tierName || membership?.tierName || '';
  const tierStatus = linkedCustomer?.primaryMembership?.status || membership?.status || '';
  const tierRate = tierRateForType(selectedType);

  const applyTierDiscount = (type, m = activeMembership, touched = discountTouched) => {
    if (touched) return;
    const rate = tierRateForType(type, m);
    setDiscountPercent(typeof rate === 'number' ? String(rate) : '0');
  };

  const handleTypeChange = (id) => {
    setVoucherTypeId(id);
    const t = (types || []).find((x) => x.id === id);
    if (t) setActualPrice(String(t.standard_price));
    applyTierDiscount(t);
    clearError('type');
  };

  const actualPriceNum = Number(actualPrice) || 0;
  const discountNum = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  const totalAmount = useMemo(() => round2(actualPriceNum - (actualPriceNum * discountNum) / 100), [actualPriceNum, discountNum]);
  const discountAmount = round2(actualPriceNum - totalAmount);

  const membershipUsable = !!(MEMBERSHIP_ENABLED && linkedCustomer && membership && membership.balance > 0 && membership.status !== 'depleted');
  const membershipLeaf = membershipUsable ? { value: 'Membership', label: 'Membership' } : null;
  const membershipCommitted = useMemo(() => {
    if (!membershipUsable) return 0;
    return round2(tenders.reduce((s, t) => s + (t.paymentMode === 'Membership' && Number(t.amount) > 0 ? Number(t.amount) : 0), 0));
  }, [tenders, membershipUsable]);
  const walletRemaining = membershipUsable ? Math.max(0, round2(membership.balance - membershipCommitted)) : 0;
  const membershipOverWallet = membershipUsable && membershipCommitted > membership.balance;

  // Default the tender to Membership once the linked wallet can cover the total (only while the tender is untouched).
  useEffect(() => {
    if (!membershipUsable || membership.balance < totalAmount || totalAmount <= 0) return;
    const pristine = tenders.length === 1 && tenders[0].paymentMode === 'Cash' && !(Number(tenders[0].amount) > 0);
    if (pristine) setTenders([{ amount: String(totalAmount), paymentMode: 'Membership' }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipUsable, membership?.balance, totalAmount]);

  // Round each tender to 2dp before summing (matches the RPC's per-tender numeric(10,2) cast).
  const tenderTotal = useMemo(() => tenders.reduce((s, t) => {
    const amount = round2(Number(t.amount) || 0);
    return s + (amount > 0 ? amount : 0);
  }, 0), [tenders]);
  const tenderRemaining = useMemo(() => round2(totalAmount - tenderTotal), [totalAmount, tenderTotal]);

  const initialPrice = selectedType ? String(selectedType.standard_price) : '';
  const dirty = !!(voucherCode || guestName || guestPhone || guestOtherInfo || remarks || tenderTotal > 0
    || issuedDate !== today || expiryDate !== defaultExpiry() || (initialPrice && actualPrice !== initialPrice) || discountTouched);

  const reason = types === null ? 'Loading voucher types…'
    : !voucherTypeId ? 'Pick a voucher type'
    : !voucherCode.trim() ? 'Enter the code'
    : !guestName.trim() ? 'Enter the guest name'
    : membershipOverWallet ? 'Wallet balance too low'
    : tenderRemaining > 0 ? `Collect ${formatNPR(tenderRemaining)} more`
    : tenderRemaining < 0 ? `${formatNPR(-tenderRemaining)} over the total`
    : '';

  // ── Handlers ───────────────────────────────────────────────────────────────────────────────────
  const clearError = (key) => { setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e)); setServerError(null); };

  useEffect(() => {
    if (!discountOutOfRange) return undefined;
    const t = setTimeout(() => setDiscountOutOfRange(false), 3000);
    return () => clearTimeout(t);
  }, [discountOutOfRange]);

  // Editing the guest name drops the link and everything the pick supplied: the membership (and its tier discount, unless the
  // user set the discount themselves) and the phone.
  const onGuestNameChange = (val) => {
    setGuestName(val);
    clearError('guest');
    if (linkedCustomer) {
      setLinkedCustomer(null);
      setMembership(null);
      applyTierDiscount(selectedType, null);
      if (phoneFromPick.current) setGuestPhone('');
      phoneFromPick.current = false;
      // The wallet belonged to the picked guest: a Membership tender falls back to Cash (same amount).
      setTenders((prev) => prev.map((t) => (t.paymentMode === 'Membership' ? { ...t, paymentMode: 'Cash' } : t)));
    }
  };

  const onGuestSelect = async (customer) => {
    setGuestName(customer.full_name);
    setLinkedCustomer(customer);
    clearError('guest');
    if (customer.phone) {
      const { dial, national } = parsePhone(customer.phone);
      setGuestCountryCode(dial);
      setGuestPhone(national);
      phoneFromPick.current = true;
    }
    // A newly-selected guest is a fresh context: their tier discount applies even if a previous one was overridden.
    setDiscountTouched(false);
    const { data: m } = await fetchMembershipForCustomer(customer.id);
    const active = m?.status === 'active' ? m : null;
    setMembership(m);
    applyTierDiscount(selectedType, active, false);
  };

  const onDiscountChange = (raw) => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    const n = Number(cleaned);
    const out = cleaned !== '' && n > 100;
    setDiscountOutOfRange(out);
    setDiscountPercent(out ? '100' : cleaned);
    setDiscountTouched(true);
  };

  const handleCreateNewType = async () => {
    const errs = {};
    if (!newType.name.trim()) errs.name = 'Enter the type name.';
    if (!newType.codePrefix.trim()) errs.codePrefix = 'Enter the code prefix.';
    if (newType.standardPrice === '' || !(Number(newType.standardPrice) >= 0)) errs.standardPrice = 'Enter the standard price.';
    setNewTypeErrors(errs);
    if (Object.keys(errs).length) return;
    setNewTypeSubmitting(true);
    const { data, error } = await createVoucherType({
      orgId, name: newType.name, codePrefix: newType.codePrefix, standardPrice: Number(newType.standardPrice), category: newType.category,
    });
    setNewTypeSubmitting(false);
    if (error) { setNewTypeErrors({ form: friendlyError(error, 'Failed to create voucher type.') }); return; }
    setNewType(EMPTY_NEW_TYPE);
    setNewTypeErrors({});
    setShowNewType(false);
    await loadTypes({ selectId: data.id });
  };

  const submit = async () => {
    if (submittingRef.current || reason || isOverall) return;
    const next = {};
    const code = voucherCode.trim();
    const phoneDigits = digitsOf(guestPhone);
    if (phoneDigits && (phoneDigits.length < 7 || phoneDigits.length > 15)) next.phone = 'Enter a valid phone number (7–15 digits).';
    if (issuedDate > today) next.issued = "The issued date can't be in the future.";
    if (!expiryDate || expiryDate < issuedDate) next.expiry = 'Expiry date cannot be before the issued date.';
    const hasMembershipTender = tenders.some((t) => t.paymentMode === 'Membership' && Number(t.amount) > 0);
    if (hasMembershipTender && !linkedCustomer) next.pay = 'Pick the guest from the suggestions to pay by Membership.';
    setErrors(next);
    const first = ['phone', 'issued', 'expiry', 'pay'].find((k) => next[k]);
    if (first) {
      const el = document.getElementById(`vch-${first}`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setServerError(null);
    // Guest Info is one column: a phone number takes priority (it makes the voucher searchable by phone at payment time,
    // migration-085); the free-text company / club is used when there's no phone.
    const { data, error } = await issueVoucher({
      branchId,
      voucherTypeId,
      voucherCode: code,
      guestName: guestName.trim(),
      guestInfo: phoneDigits ? `${guestCountryCode}${phoneDigits}` : (guestOtherInfo.trim() || null),
      discountPercent: discountNum,
      actualPrice: actualPriceNum,
      issuedDate,
      expiryDate,
      remarks: remarks.trim() || null,
      customerId: linkedCustomer?.id || null,
      tenders: tenders
        .map((t) => ({ amount: round2(Number(t.amount) || 0), paymentMode: t.paymentMode }))
        .filter((t) => t.amount > 0),
    });
    submittingRef.current = false;
    setSubmitting(false);
    if (error) {
      if (/already in use/i.test(error.message || '')) {
        setErrors({ code: `${code} is already in use.` });
        const el = document.getElementById('vch-code');
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      setServerError(friendlyError(error, 'Failed to issue voucher.'));
      return;
    }
    setIssued(data);
  };

  // ⌘/Ctrl+Enter submits when the primary is enabled; Enter in a single-line field never does (this is not a <form>).
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !issued) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [issued]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(issued.voucher_code); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // "Issue another": reset everything except the voucher type.
  const issueAnother = () => {
    const t = selectedType;
    setIssued(null);
    setVoucherCode(''); setGuestName(''); setLinkedCustomer(null); setMembership(null); setGuestPhone(''); setGuestOtherInfo('');
    setGuestCountryCode('+977'); setActualPrice(t ? String(t.standard_price) : ''); setDiscountPercent('0'); setDiscountTouched(false);
    setIssuedDate(today); setExpiryDate(defaultExpiry()); setRemarks(''); setShowRemarks(false);
    setTenders([{ amount: '', paymentMode: 'Cash' }]); setErrors({}); setServerError(null);
    phoneFromPick.current = false;
  };

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────
  const typeOptions = (types || []).map((t) => ({ value: t.id, label: `${t.name}${t.is_wallet ? ' (wallet)' : ''} — ${formatNPR(t.standard_price)}` }));
  const guestInputClass = CONTROL;
  const updateTender = (i, patch) => { updateTenderRow(setTenders, i, patch); clearError('pay'); };

  // Success state: the panel body becomes the receipt.
  if (issued) {
    return (
      <PanelShell
        variant="panel"
        title="New voucher"
        onClose={() => onIssued(issued)}
        footerOverride={(
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={issueAnother} className="h-9 px-3 text-[13px] font-body font-body-medium text-text-secondary hover:text-text-primary hover:bg-black/[0.04] rounded-spa spa-transition-fast whitespace-nowrap">Issue another</button>
            <button type="button" onClick={() => onIssued(issued)} className="h-9 px-4 text-[13px] font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast whitespace-nowrap">Done</button>
          </div>
        )}
      >
        <div className="px-5 py-10 text-center" role="status" aria-live="polite">
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
            <Icon name="Check" size={24} className="text-success" />
          </div>
          <h4 className="font-heading font-heading-semibold text-[15px] text-text-primary">Voucher issued</h4>
          <p className="mt-3 font-data font-data-medium text-2xl text-primary tracking-wide break-all">{issued.voucher_code}</p>
          <button type="button" onClick={copyCode} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-body-medium text-primary hover:underline">
            <Icon name={copied ? 'Check' : 'Copy'} size={13} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <p className="mt-4 text-[13px] text-text-secondary tabular-nums">
            {formatNPR(issued.total_amount_issued)} · {guestName.trim()} · expires {longDate(expiryDate)}
          </p>
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      variant="panel"
      title="New voucher"
      onClose={onClose}
      dirty={dirty}
      busy={submitting}
      reason={reason}
      primary={isOverall ? undefined : {
        label: submitting ? 'Issuing…' : (totalAmount > 0 ? `Issue · ${formatNPR(totalAmount)}` : 'Issue'),
        onClick: submit,
        disabled: !!reason || types === null,
        loading: submitting,
      }}
    >
      {isOverall ? (
        <FormBody>
          <div className="py-10 text-center">
            <Icon name="Ticket" size={28} className="text-text-tertiary mx-auto mb-3" />
            <p className="text-[13px] text-text-secondary">Vouchers are issued from one branch. Switch branch in the header to continue.</p>
          </div>
        </FormBody>
      ) : (
        <FormBody>
          <p className="-mt-1 text-xs text-text-secondary">
            {branchName}{profile?.full_name ? ` · issued by ${profile.full_name}` : ''}
          </p>
          <InlineError message={serverError || loadError} />

          <Field label="Voucher type" required id="vch-type" error={errors.type}>
            <SelectField
              value={voucherTypeId}
              onChange={handleTypeChange}
              options={typeOptions}
              placeholder={types === null ? 'Loading…' : 'Select voucher type'}
              disabled={types === null || (types || []).length === 0}
            />
            {selectedType?.is_wallet && (
              <p className="mt-1.5 text-xs text-text-secondary">Stored-value voucher — the guest can redeem it across several visits until the balance runs out.</p>
            )}
            {isAdmin && !showNewType && (
              <button type="button" onClick={() => setShowNewType(true)} className="mt-1.5 text-[13px] font-body-medium text-primary hover:underline">+ New type</button>
            )}
          </Field>

          {isAdmin && showNewType && (
            <div className="border border-border rounded-spa p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-heading font-heading-semibold text-[13px] text-text-primary">New voucher type</h4>
                <button type="button" aria-label="Close new type" onClick={() => { setShowNewType(false); setNewType(EMPTY_NEW_TYPE); setNewTypeErrors({}); }} className="p-1 rounded-spa hover:bg-black/[0.05] text-text-secondary">
                  <Icon name="X" size={14} />
                </button>
              </div>
              <InlineError message={newTypeErrors.form} />
              <div className={SPLIT}>
                <Field label="Name" required id="vch-nt-name" error={newTypeErrors.name}>
                  <TextInput {...controlA11y('vch-nt-name', newTypeErrors.name)} error={newTypeErrors.name} value={newType.name} onChange={(e) => { setNewType((p) => ({ ...p, name: e.target.value })); setNewTypeErrors((x) => ({ ...x, name: undefined })); }} />
                </Field>
                <Field label="Code prefix" required id="vch-nt-prefix" error={newTypeErrors.codePrefix}>
                  <TextInput {...controlA11y('vch-nt-prefix', newTypeErrors.codePrefix)} error={newTypeErrors.codePrefix} className="font-data uppercase" placeholder="NT 4326" value={newType.codePrefix} onChange={(e) => { setNewType((p) => ({ ...p, codePrefix: e.target.value.toUpperCase() })); setNewTypeErrors((x) => ({ ...x, codePrefix: undefined })); }} />
                </Field>
              </div>
              <div className={SPLIT}>
                <Field label="Standard price" required id="vch-nt-price" error={newTypeErrors.standardPrice}>
                  <MoneyInput {...controlA11y('vch-nt-price', newTypeErrors.standardPrice)} error={newTypeErrors.standardPrice} value={newType.standardPrice} onChange={(v) => { setNewType((p) => ({ ...p, standardPrice: v })); setNewTypeErrors((x) => ({ ...x, standardPrice: undefined })); }} />
                </Field>
                <Field label="Category">
                  <SelectField value={newType.category} onChange={(v) => setNewType((p) => ({ ...p, category: v }))} options={VOUCHER_TYPE_CATEGORIES} />
                </Field>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={handleCreateNewType} disabled={newTypeSubmitting} className="h-9 px-3 text-[13px] font-body font-body-medium bg-text-primary text-white rounded-spa hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2">
                  {newTypeSubmitting && <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />}
                  Add type
                </button>
              </div>
            </div>
          )}

          <Field label="Code" required id="vch-code" error={errors.code} hint="Type the code from the physical booklet. It must match exactly.">
            <input
              {...controlA11y('vch-code', errors.code)}
              ref={codeRef}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              value={voucherCode}
              onChange={(e) => { setVoucherCode(e.target.value.toUpperCase()); clearError('code'); }}
              onBlur={() => setVoucherCode((c) => c.trim())}
              placeholder="NT 4326-0001"
              className={`${CONTROL} font-data tracking-wide ${errors.code ? CONTROL_ERROR : ''}`}
            />
          </Field>

          <Field
            label="Guest name"
            labelExtra={linkedCustomer && tierName ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-body text-text-secondary whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />{tierName} member{tierStatus && tierStatus !== 'active' ? ` · ${tierStatus}` : ''}</span>
            ) : null}
            required
            id="vch-guest"
            error={errors.guest}
          >
            <CustomerAutocomplete
              id="vch-guest"
              value={guestName}
              onChange={onGuestNameChange}
              onSelect={onGuestSelect}
              branchId={branchId}
              searchBy="name"
              placeholder="Full name"
              inputClassName={guestInputClass}
            />
          </Field>

          <Field label="Phone" id="vch-phone" error={errors.phone}>
            <div className="flex">
              <CountryCodeSelect value={guestCountryCode} onChange={setGuestCountryCode} />
              <input
                {...controlA11y('vch-phone', errors.phone)}
                type="tel"
                inputMode="numeric"
                value={guestPhone}
                onChange={(e) => { setGuestPhone(e.target.value.replace(/\D/g, '').slice(0, 15)); phoneFromPick.current = false; clearError('phone'); }}
                placeholder="9841234567"
                className={`flex-1 min-w-0 h-10 px-3 text-[13px] border rounded-r-spa rounded-l-none bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ${errors.phone ? 'border-error' : 'border-border'}`}
              />
            </div>
          </Field>

          <Field
            label="Company or club"
            id="vch-company"
            hint={digitsOf(guestPhone) && guestOtherInfo.trim() ? 'Only the phone is saved when both are given.' : undefined}
          >
            <TextInput id="vch-company" value={guestOtherInfo} onChange={(e) => setGuestOtherInfo(e.target.value)} placeholder="Optional" />
          </Field>

          <div className={SPLIT}>
            <Field label="Price" id="vch-price" error={errors.price}>
              <MoneyInput {...controlA11y('vch-price', errors.price)} value={actualPrice} onChange={(v) => { setActualPrice(v); clearError('price'); }} />
            </Field>
            <Field label="Discount" id="vch-discount" error={discountOutOfRange ? 'Discount must be between 0 and 100%.' : undefined}>
              <div className="relative">
                <input
                  {...controlA11y('vch-discount', discountOutOfRange)}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={discountPercent}
                  onChange={(e) => onDiscountChange(e.target.value)}
                  onBlur={() => setDiscountOutOfRange(false)}
                  className={`${CONTROL} pr-8 font-data tabular-nums ${discountOutOfRange ? CONTROL_ERROR : ''}`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-text-tertiary pointer-events-none">%</span>
              </div>
              {typeof tierRate === 'number' && !discountOutOfRange && (
                discountTouched && Number(discountPercent) !== tierRate ? (
                  <button type="button" onClick={() => { setDiscountTouched(false); setDiscountPercent(String(tierRate)); }} className="mt-1.5 text-xs font-body-medium text-primary hover:underline">Reset to {tierName} rate</button>
                ) : (
                  <p className="mt-1.5 text-xs text-text-secondary">{tierName} rate {tierRate}%</p>
                )
              )}
            </Field>
          </div>

          <div className={SPLIT}>
            <DateField label="Issued" id="vch-issued" value={issuedDate} max={today} error={errors.issued} onChange={(d) => { setIssuedDate(d); clearError('issued'); }} />
            <DateField label="Expires" id="vch-expiry" value={expiryDate} min={issuedDate} error={errors.expiry} onChange={(d) => { setExpiryDate(d); clearError('expiry'); }} />
          </div>
          <div className="-mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {EXPIRY_CHIPS.map((c) => (
              <button key={c.label} type="button" onClick={() => { setExpiryDate(c.next(issuedDate)); clearError('expiry'); }} className="text-xs font-body-medium text-primary hover:underline tabular-nums">{c.label}</button>
            ))}
          </div>

          <InfoRows rows={[
            ['Price', formatNPR(actualPriceNum)],
            discountNum > 0 && [`Discount ${discountNum}%`, `−${formatNPR(discountAmount)}`],
            ['Total', formatNPR(totalAmount), 'total'],
          ]} />

          <div className="space-y-2">
            <p className="font-body font-body-medium text-[13px] text-text-primary">Payment</p>
            {tenders.map((t, i) => {
              const isMembership = t.paymentMode === 'Membership';
              const overWallet = isMembership && Number(t.amount) > (membership?.balance || 0);
              return (
                <div key={i}>
                  <div className="flex items-start gap-2">
                    <div className="w-36 flex-shrink-0">
                      <PaymentMethodSelector paymentMethods={paymentMethods} value={t.paymentMode} onChange={(v) => updateTender(i, { paymentMode: v })} extraLeaf={membershipLeaf} size="md" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <MoneyInput id={`vch-pay-${i}`} aria-label={`Amount ${i + 1}`} value={t.amount} onChange={(v) => updateTender(i, { amount: v })} />
                    </div>
                    {tenders.length > 1 && (
                      <button type="button" onClick={() => removeTenderRow(setTenders, i)} aria-label="Remove method" className="h-10 w-8 flex items-center justify-center rounded-spa text-text-secondary hover:bg-black/[0.05]">
                        <Icon name="X" size={14} />
                      </button>
                    )}
                  </div>
                  {isMembership && (
                    <p className={`mt-1 text-xs ${overWallet ? 'text-error' : 'text-text-secondary'}`}>
                      {overWallet ? `Exceeds wallet balance (${formatNPR(membership?.balance || 0)}).` : `Wallet available: ${formatNPR(walletRemaining)}`}
                    </p>
                  )}
                </div>
              );
            })}
            {errors.pay && <p id="vch-pay-error" role="alert" className="text-xs text-error">{errors.pay}</p>}
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => addTenderRow(setTenders, { amount: '', paymentMode: 'Cash' })} className="text-[13px] font-body-medium text-primary hover:underline">+ Add method</button>
              {tenderRemaining === 0 ? (
                <p className="flex items-center gap-1.5 text-[13px] text-success" aria-live="polite"><Icon name="Check" size={13} />Fully collected</p>
              ) : (
                <p className="text-[13px] text-warning tabular-nums" aria-live="polite">
                  {tenderRemaining > 0 ? `${formatNPR(tenderRemaining)} left to collect · ` : `${formatNPR(-tenderRemaining)} over · `}
                  <button
                    type="button"
                    onClick={() => {
                      const last = tenders.length - 1;
                      const cur = round2(Number(tenders[last].amount) || 0);
                      updateTender(last, { amount: String(Math.max(0, round2(cur + tenderRemaining))) });
                    }}
                    className="font-body-medium text-primary hover:underline"
                  >Fill</button>
                </p>
              )}
            </div>
          </div>

          {membership && <MembershipWalletCard membership={membership} pendingDeduction={membershipCommitted} hairline />}

          {showRemarks ? (
            <Field label="Remarks">
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                placeholder="Anything to remember for this voucher…"
                className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
              />
            </Field>
          ) : (
            <button type="button" onClick={() => setShowRemarks(true)} className="block text-[13px] font-body-medium text-primary hover:underline">+ Add remarks</button>
          )}
        </FormBody>
      )}
    </PanelShell>
  );
};

export default NewVoucherPanel;
