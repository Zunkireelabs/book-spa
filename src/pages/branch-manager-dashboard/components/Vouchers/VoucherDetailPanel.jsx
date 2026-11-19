import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import ValueCorrectionView from '../../../../components/ui/ValueCorrectionView';
import {
  PanelShell, FormBody, Field, TextInput, MoneyInput, DateField, InfoRows, InlineError, OverflowMenu, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { useOrg } from '../../../../contexts/OrgContext';
import {
  fetchVoucher, fetchVoucherClaims, fetchVoucherHistory, fetchBranchesByOrgId, fetchServicesByOrgId, claimVoucher, adminCorrectVoucherBalance,
  logVoucherReminder, updateVoucherContact,
} from '../../../../services/api';
import {
  STATUS, statusOf, isCoupon, isExpired, remainingOf, valueOf, validLine, usedBy, freeReasonLabel, reminderText, forPhone, buyerPhoneOf, longDate,
  shortName, npr, nepalDate,
} from '../../../../services/vouchersView';
import { buildWhatsAppUrl } from '../../../../utils/checkoutReceipt';
import { formatPhoneGrouped } from '../../../../utils/phone';
import { nepalNow } from '../../../../utils/customerDirectory';
import { toDateInputValue } from '../../../../utils/date';
import { friendlyError } from '../../../../utils/friendlyError';
import { Avatar, StatusPill, tileDate, MiniButton } from '../Area/listKit';
import { TicketCard, useCopy } from './voucherBits';
import { ExtendView, ContactView, CouponView } from './VoucherActionViews';
import { wordBranch, wordBranchCap } from '../../../../utils/industryTerms';

const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const SECTION = 'text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.05em] mb-2';
const ghostBtn = 'h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 text-text-primary hover:bg-[#FAFAF9]';
const primaryBtn = 'h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(45,90,39,.25),inset_0_1px_0_rgba(255,255,255,.15)] hover:bg-primary/95';
const SUB_VIEWS = ['claim', 'correct', 'extend', 'contact', 'coupon'];
const phoneText = (p) => (p ? (formatPhoneGrouped(p) || p) : '');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const LEGACY_NOTE = 'Used before the app tracked it';

// ── Record a claim (stacked sub-view) ──────────────────────────────────────────────────────────────────────────────────────────
const ClaimView = ({ voucher, branches, services, onBack, onClose, onDone, width }) => {
  const { branchId: currentBranchId, isOverall } = useBranch();
  const remaining = Number(voucher.remainingBalance || 0);
  const [redeemedDate, setRedeemedDate] = useState(() => toDateInputValue(new Date()));
  const [branchId, setBranchId] = useState(!isOverall && currentBranchId ? currentBranchId : '');
  const [guest, setGuest] = useState(voucher.guestName || '');
  const [service, setService] = useState('');
  const [amount, setAmount] = useState(String(remaining));
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const submitRef = useRef(null);

  const amountNum = Number(amount) || 0;
  const reason = !branchId ? `Select the ${wordBranch()}` : !(amountNum > 0) ? 'Enter the amount' : amountNum > remaining ? `Only ${formatNPR(remaining)} remaining` : '';
  const dirty = !!(notes || service || guest !== (voucher.guestName || '') || amount !== String(remaining) || branchId !== (!isOverall && currentBranchId ? currentBranchId : ''));

  const submit = async () => {
    if (busyRef.current) return;
    const e = {};
    if (!branchId) e.branch = `Select the ${wordBranch()} where this is being claimed.`;
    if (!(amountNum > 0)) e.amount = 'Amount claimed must be greater than zero.';
    else if (amountNum > remaining) e.amount = `Amount exceeds the remaining balance of ${formatNPR(remaining)}.`;
    setErrors(e);
    setServerError(null);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`vc-${first}`)?.focus({ preventScroll: true }); return; }
    busyRef.current = true;
    setBusy(true);
    const { error } = await claimVoucher({
      voucherId: voucher.id, amountClaimed: amountNum, redeemedDate, guestNameUsedBy: guest.trim() || null,
      serviceClaimed: service.trim() || null, branchClaimedId: branchId, notes: notes.trim() || null,
    });
    busyRef.current = false;
    setBusy(false);
    if (error) { setServerError(friendlyError(error, 'Failed to claim voucher.')); return; }
    onDone(`Redeemed ${formatNPR(amountNum)}.`);
  };
  submitRef.current = submit;

  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('vc-amount')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  return (
    <PanelShell
      width={width} variant="panel" title="Redeem voucher" onBack={onBack} onClose={onClose} dirty={dirty} busy={busy} reason={reason}
      primary={{ label: busy ? 'Redeeming…' : (amountNum > 0 ? `Redeem · ${formatNPR(amountNum)}` : 'Redeem'), onClick: submit, disabled: !!reason, loading: busy }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Amount" required id="vc-amount" error={errors.amount} hint="Use less than the full value to leave the rest for another visit.">
          <MoneyInput {...controlA11y('vc-amount', errors.amount)} error={!!errors.amount} value={amount} onChange={setAmount} />
        </Field>
        <Field label={`${wordBranchCap()}`} required id="vc-branch" error={errors.branch}>
          <CustomSelect value={branchId} onChange={setBranchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder={`Select ${wordBranch()}`} error={!!errors.branch} />
        </Field>
        <DateField label="Redeemed date" value={redeemedDate} onChange={setRedeemedDate} />
        <Field label="Used by" id="vc-guest" hint="Anyone with the code can use it.">
          <TextInput id="vc-guest" value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Who's using it" />
        </Field>
        <Field label="Service">
          <CustomSelect value={service} onChange={setService} options={services.map((s) => ({ value: s.name, label: s.name }))} placeholder="Select service" searchable />
        </Field>
        {showNotes ? (
          <Field label="Notes" id="vc-notes">
            <TextInput id="vc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember for this visit…" />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowNotes(true)} className="block text-[13px] font-body-medium text-primary hover:underline">+ Add note</button>
        )}
        <InfoRows rows={[['Value left', `${formatNPR(remaining)} → ${formatNPR(remaining - amountNum)}`, amountNum > remaining ? 'error' : 'total']]} />
      </FormBody>
    </PanelShell>
  );
};

// One history line: { key, date (tile), sort, title, sub, amount (value: + in, − out, null = none) }.
const historyOf = (v, claims, history) => {
  const items = [];
  const paidModes = [...new Set((history?.payments || []).map((p) => p.payment_mode).filter(Boolean))].join(' + ');
  items.push({
    key: 'issue', date: v.issuedDate, sort: v.createdAt || v.issuedDate,
    title: v.issueKind === 'free' ? `Given free · ${freeReasonLabel(v.freeReason)}` : `Sold · paid ${npr(v.amountPaid)}`,
    sub: [`to ${v.buyerName ? firstName(v.buyerName) : firstName(v.guestName)}`, v.branchName, v.issuedByName && v.issuedByName !== '—' ? shortName(v.issuedByName) : null, v.issueKind === 'free' ? v.freeNote : paidModes].filter(Boolean).join(' · '),
    amount: isCoupon(v) ? null : valueOf(v),
  });
  (claims || []).forEach((c) => {
    if (c.is_legacy) {
      items.push({ key: `c${c.id}`, date: c.redeemed_date, sort: c.created_at, title: 'Checked · already used', sub: [LEGACY_NOTE, c.performer?.full_name ? `by ${shortName(c.performer.full_name)}` : null].filter(Boolean).join(' · '), amount: -Number(c.amount_claimed) });
      return;
    }
    items.push({
      key: `c${c.id}`, date: c.redeemed_date, sort: c.created_at,
      title: `Redeemed${c.service_claimed ? ` · ${c.service_claimed}` : ''}`,
      sub: [c.guest_name_used_by ? `by ${firstName(c.guest_name_used_by)}` : null, c.booking?.booking_number, c.payment_id || c.booking ? 'at checkout' : 'by hand', c.branch?.name].filter(Boolean).join(' · '),
      amount: -Number(c.amount_claimed),
    });
  });
  const by = (e) => (e.performer?.full_name ? `by ${shortName(e.performer.full_name)}` : null);
  (history?.events || []).forEach((e) => {
    const day = nepalDate(e.created_at);
    const base = { key: `e${e.id}`, date: day, sort: e.created_at, amount: null };
    if (e.kind === 'extended') items.push({ ...base, title: `Extended to ${longDate(e.new_expiry)}`, sub: [`was ${longDate(e.old_expiry)}`, e.note ? `"${e.note}"` : null, by(e)].filter(Boolean).join(' · ') });
    else if (e.kind === 'reminded') items.push({ ...base, title: 'Reminded on WhatsApp', sub: [e.note, by(e)].filter(Boolean).join(' · ') });
    else if (e.kind === 'linked') items.push({ ...base, title: 'Linked to a profile', sub: [e.note, by(e)].filter(Boolean).join(' · ') });
    else if (e.kind === 'contact_changed') items.push({ ...base, title: 'Contact changed', sub: [e.note, by(e)].filter(Boolean).join(' · ') });
    else if (e.kind === 'coupon_used' && e.note !== LEGACY_NOTE) items.push({ ...base, title: 'Coupon used', sub: [e.booking?.booking_number, e.note, by(e)].filter(Boolean).join(' · ') });
    else if (e.kind === 'legacy_checked_valid') items.push({ ...base, title: 'Checked · still valid', sub: ['Given before the update', by(e)].filter(Boolean).join(' · ') });
    else if (e.kind === 'legacy_checked_used' && isCoupon(v)) items.push({ ...base, title: 'Checked · already used', sub: [LEGACY_NOTE, by(e)].filter(Boolean).join(' · ') });
    else if (e.kind === 'legacy_check_undone') items.push({ ...base, title: 'Check undone', sub: by(e) || '' });
  });
  (history?.corrections || []).forEach((a) => {
    const oldV = Number(a.old_data?.total_amount_issued || 0);
    const newV = Number(a.new_data?.total_amount_issued || 0);
    items.push({ key: `a${a.id}`, date: nepalDate(a.changed_at), sort: a.changed_at, title: 'Balance corrected', sub: [a.reason ? `"${a.reason}"` : null, a.changer?.full_name ? `by ${shortName(a.changer.full_name)}` : null].filter(Boolean).join(' · '), amount: newV - oldV });
  });
  return items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.sort || '').localeCompare(String(a.sort || '')));
};

// ── Voucher detail ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Who it's for (and who bought it), the ticket (value left, dates), People (For / Bought by / Used by, with Remind or Add phone),
// the Sale (worth vs paid) and the History. Actions: Redeem (value voucher) or Mark used (coupon), Remind, Copy code; the ⋯ menu
// has Edit contact, Extend (admin) and Correct balance (admin). Each action is a stacked sub-view. Props are unchanged from
// before (the Customers panel opens it too), plus `initialView` to land on a sub-view and `match` (the customer whose phone it
// shares) for the Link banner.
const VoucherDetailPanel = ({ voucherId, readOnly = false, width, initialView = null, match = null, onClose, onChanged }) => {
  const { orgSlug } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { orgName } = useOrg();
  const orgId = profile?.org_id;
  const role = profile?.role;
  const isAdmin = role === 'admin';
  const canManage = !readOnly && (role === 'manager' || role === 'admin');
  const today = nepalNow().today;
  const [voucher, setVoucher] = useState(null);
  const [claims, setClaims] = useState([]);
  const [history, setHistory] = useState(null);
  const [branches, setBranches] = useState([]);
  const [services, setServices] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState(SUB_VIEWS.includes(initialView) ? initialView : 'detail');
  const [contactFocus, setContactFocus] = useState('for');
  const [notice, setNotice] = useState('');
  const [linking, setLinking] = useState(false);
  const { copied, copy } = useCopy();

  const loadData = useCallback(async () => {
    setLoadError(null);
    const [voucherRes, claimsRes, historyRes, branchesRes, servicesRes] = await Promise.all([
      fetchVoucher(voucherId),
      fetchVoucherClaims(voucherId),
      fetchVoucherHistory(voucherId),
      orgId ? fetchBranchesByOrgId(orgId) : Promise.resolve({ data: [] }),
      orgId ? fetchServicesByOrgId(orgId) : Promise.resolve({ data: [] }),
    ]);
    if (voucherRes.error) { setLoadError(voucherRes.error.message || 'Failed to load voucher.'); return; }
    setVoucher(voucherRes.data);
    setClaims(claimsRes.data || []);
    setHistory(historyRes.data || null);
    setBranches(branchesRes.data || []);
    setServices(servicesRes.data || []);
  }, [voucherId, orgId]);
  useEffect(() => { setVoucher(null); loadData(); }, [loadData]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const done = (message) => { setView('detail'); setNotice(message || ''); loadData(); onChanged?.(); };
  const back = () => setView('detail');
  const v = voucher;
  const status = v ? statusOf(v, today) : null;
  const coupon = v ? isCoupon(v) : false;
  const usable = !!v && !isExpired(v, today) && !v.needsCheck;
  const canRedeem = canManage && usable && !coupon && remainingOf(v) > 0;
  const canMarkUsed = canManage && usable && coupon && !v.couponUsed;

  if (v && !readOnly) {
    const props = { voucher: { ...v, id: voucherId }, today, onBack: back, onClose, onDone: done, width };
    if (view === 'claim' && canRedeem) return <ClaimView {...props} branches={branches} services={services} />;
    if (view === 'coupon' && canMarkUsed) return <CouponView {...props} />;
    if (view === 'extend' && isAdmin) return <ExtendView {...props} />;
    if (view === 'contact' && canManage) return <ContactView {...props} focus={contactFocus} />;
    if (view === 'correct' && isAdmin && !coupon) {
      return (
        <ValueCorrectionView width={width}
          title="Correct balance" label="Correct value left (NPR)" kind="number"
          currentLabel={`${formatNPR(v.remainingBalance)} left of ${formatNPR(v.totalAmountIssued)}`}
          warning={`Value left is the voucher's worth minus what has been redeemed, so this adjusts the worth and leaves the redemption history intact. The "Gift vouchers distributed" figure for ${longDate(v.issuedDate)} changes to match. Cash is unaffected. To remove a redemption that never happened, void it instead.`}
          afterRows={(x) => [['Value left', `${formatNPR(v.remainingBalance)} → ${formatNPR(x)}`, 'total'], ['Worth', `${formatNPR(v.totalAmountIssued)} → ${formatNPR(Number(v.totalClaimed || 0) + x)}`]]}
          onSubmit={({ value, reason }) => adminCorrectVoucherBalance({ voucherId, newRemaining: value, reason })}
          onBack={back} onClose={onClose} onDone={() => done('Balance corrected.')}
        />
      );
    }
  }

  // Reminders: For first (their phone), else the Bought by person. Opening the link is logged.
  const bookUrl = orgSlug ? `${window.location.origin}/${orgSlug}/book` : '';
  const urlFor = (to) => {
    if (!v || readOnly || !canManage) return null;
    const phone = to === 'buyer' ? buyerPhoneOf(v) : forPhone(v);
    return phone ? buildWhatsAppUrl(phone, reminderText(v, { to, orgName, bookUrl })) : null;
  };
  const logRemind = async (to) => {
    const { error } = await logVoucherReminder({ voucherId, note: to === 'buyer' ? `to ${v.buyerName || 'the buyer'}` : `to ${v.guestName}` });
    if (error) { setNotice(''); setLoadError(friendlyError(error, 'Could not save the reminder.')); return; }
    loadData();
    onChanged?.();
  };
  const remindable = !!v && (usable || status === 'expired') && (coupon ? !v.couponUsed : remainingOf(v) > 0);
  const forUrl = remindable ? urlFor('for') : null;
  const buyerUrl = remindable && v?.buyerName ? urlFor('buyer') : null;
  const headerRemind = forUrl ? { url: forUrl, to: 'for' } : buyerUrl ? { url: buyerUrl, to: 'buyer' } : null;

  const linkMatch = async () => {
    if (!match || !v) return;
    setLinking(true);
    const { error } = await updateVoucherContact({
      voucherId, guestName: v.guestName, guestInfo: v.guestInfo, customerId: match.customerId,
      buyerName: v.buyerName, buyerPhone: v.buyerPhone, buyerCustomerId: v.buyerCustomerId,
    });
    setLinking(false);
    if (error) { setLoadError(friendlyError(error, 'Could not link the profile.')); return; }
    done(`Linked to ${match.customerName}'s profile.`);
  };

  const menu = !canManage || !v ? [] : [
    { key: 'contact', label: 'Edit contact', icon: 'UserPen', run: () => { setContactFocus('for'); setView('contact'); } },
    ...(isAdmin ? [{ key: 'extend', label: 'Extend', icon: 'CalendarPlus', run: () => setView('extend') }] : []),
    ...(isAdmin && !coupon ? [{ key: 'correct', label: 'Correct balance', icon: 'Pencil', run: () => setView('correct') }] : []),
  ];
  const profileUrl = v?.customerId ? `/${orgSlug}/customers/${v.customerId}` : null;
  const buyerUrlProfile = v?.buyerCustomerId ? `/${orgSlug}/customers/${v.buyerCustomerId}` : null;
  const fPhone = v ? forPhone(v) : null;
  const bPhone = v ? buyerPhoneOf(v) : null;
  const valid = v ? validLine(v, today) : { text: '', tone: '' };
  const used = usedBy(claims);
  const items = v ? historyOf(v, claims, history) : [];
  const paidModes = [...new Set((history?.payments || []).map((p) => p.payment_mode).filter(Boolean))].join(' + ');
  const headSub = !v ? '' : v.buyerName ? `A gift from ${v.buyerName}` : fPhone ? phoneText(fPhone) : (v.guestInfo || 'No phone yet');
  const ticketSub = !v ? '' : coupon
    ? (v.couponUsed ? 'off one visit · used' : `off one visit · at any ${wordBranch()}`)
    : status === 'usedUp' ? `fully redeemed · it was worth ${npr(valueOf(v))}` : `left of ${npr(valueOf(v))} · use over several visits, at any ${wordBranch()}`;

  return (
    <PanelShell width={width} variant="panel" title="Voucher" onClose={onClose} hideFooter headerExtra={menu.length ? <OverflowMenu items={menu} /> : null}>
      {!v && !loadError && (
        <div className="px-5 py-5 space-y-3" aria-busy="true" aria-label="Loading voucher">
          <div className="flex items-center gap-3.5"><div className="w-11 h-11 rounded-full bg-[#F1F1EF] animate-pulse" /><div className="h-5 w-40 rounded bg-[#F1F1EF] animate-pulse" /></div>
          <div className="h-[160px] rounded-xl bg-[#F1F1EF] animate-pulse" />
          {[0, 1].map((i) => <div key={i} className="h-12 rounded-lg bg-[#F1F1EF] animate-pulse" />)}
        </div>
      )}
      {loadError && (
        <div className="px-5 pt-5">
          <div role="alert" className="flex items-center gap-2 border border-error/30 bg-error/5 rounded-spa px-3 py-2">
            <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
            <p className="flex-1 text-[13px] text-error">{loadError}</p>
            <button type="button" onClick={loadData} className="text-[13px] font-body-medium text-error underline">Retry</button>
          </div>
        </div>
      )}
      {v && (
        <>
          <div className="px-5 pt-1 pb-4 border-b border-border">
            <div className="flex items-center gap-3.5">
              <Avatar name={v.guestName} size={44} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {profileUrl
                    ? <Link to={profileUrl} className="text-[17px] font-semibold tracking-[-0.3px] text-text-primary hover:text-primary hover:underline truncate">{v.guestName}</Link>
                    : <span className="text-[17px] font-semibold tracking-[-0.3px] text-text-primary truncate">{v.guestName}</span>}
                  <StatusPill status={status} config={STATUS} />
                </div>
                <p className="text-[12.5px] text-[#8A8A90] mt-0.5 tabular-nums truncate">{headSub}</p>
              </div>
            </div>
            {(canRedeem || canMarkUsed || headerRemind || v) && (
              <div className="flex gap-2 mt-4 flex-wrap">
                {canRedeem && <button type="button" onClick={() => setView('claim')} className={primaryBtn} data-redeem><Icon name="Ticket" size={14} />Redeem</button>}
                {canMarkUsed && <button type="button" onClick={() => setView('coupon')} className={primaryBtn} data-mark-used><Icon name="Check" size={14} />Mark used</button>}
                {headerRemind && (
                  <a href={headerRemind.url} target="_blank" rel="noopener noreferrer" onClick={() => logRemind(headerRemind.to)} className={ghostBtn} data-remind><Icon name="MessageSquare" size={14} />Remind</a>
                )}
                <button type="button" onClick={() => copy(v.voucherCode)} className={ghostBtn} data-copy-code><Icon name={copied ? 'Check' : 'Copy'} size={14} />{copied ? 'Copied' : 'Copy code'}</button>
              </div>
            )}
          </div>

          <div className="px-5 py-[18px] flex flex-col gap-[18px]">
            {notice && (
              <p role="status" className="flex items-start gap-2 border border-success/30 bg-success/5 rounded-spa px-3 py-2 text-[13px] text-success">
                <Icon name="CheckCircle2" size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span>
              </p>
            )}
            {v.needsCheck && (
              <div className="flex items-start gap-2.5 rounded-[10px] border border-[#C7D2FE] bg-[#EEF2FF]/70 px-3.5 py-3 text-[13px]" data-needs-check>
                <Icon name="AlertTriangle" size={15} className="text-[#4338CA] mt-0.5 flex-shrink-0" />
                <p className="flex-1 text-[#3730A3]">Given free before the update. Check whether it was already used before anyone redeems it.</p>
                {canManage && <button type="button" onClick={() => navigate('?view=vouchers&review=1')} className="text-[13px] font-semibold text-[#4338CA] hover:underline whitespace-nowrap">Check</button>}
              </div>
            )}

            <TicketCard v={v} sub={ticketSub} left={`${v.issueKind === 'free' ? 'Given' : 'Sold'} ${longDate(v.issuedDate)} · ${v.branchName}`} right={valid.text} rightTone={status === 'usedUp' || status === 'used' ? '' : valid.tone} />

            {match && !v.customerId && canManage && (
              <div className="flex items-center gap-2.5 rounded-[10px] border border-[#C7D2FE] bg-[#EEF2FF]/60 px-3.5 py-2.5 text-[13px]" data-match-banner>
                <Icon name="Link" size={14} className="text-[#4F46E5] flex-shrink-0" />
                <p className="flex-1 min-w-0 text-[#3730A3] truncate">Same phone as {match.customerName}&apos;s profile</p>
                <button type="button" disabled={linking} onClick={linkMatch} className="text-[13px] font-semibold text-[#4338CA] hover:underline disabled:opacity-50">{linking ? 'Linking…' : 'Link'}</button>
              </div>
            )}

            <section>
              <div className={SECTION}>People</div>
              <div className="border border-border rounded-[10px] divide-y divide-[#F1F1EF]" data-people>
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="w-[74px] text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.04em] flex-shrink-0">For</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-text-primary truncate">{v.guestName}</p>
                    <p className="text-[12.5px] text-[#8A8A90] tabular-nums truncate">{fPhone ? phoneText(fPhone) : (v.guestInfo || 'No phone yet')}{v.customerId && <> · <Link to={profileUrl} className="hover:underline">customer profile</Link></>}</p>
                  </div>
                  {forUrl ? <a href={forUrl} target="_blank" rel="noopener noreferrer" onClick={() => logRemind('for')} className="h-[26px] px-[9px] rounded-md border border-border bg-white text-[12px] font-medium inline-flex items-center gap-[5px] hover:bg-[#FAFAF9]" data-remind-for><Icon name="MessageSquare" size={13} />Remind</a>
                    : !fPhone && canManage ? <MiniButton icon={<Icon name="Plus" size={13} />} onClick={() => { setContactFocus('phone'); setView('contact'); }} data-add-phone>Add phone</MiniButton> : null}
                </div>
                {(v.buyerName || v.buyerCustomerId) && (
                  <div className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className="w-[74px] text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.04em] flex-shrink-0">Bought by</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-text-primary truncate">{v.buyerName}</p>
                      <p className="text-[12.5px] text-[#8A8A90] tabular-nums truncate">{bPhone ? phoneText(bPhone) : 'No phone yet'}{buyerUrlProfile && <> · <Link to={buyerUrlProfile} className="hover:underline">customer profile</Link></>}</p>
                    </div>
                    {buyerUrl && <a href={buyerUrl} target="_blank" rel="noopener noreferrer" onClick={() => logRemind('buyer')} className="h-[26px] px-[9px] rounded-md border border-border bg-white text-[12px] font-medium inline-flex items-center gap-[5px] hover:bg-[#FAFAF9]" data-remind-buyer><Icon name="MessageSquare" size={13} />Remind</a>}
                  </div>
                )}
                {used.length > 0 && (
                  <div className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className="w-[74px] text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.04em] flex-shrink-0">Used by</span>
                    <div className="flex-1 min-w-0 space-y-1">
                      {used.map((u) => (
                        <div key={u.name}>
                          <p className="text-[13px] font-medium text-text-primary truncate">{u.name}</p>
                          <p className="text-[12.5px] text-[#8A8A90] tabular-nums">{u.visits} visit{u.visits === 1 ? '' : 's'} · {longDate(u.last).replace(/ \d{4}$/, '')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-[12.5px] text-[#8A8A90] mt-2">
                Anyone with the code can use it.{!fPhone && bPhone ? ` Remind sends ${firstName(v.buyerName)} a message to pass on, until we have ${firstName(v.guestName)}'s number.` : ''}
              </p>
            </section>

            <section>
              <div className={SECTION}>Sale</div>
              <InfoRows rows={[
                ['Worth', coupon ? `${Number(v.percentOff)}% off one visit` : npr(valueOf(v))],
                ['Paid', v.issueKind === 'free'
                  ? ['Given free', freeReasonLabel(v.freeReason), v.freeNote].filter(Boolean).join(' · ')
                  : [npr(v.amountPaid), paidModes || null, Number(v.discountPercent) > 0 ? `${Number(v.discountPercent)}% off` : null].filter(Boolean).join(' · ')],
                [v.issueKind === 'free' ? 'Given by' : 'Sold by', [v.issuedByName && v.issuedByName !== '—' ? shortName(v.issuedByName) : null, v.branchName].filter(Boolean).join(' at ')],
              ]} />
            </section>

            <section>
              <div className={`${SECTION} flex items-baseline justify-between gap-3`}>
                <span>History</span>
                <button type="button" onClick={() => navigate(`?view=voucher-activity&voucher=${voucherId}&r=all`)} className="normal-case tracking-normal text-[12px] font-normal text-[#515152] hover:text-text-primary hover:underline" data-see-all>See all</button>
              </div>
              <ul className="flex flex-col" data-timeline>
                {items.map((it) => {
                  const tile = tileDate(it.date);
                  return (
                    <li key={it.key} className="flex gap-3 items-start py-2" data-history-item>
                      <div className="w-10 text-center rounded-md bg-[#FAFAF9] border border-border py-[3px] flex-shrink-0">
                        <b className="block text-[14px] font-semibold tabular-nums">{String(tile.day).padStart(2, '0')}</b>
                        <span className="text-[9.5px] text-[#8A8A90] font-semibold uppercase">{tile.mon}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-text-primary">{it.title}</p>
                        {it.sub && <p className="text-[12.5px] text-[#8A8A90] mt-0.5">{it.sub}</p>}
                      </div>
                      <span className={`text-[13px] font-semibold tabular-nums whitespace-nowrap ${it.amount > 0 ? 'text-[#15803D]' : it.amount < 0 ? 'text-text-primary' : 'text-[#B4B4BA]'}`}>
                        {!it.amount ? '—' : `${it.amount > 0 ? '+' : '−'} ${Math.abs(it.amount).toLocaleString('en-IN')}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
            {v.remarks && <p className="text-[12.5px] text-[#8A8A90] whitespace-pre-wrap"><span className="text-[#515152] font-medium">Remarks</span> · {v.remarks}</p>}
          </div>
        </>
      )}
    </PanelShell>
  );
};

export default VoucherDetailPanel;
