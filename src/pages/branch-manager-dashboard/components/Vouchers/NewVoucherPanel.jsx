import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CountryCodeSelect, { parsePhone } from '../../../../components/ui/CountryCodeSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import MembershipWalletCard from '../../../../components/ui/MembershipWalletCard';
import {
  PanelShell, FormBody, Field, SelectField, TextInput, MoneyInput, DateField, InlineError, CONTROL, CONTROL_ERROR, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { useBranch } from '../../../../contexts/BranchContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { fetchVoucherTypes, issueVoucher, fetchMembershipForCustomer } from '../../../../services/api';
import { FREE_REASONS, VALID_CHIPS, freeReasonLabel, longDate } from '../../../../services/vouchersView';
import { categoryLabel } from '../../../../services/membershipsView';
import { addTenderRow, removeTenderRow, updateTenderRow } from '../../../../utils/tenderRows';
import { MEMBERSHIP_ENABLED } from '../../../../lib/featureFlags';
import { nepalNow } from '../../../../utils/customerDirectory';
import { friendlyError } from '../../../../utils/friendlyError';
import { KindTag } from './voucherBits';
import { wordBranch } from '../../../../utils/industryTerms';

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const SPLIT = 'grid grid-cols-1 sm:grid-cols-2 gap-3';
const DEFAULT_CHIP = '90';
const MAX_SOLD_DISCOUNT = 99; // a sale must collect something (migration-344); 100% off is "Given free"
const chipCls = (on) => `h-8 px-3 rounded-full border text-[13px] font-medium tabular-nums ${on ? 'border-primary bg-[#EEF3EC] text-primary shadow-[0_0_0_2px_rgba(45,90,39,.10)]' : 'border-border bg-white text-text-primary hover:bg-[#FAFAF9]'}`;
const isCouponType = (t) => t?.percent_off != null;

const PhoneInput = ({ id, label, dial, setDial, value, onChange, error }) => (
  <div className="flex">
    <CountryCodeSelect value={dial} onChange={setDial} />
    <input {...controlA11y(id, error)} type="tel" inputMode="numeric" aria-label={label} value={value} placeholder="9841234567"
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 15))}
      className={`flex-1 min-w-0 h-10 px-3 text-[13px] border rounded-r-spa rounded-l-none bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ${error ? 'border-error' : 'border-border'}`} />
  </div>
);

// "New voucher" (V23): the right-hand panel (same shell, footer and success receipt as before). Sold | Given free (manager/admin;
// the type's "usually" preselects it until the user picks), type + booklet code, For (a profile link via the suggestions, phone
// or a note), "It's a gift" → Bought by, worth (editable by manager/admin), then either the discount (the member rate follows
// whoever pays) + tenders, or a reason for giving it free. Issued date (manager/admin; today for staff) and Valid until (90 days from it by default). Callbacks are unchanged:
// onClose(), onIssued(issuedVoucher); `initialTypeId` / `initialKind` come from the Voucher types tab's Sell / Give.
const NewVoucherPanel = ({ userRole, onClose, onIssued, initialTypeId = null, initialKind = null }) => {
  const { branchId, branchName, isOverall } = useBranch();
  const { profile } = useAuth();
  const { paymentMethods } = useOrg();
  const canGiveFree = userRole === 'manager' || userRole === 'admin';
  const canEditWorth = canGiveFree;
  const today = nepalNow().today;
  const canBackdate = canGiveFree; // back-dating by staff is an open owner item (V-4): staff always issue today
  const chipDate = (id, from = today) => VALID_CHIPS.find((c) => c.id === id).next(from);

  const [types, setTypes] = useState(null); // null while loading
  const [loadError, setLoadError] = useState(null);
  const [typeId, setTypeId] = useState('');
  const [kind, setKind] = useState(canGiveFree && initialKind === 'free' ? 'free' : 'sold');
  const kindTouched = useRef(!!initialKind);
  const [code, setCode] = useState('');
  // For
  const [guestName, setGuestName] = useState('');
  const [linked, setLinked] = useState(null);
  const [dial, setDial] = useState('+977');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const phoneFromPick = useRef(false);
  // Bought by
  const [gift, setGift] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerLinked, setBuyerLinked] = useState(null);
  const [buyerDial, setBuyerDial] = useState('+977');
  const [buyerPhone, setBuyerPhone] = useState('');
  // Money
  const [worth, setWorth] = useState('');
  const [discount, setDiscount] = useState('0');
  const [discountTouched, setDiscountTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [freeNote, setFreeNote] = useState('');
  const [issuedDate, setIssuedDate] = useState(today);
  const [chip, setChip] = useState(DEFAULT_CHIP);
  const [expiry, setExpiry] = useState(() => chipDate(DEFAULT_CHIP));
  const [tenders, setTenders] = useState([{ amount: '', paymentMode: 'Cash' }]);
  const [memberships, setMemberships] = useState({}); // customerId → membership (or null)

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [issued, setIssued] = useState(null); // the issued voucher (shown as the success state)
  const [copied, setCopied] = useState(false);
  const codeRef = useRef(null);

  // ── Data ───────────────────────────────────────────────────────────────────────────────────────
  // Staff only sell, so a % coupon type with no price (always given free) isn't offered to them.
  const sellable = (t) => canGiveFree || !(isCouponType(t) && !(Number(t.standard_price) > 0));
  const pickType = (t, { fromUser = false } = {}) => {
    setTypeId(t?.id || '');
    setWorth(t ? String(Number(t.standard_price)) : '');
    if (t && canGiveFree && !kindTouched.current) setKind(t.default_issue_kind === 'free' ? 'free' : 'sold');
    if (fromUser) setErrors((e) => ({ ...e, type: undefined }));
  };
  useEffect(() => {
    let off = false;
    fetchVoucherTypes().then(({ data, error }) => {
      if (off) return;
      if (error) { setLoadError(friendlyError(error, 'Failed to load voucher types.')); setTypes([]); return; }
      const list = (data || []).filter(sellable);
      setTypes(list);
      pickType(list.find((t) => t.id === initialTypeId) || list[0]);
    });
    return () => { off = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the first field once the panel has slid in (never scroll an ancestor while it is still moving).
  useEffect(() => {
    if (issued) return undefined;
    const t = setTimeout(() => codeRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, [issued, isOverall]);

  // ── Derived ────────────────────────────────────────────────────────────────────────────────────
  const type = (types || []).find((t) => t.id === typeId) || null;
  const coupon = isCouponType(type);
  const free = kind === 'free';
  // The member discount follows whoever pays: the Bought by profile for a gift, otherwise the For profile.
  const payer = gift && buyerName.trim() ? buyerLinked : linked;
  const payerName = gift && buyerName.trim() ? buyerName : guestName;
  const payerMembership = payer ? memberships[payer.id] || null : null;
  const activeMembership = payerMembership?.status === 'active' ? payerMembership : null;
  const forMembership = linked ? memberships[linked.id] : null;
  const tierRate = !free && type && activeMembership ? Number(activeMembership.tierDiscountRules?.[type.category]) || 0 : 0;

  useEffect(() => {
    if (payer && !(payer.id in memberships)) {
      fetchMembershipForCustomer(payer.id).then(({ data }) => setMemberships((m) => ({ ...m, [payer.id]: data || null })));
    }
  }, [payer?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The member rate fills the discount until the user types one.
  useEffect(() => { if (!discountTouched) setDiscount(String(tierRate || 0)); }, [tierRate, discountTouched]);

  const worthNum = coupon ? 0 : Number(worth) || 0;
  const priceNum = coupon ? Number(type?.standard_price) || 0 : worthNum; // what the sale is priced at
  const discountNum = free ? 0 : Math.min(100, Math.max(0, Number(discount) || 0));
  const pays = free ? 0 : round2(priceNum - (priceNum * discountNum) / 100);
  const discountAmount = round2(priceNum - pays);

  const membershipUsable = !!(MEMBERSHIP_ENABLED && !free && payer && payerMembership && payerMembership.balance > 0 && payerMembership.status !== 'depleted');
  const membershipLeaf = membershipUsable ? { value: 'Membership', label: 'Membership' } : null;
  const membershipCommitted = useMemo(() => (membershipUsable
    ? round2(tenders.reduce((s, t) => s + (t.paymentMode === 'Membership' && Number(t.amount) > 0 ? Number(t.amount) : 0), 0)) : 0), [tenders, membershipUsable]);
  const walletRemaining = membershipUsable ? Math.max(0, round2(payerMembership.balance - membershipCommitted)) : 0;
  const membershipOverWallet = membershipUsable && membershipCommitted > payerMembership.balance;
  const autoTender = useRef(false); // the tender was filled from the wallet automatically (see below)
  // A wallet that no longer belongs to the payer falls back to Cash.
  useEffect(() => {
    if (membershipUsable) return;
    autoTender.current = false;
    setTenders((prev) => (prev.some((t) => t.paymentMode === 'Membership') ? prev.map((t) => (t.paymentMode === 'Membership' ? { ...t, paymentMode: 'Cash' } : t)) : prev));
  }, [membershipUsable]);
  // Default the tender to Membership once the payer's wallet can cover it (only while the tender is untouched). A tender filled
  // this way keeps following what is due (the member rate lands a moment after the wallet) until the user edits a tender.
  useEffect(() => {
    if (!membershipUsable || payerMembership.balance < pays || pays <= 0) return;
    const pristine = tenders.length === 1 && tenders[0].paymentMode === 'Cash' && !(Number(tenders[0].amount) > 0);
    if (pristine || autoTender.current) { autoTender.current = true; setTenders([{ amount: String(pays), paymentMode: 'Membership' }]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipUsable, payerMembership?.balance, pays]);

  const tenderTotal = useMemo(() => tenders.reduce((s, t) => { const a = round2(Number(t.amount) || 0); return s + (a > 0 ? a : 0); }, 0), [tenders]);
  const tenderRemaining = round2(pays - tenderTotal);

  const dirty = !!(code || guestName || phone || note || buyerName || buyerPhone || reason || freeNote || tenderTotal > 0 || discountTouched
    || chip !== DEFAULT_CHIP || issuedDate !== today || (type && worth !== String(Number(type.standard_price))));

  const why = types === null ? 'Loading voucher types…'
    : !typeId ? 'Pick a voucher type'
      : !code.trim() ? 'Enter the code'
        : !guestName.trim() ? 'Enter who it is for'
          : gift && !buyerName.trim() ? 'Enter who bought it'
            : free && !reason ? 'Pick why it is free'
              : !free && !coupon && !(worthNum > 0) ? 'Enter what it is worth'
                : !free && discountNum >= 100 ? (canGiveFree ? 'Use Given free for a free voucher' : 'A manager can give it free')
                  : !free && pays <= 0 ? (canGiveFree ? 'Nothing to collect: use Given free' : 'Nothing to collect: a manager can give it free')
                    : membershipOverWallet ? 'Wallet balance too low'
                      : !free && tenderRemaining > 0 ? `Collect ${formatNPR(tenderRemaining)} more`
                        : !free && tenderRemaining < 0 ? `${formatNPR(-tenderRemaining)} over the total`
                          : '';

  // ── Handlers ───────────────────────────────────────────────────────────────────────────────────
  const clearError = (key) => { setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e)); setServerError(null); };
  const onGuestNameChange = (val) => {
    setGuestName(val);
    clearError('guest');
    if (linked) {
      setLinked(null);
      if (phoneFromPick.current) setPhone('');
      phoneFromPick.current = false;
      if (!gift) setDiscountTouched(false);
    }
  };
  const onGuestSelect = (c) => {
    setGuestName(c.full_name);
    setLinked({ id: c.id, name: c.full_name, tierName: c.primaryMembership?.tierName || '' });
    clearError('guest');
    if (c.phone) { const p = parsePhone(c.phone); setDial(p.dial); setPhone(p.national); phoneFromPick.current = true; }
    if (!gift) setDiscountTouched(false); // a fresh payer: their rate applies again
  };
  const onBuyerSelect = (c) => {
    setBuyerName(c.full_name);
    setBuyerLinked({ id: c.id, name: c.full_name });
    if (c.phone) { const p = parsePhone(c.phone); setBuyerDial(p.dial); setBuyerPhone(p.national); }
    setDiscountTouched(false);
  };
  const onDiscountChange = (raw) => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    setDiscount(Number(cleaned) > 100 ? '100' : cleaned);
    setDiscountTouched(true);
  };
  const setKindByUser = (k) => { kindTouched.current = true; setKind(k); setServerError(null); };

  const submit = async () => {
    if (submittingRef.current || why || isOverall) return;
    const next = {};
    const pd = digitsOf(phone);
    const bd = digitsOf(buyerPhone);
    if (pd && (pd.length < 7 || pd.length > 15)) next.phone = 'Enter a valid phone number (7–15 digits).';
    if (gift && bd && (bd.length < 7 || bd.length > 15)) next.buyerPhone = 'Enter a valid phone number (7–15 digits).';
    if (canBackdate && (!issuedDate || issuedDate > today)) next.issued = "The issued date can't be in the future.";
    if (!expiry || expiry < today) next.expiry = 'Pick today or a later date.';
    if (!free && tenders.some((t) => t.paymentMode === 'Membership' && Number(t.amount) > 0) && !payer) next.pay = 'Pick the payer from the suggestions to pay by Membership.';
    setErrors(next);
    const first = ['phone', 'buyerPhone', 'issued', 'expiry', 'pay'].find((k) => next[k]);
    if (first) { const el = document.getElementById(`vch-${first}`); el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

    submittingRef.current = true;
    setSubmitting(true);
    setServerError(null);
    // Guest Info is one column: a phone number takes priority (it makes the voucher searchable by phone at payment time,
    // migration-085); the company / note is used when there's no phone.
    const { data, error } = await issueVoucher({
      branchId,
      voucherTypeId: typeId,
      voucherCode: code.trim(),
      guestName: guestName.trim(),
      guestInfo: pd ? `${dial}${pd}` : (note.trim() || null),
      customerId: linked?.id || null,
      discountPercent: discountNum,
      actualPrice: coupon ? priceNum : worthNum,
      issuedDate: canBackdate ? issuedDate : null,
      expiryDate: expiry,
      issueKind: kind,
      freeReason: free ? reason : null,
      freeNote: free ? (freeNote.trim() || null) : null,
      buyerName: gift ? buyerName.trim() : null,
      buyerPhone: gift && bd ? `${buyerDial}${bd}` : null,
      buyerCustomerId: gift ? (buyerLinked?.id || null) : null,
      tenders: free ? [] : tenders.map((t) => ({ amount: round2(Number(t.amount) || 0), paymentMode: t.paymentMode })).filter((t) => t.amount > 0),
    });
    submittingRef.current = false;
    setSubmitting(false);
    if (error) {
      if (/already in use/i.test(error.message || '')) {
        setErrors({ code: `${code.trim()} is already in use.` });
        const el = document.getElementById('vch-code');
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      setServerError(friendlyError(error, free ? 'Failed to give the voucher.' : 'Failed to sell the voucher.'));
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

  // "Issue another": reset everything except the voucher type and Sold / Given free.
  const issueAnother = () => {
    setIssued(null);
    setCode(''); setGuestName(''); setLinked(null); setPhone(''); setNote(''); setDial('+977');
    setGift(false); setBuyerName(''); setBuyerLinked(null); setBuyerPhone(''); setBuyerDial('+977');
    setWorth(type ? String(Number(type.standard_price)) : ''); setDiscount('0'); setDiscountTouched(false);
    setReason(''); setFreeNote(''); setIssuedDate(today); setChip(DEFAULT_CHIP); setExpiry(chipDate(DEFAULT_CHIP));
    setTenders([{ amount: '', paymentMode: 'Cash' }]); setErrors({}); setServerError(null);
    phoneFromPick.current = false;
    autoTender.current = false;
  };

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────
  const typeOptions = (types || []).map((t) => {
    const tag = isCouponType(t) ? 'coupon' : t.default_issue_kind === 'free' ? 'usuallyFree' : null;
    return {
      value: t.id,
      searchLabel: t.name,
      label: <span className="inline-flex items-center gap-2 max-w-full"><span className="truncate">{t.name}</span>{tag && <KindTag kind={tag} />}</span>,
    };
  });
  const updateTender = (i, patch) => { autoTender.current = false; updateTenderRow(setTenders, i, patch); clearError('pay'); };
  const title = free ? 'Give a voucher' : 'New voucher';

  if (issued) {
    const wasFree = issued.issue_kind === 'free';
    const worthText = issued.percent_off != null ? `${Number(issued.percent_off)}% off one visit` : `Worth ${formatNPR(issued.total_amount_issued)}`;
    return (
      <PanelShell variant="panel" title={title} onClose={() => onIssued(issued)}
        footerOverride={(
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={issueAnother} className="h-9 px-3 text-[13px] font-body font-body-medium text-text-secondary hover:text-text-primary hover:bg-black/[0.04] rounded-spa spa-transition-fast whitespace-nowrap">{wasFree ? 'Give another' : 'Sell another'}</button>
            <button type="button" onClick={() => onIssued(issued)} className="h-9 px-4 text-[13px] font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast whitespace-nowrap">Done</button>
          </div>
        )}>
        <div className="px-5 py-10 text-center" role="status" aria-live="polite">
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={24} className="text-success" /></div>
          <h4 className="font-heading font-heading-semibold text-[15px] text-text-primary">{wasFree ? 'Voucher given' : 'Voucher sold'}</h4>
          <p className="mt-3 font-data font-data-medium text-2xl text-primary tracking-wide break-all">{issued.voucher_code}</p>
          <button type="button" onClick={copyCode} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-body-medium text-primary hover:underline">
            <Icon name={copied ? 'Check' : 'Copy'} size={13} />{copied ? 'Copied' : 'Copy'}
          </button>
          <p className="mt-4 text-[13px] text-text-secondary tabular-nums">
            {worthText}{wasFree ? ' · given free' : ` · paid ${formatNPR(issued.amount_paid)}`} · {issued.guest_name} · valid until {longDate(issued.expiry_date)}
          </p>
        </div>
      </PanelShell>
    );
  }

  const primaryLabel = submitting ? (free ? 'Giving…' : 'Selling…')
    : free ? (coupon ? `Give coupon · ${Number(type?.percent_off)}% off` : `Give voucher · worth ${formatNPR(worthNum)}`)
      : pays > 0 ? `Sell · collect ${formatNPR(pays)}` : 'Sell';
  const memberLine = (() => {
    if (free || !type) return null;
    if (activeMembership && tierRate > 0) {
      return `${firstName(payerName)} is a ${activeMembership.tierName} member: ${tierRate}% off ${categoryLabel(type.category).toLowerCase()} is applied. The discount follows whoever pays.`;
    }
    if (gift && forMembership?.status === 'active' && payer?.id !== linked?.id) {
      return `${firstName(buyerName) || 'The buyer'} is paying, so ${firstName(guestName)}'s ${forMembership.tierName} rate doesn't apply. The discount follows whoever pays.`;
    }
    return null;
  })();

  return (
    <PanelShell variant="panel" width="460px" title={title} onClose={onClose} dirty={dirty} busy={submitting} reason={why}
      primary={isOverall ? undefined : { label: primaryLabel, onClick: submit, disabled: !!why || types === null, loading: submitting }}>
      {isOverall ? (
        <FormBody>
          <div className="py-10 text-center">
            <Icon name="Ticket" size={28} className="text-text-tertiary mx-auto mb-3" />
            <p className="text-[13px] text-text-secondary">Vouchers are handed out from one {wordBranch()}. Switch {wordBranch()} in the header to continue.</p>
          </div>
        </FormBody>
      ) : (
        <FormBody>
          <p className="-mt-1 text-xs text-text-secondary">{branchName}{profile?.full_name ? ` · by ${profile.full_name}` : ''}</p>
          <InlineError message={serverError || loadError} />

          {canGiveFree && (
            <div className="grid grid-cols-2 gap-0.5 p-0.5 bg-background border border-border rounded-lg" role="group" aria-label="Sold or given free">
              {[['sold', 'Banknote', 'Sold'], ['free', 'Gift', 'Given free']].map(([k, icon, label]) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKindByUser(k)} data-kind={k}
                  className={`h-9 rounded-md text-[13px] font-medium inline-flex items-center justify-center gap-2 transition-colors ${kind === k ? 'bg-white text-text-primary shadow-[0_1px_2px_rgba(14,13,12,.08)] border border-border' : 'text-[#515152] hover:text-text-primary'}`}>
                  <Icon name={icon} size={15} />{label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr] gap-3">
            <Field label="Voucher type" required id="vch-type" error={errors.type}>
              <SelectField value={typeId} onChange={(id) => pickType((types || []).find((t) => t.id === id), { fromUser: true })} options={typeOptions}
                placeholder={types === null ? 'Loading…' : 'Select voucher type'} disabled={types === null || (types || []).length === 0} />
            </Field>
            <Field label="Code" required id="vch-code" error={errors.code} labelExtra={<span className="text-xs text-text-secondary">from the booklet</span>}>
              <input {...controlA11y('vch-code', errors.code)} ref={codeRef} type="text" autoComplete="off" autoCapitalize="characters" value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); clearError('code'); }} onBlur={() => setCode((c) => c.trim())}
                placeholder={type ? `${type.code_prefix}-0001` : 'NT 4326-0001'} className={`${CONTROL} font-data tracking-wide ${errors.code ? CONTROL_ERROR : ''}`} />
            </Field>
          </div>
          {types !== null && types.length === 0 && <p className="-mt-2 text-xs text-text-secondary">No voucher types on sale. An admin can add one in Voucher types.</p>}

          <Field label="For" required id="vch-guest" error={errors.guest}
            labelExtra={linked?.tierName ? <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-[#E7B93E]" />{linked.tierName}</span> : null}>
            <CustomerAutocomplete id="vch-guest" value={guestName} onChange={onGuestNameChange} onSelect={onGuestSelect} branchId={branchId} searchBy="name" placeholder="Full name" inputClassName={CONTROL} />
            <div className={`${SPLIT} mt-2`}>
              <PhoneInput id="vch-phone" label="Phone" dial={dial} setDial={setDial} value={phone} onChange={(val) => { setPhone(val); phoneFromPick.current = false; clearError('phone'); }} error={errors.phone} />
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Company or note (optional)" aria-label="Company or note" />
            </div>
            {errors.phone && <p className="mt-1 text-xs text-error">{errors.phone}</p>}
            {digitsOf(phone) && note.trim() && <p className="mt-1 text-xs text-text-secondary">Only the phone is saved when both are given.</p>}
          </Field>

          {!free && (
            <div className="space-y-3">
              <button type="button" role="switch" aria-checked={gift} onClick={() => { setGift((g) => !g); setDiscountTouched(false); }} className="flex items-start gap-3 text-left w-full" data-gift-toggle>
                <span className={`relative inline-flex w-[34px] h-5 rounded-full transition-colors flex-shrink-0 mt-0.5 ${gift ? 'bg-primary' : 'bg-[#D6D3D1]'}`}>
                  <span className={`absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-all ${gift ? 'left-4' : 'left-[2px]'}`} />
                </span>
                <span>
                  <span className="block text-[13px] font-medium text-text-primary">It&apos;s a gift</span>
                  <span className="block text-xs text-text-secondary">Someone else is paying? Add them, so we can remind them too</span>
                </span>
              </button>
              {gift && (
                <Field label="Bought by" required id="vch-buyer">
                  <CustomerAutocomplete id="vch-buyer" value={buyerName} branchId={branchId} searchBy="name" placeholder="Who is paying" inputClassName={CONTROL}
                    onChange={(val) => { setBuyerName(val); if (buyerLinked) { setBuyerLinked(null); setDiscountTouched(false); } }} onSelect={onBuyerSelect} />
                  <div className="mt-2"><PhoneInput id="vch-buyerPhone" label="Buyer phone" dial={buyerDial} setDial={setBuyerDial} value={buyerPhone} onChange={setBuyerPhone} error={errors.buyerPhone} /></div>
                  {errors.buyerPhone && <p className="mt-1 text-xs text-error">{errors.buyerPhone}</p>}
                </Field>
              )}
              {memberLine && (
                <p className="flex items-start gap-2 text-[12.5px] text-[#515152]" data-member-line>
                  <Icon name="CreditCard" size={14} className="text-[#9A6B0B] mt-0.5 flex-shrink-0" /><span>{memberLine}</span>
                </p>
              )}
            </div>
          )}

          {free && (
            <Field label="Why is it free?" required id="vch-reason">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Why is it free">
                {FREE_REASONS.map((r) => (
                  <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} onClick={() => setReason(r.id)} className={chipCls(reason === r.id)} data-reason={r.id}>{r.label}</button>
                ))}
              </div>
              <TextInput className="mt-2" value={freeNote} onChange={(e) => setFreeNote(e.target.value)} placeholder="Note (optional), e.g. Dashain walk-in promo" aria-label="Note" />
            </Field>
          )}

          {coupon ? (
            <div className="rounded-spa border border-[#C7D2FE] bg-[#EEF2FF]/60 px-3 py-2.5 text-[13px] flex items-center justify-between gap-3" data-coupon-line>
              <span className="text-[#3730A3] font-medium">{Number(type.percent_off)}% off one visit</span>
              <span className="text-xs text-text-secondary">{free ? 'Guest pays nothing' : `Guest pays ${formatNPR(pays)}`}</span>
            </div>
          ) : (
            <div className={SPLIT}>
              <Field label="Worth" required id="vch-worth" hint={canEditWorth ? undefined : 'Set by the voucher type'}>
                {canEditWorth
                  ? <MoneyInput id="vch-worth" value={worth} onChange={(val) => setWorth(val)} />
                  : <p className="h-10 px-3 flex items-center rounded-spa border border-border bg-background text-[13px] tabular-nums">{formatNPR(worthNum)}</p>}
              </Field>
              {free ? (
                <Field label="Guest pays">
                  <p className="h-10 px-3 flex items-center rounded-spa border border-border bg-background text-[13px] text-text-secondary">Nothing · free</p>
                </Field>
              ) : (
                <Field label="Discount" id="vch-discount" labelExtra={tierRate > 0 && !discountTouched ? <span className="text-xs text-text-secondary">member rate</span> : null}
                  error={discountNum >= 100 ? (canGiveFree ? 'Use Given free for a free voucher.' : 'Up to 99%. A manager can give it free.') : undefined}>
                  <div className="relative">
                    <input {...controlA11y('vch-discount', discountNum >= 100)} type="text" inputMode="decimal" autoComplete="off" value={discount} onChange={(e) => onDiscountChange(e.target.value)}
                      className={`${CONTROL} pr-24 font-data tabular-nums ${discountNum >= 100 ? CONTROL_ERROR : ''}`} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-text-tertiary pointer-events-none tabular-nums">% {discountAmount > 0 ? `· − ${formatNPR(discountAmount)}` : ''}</span>
                  </div>
                  {tierRate > 0 && discountTouched && discountNum !== tierRate && (
                    <button type="button" onClick={() => setDiscountTouched(false)} className="mt-1.5 text-xs font-body-medium text-primary hover:underline">Reset to member rate ({tierRate}%)</button>
                  )}
                </Field>
              )}
            </div>
          )}
          {!free && discountNum >= 100 && canGiveFree && (
            <button type="button" onClick={() => { setKindByUser('free'); setDiscount('0'); setDiscountTouched(false); }} className="-mt-2 text-[13px] font-medium text-primary hover:underline">Switch to Given free</button>
          )}

          {canBackdate && (
            <DateField label="Issued date" id="vch-issued" value={issuedDate} max={today} error={errors.issued} hint={issuedDate && issuedDate < today ? 'Back-dated: the validity chips count from this date.' : undefined}
              onChange={(d) => { setIssuedDate(d); clearError('issued'); if (chip && d && d <= today) { setExpiry(chipDate(chip, d)); clearError('expiry'); } }} />
          )}
          <div>
            <DateField label="Valid until" id="vch-expiry" value={expiry} min={today} error={errors.expiry} onChange={(d) => { setExpiry(d); setChip(''); clearError('expiry'); }} />
            <div className="flex flex-wrap gap-2 mt-2" role="group" aria-label="Valid for">
              {VALID_CHIPS.map((c) => (
                <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => { setChip(c.id); setExpiry(chipDate(c.id, canBackdate && issuedDate && issuedDate <= today ? issuedDate : today)); clearError('expiry'); }} className={chipCls(chip === c.id)} data-valid-chip={c.id}>{c.label}</button>
              ))}
            </div>
          </div>

          {!free && pays > 0 && (
            <div className="space-y-2">
              <p className="font-body font-body-medium text-[13px] text-text-primary">Payment</p>
              {tenders.map((t, i) => {
                const isMembership = t.paymentMode === 'Membership';
                const overWallet = isMembership && Number(t.amount) > (payerMembership?.balance || 0);
                return (
                  <div key={i}>
                    <div className="flex items-start gap-2">
                      <div className="w-36 flex-shrink-0">
                        <PaymentMethodSelector paymentMethods={paymentMethods} value={t.paymentMode} onChange={(val) => updateTender(i, { paymentMode: val })} extraLeaf={membershipLeaf} size="md" />
                      </div>
                      <div className="flex-1 min-w-0"><MoneyInput id={`vch-pay-${i}`} aria-label={`Amount ${i + 1}`} value={t.amount} onChange={(val) => updateTender(i, { amount: val })} /></div>
                      {tenders.length > 1 && (
                        <button type="button" onClick={() => { autoTender.current = false; removeTenderRow(setTenders, i); }} aria-label="Remove method" className="h-10 w-8 flex items-center justify-center rounded-spa text-text-secondary hover:bg-black/[0.05]"><Icon name="X" size={14} /></button>
                      )}
                    </div>
                    {isMembership && (
                      <p className={`mt-1 text-xs ${overWallet ? 'text-error' : 'text-text-secondary'}`}>
                        {overWallet ? `Exceeds ${firstName(payerName)}'s wallet (${formatNPR(payerMembership?.balance || 0)}).` : `${firstName(payerName)}'s wallet: ${formatNPR(walletRemaining)} left`}
                      </p>
                    )}
                  </div>
                );
              })}
              {errors.pay && <p id="vch-pay-error" role="alert" className="text-xs text-error">{errors.pay}</p>}
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => { autoTender.current = false; addTenderRow(setTenders, { amount: '', paymentMode: 'Cash' }); }} className="text-[13px] font-body-medium text-primary hover:underline">+ Add method</button>
                {tenderRemaining === 0 ? (
                  <p className="flex items-center gap-1.5 text-[13px] text-success" aria-live="polite"><Icon name="Check" size={13} />Fully collected</p>
                ) : (
                  <p className="text-[13px] text-warning tabular-nums" aria-live="polite">
                    {tenderRemaining > 0 ? `${formatNPR(tenderRemaining)} left to collect · ` : `${formatNPR(-tenderRemaining)} over · `}
                    <button type="button" onClick={() => { const last = tenders.length - 1; const cur = round2(Number(tenders[last].amount) || 0); updateTender(last, { amount: String(Math.max(0, round2(cur + tenderRemaining))) }); }}
                      className="font-body-medium text-primary hover:underline">Fill</button>
                  </p>
                )}
              </div>
              {payerMembership && <MembershipWalletCard membership={payerMembership} pendingDeduction={membershipCommitted} hairline />}
            </div>
          )}

          <div className="rounded-spa border border-border bg-background px-4 py-3 flex items-center justify-between gap-3 text-[13px] tabular-nums" data-summary>
            <span className="text-[#515152]">{coupon ? <b className="font-semibold text-text-primary">{Number(type.percent_off)}% off one visit</b> : <>Worth <b className="text-[15px] font-semibold text-text-primary">{formatNPR(worthNum)}</b></>}</span>
            <span className="text-[#515152] text-right">{free ? `Given free${reason ? ` · ${freeReasonLabel(reason)}` : ''}` : <>Guest pays <b className="text-[15px] font-semibold text-text-primary">{formatNPR(pays)}</b></>}</span>
          </div>
          {free && <p className="text-xs text-text-secondary">Free vouchers bring in no money, show as &quot;Given free&quot; in reports, and record who gave them. Only managers and admins can give them.</p>}
        </FormBody>
      )}
    </PanelShell>
  );
};

export default NewVoucherPanel;
