import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CountryCodeSelect, { parsePhone } from '../../../../components/ui/CountryCodeSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import { PanelShell, FormBody, Field, TextInput, DateField, InfoRows, InlineError, CONTROL, controlA11y } from '../../../../components/ui/PanelFormKit';
import { useBranch } from '../../../../contexts/BranchContext';
import { extendVoucher, updateVoucherContact, markCouponUsed, findBookingIdByNumber } from '../../../../services/api';
import { EXTEND_CHIPS, extendBase, isCoupon, remainingOf, longDate, npr, daysUntil, addDays, validLine, shortName } from '../../../../services/vouchersView';
import { friendlyError } from '../../../../utils/friendlyError';
import { TicketCard } from './voucherBits';

// Stacked sub-views of the voucher panel (V23): Extend (admin), Edit contact (manager/admin) and Mark coupon used. Each has a back
// arrow; on success the panel lands back on the voucher with it refreshed.

const useCmdEnter = (run) => {
  const ref = useRef(run);
  ref.current = run;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ref.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
};
const chipCls = (on) => `h-8 px-3 rounded-full border text-[13px] font-medium tabular-nums ${on ? 'border-primary bg-[#EEF3EC] text-primary shadow-[0_0_0_2px_rgba(45,90,39,.10)]' : 'border-border bg-white text-text-primary hover:bg-[#FAFAF9]'}`;
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const digitsOf = (v) => String(v || '').replace(/\D/g, '');

// ── Extend (admin) ──────────────────────────────────────────────────────────────────────────────
export const ExtendView = ({ voucher: v, today, onBack, onClose, onDone, width }) => {
  const base = extendBase(v, today);
  const [chip, setChip] = useState('30d');
  const [date, setDate] = useState(() => EXTEND_CHIPS.find((c) => c.id === '30d').next(base));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const minDate = v.expiryDate >= today ? addDays(v.expiryDate, 1) : today;
  const valid = validLine(v, today);
  const tooEarly = !date || date < minDate;
  const why = tooEarly ? 'Pick a later date' : !reason.trim() ? 'Add a reason' : '';

  const submit = async () => {
    if (why || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await extendVoucher({ voucherId: v.id, newExpiry: date, reason: reason.trim() });
    setBusy(false);
    if (err) { setError(friendlyError(err, 'Could not extend the voucher.')); return; }
    onDone(`Valid until ${longDate(date)}.`);
  };
  useCmdEnter(submit);
  const whatLeft = isCoupon(v) ? `${Number(v.percentOff)}% off one visit` : npr(remainingOf(v));

  return (
    <PanelShell width={width} variant="panel" title="Extend voucher" onBack={onBack} onClose={onClose} dirty={!!reason} busy={busy} reason={why}
      primary={{ label: busy ? 'Extending…' : `Extend to ${longDate(date).replace(/ \d{4}$/, '')}`, onClick: submit, disabled: !!why, loading: busy }}>
      <FormBody>
        <InlineError message={error} />
        <TicketCard v={v} sub={isCoupon(v) ? `off one visit · for ${v.guestName}` : `left of ${npr(v.totalAmountIssued)} · for ${v.guestName}`}
          left={`${v.issueKind === 'free' ? 'Given' : 'Sold'} ${longDate(v.issuedDate)} · ${v.branchName}`} right={valid.text} rightTone={valid.tone} />
        <div>
          <DateField label="New expiry date" id="vx-date" value={date} min={minDate} onChange={(d) => { setDate(d); setChip(''); }} error={tooEarly && date ? `Pick ${longDate(minDate)} or later.` : undefined} />
          <div className="flex flex-wrap gap-2 mt-2" role="group" aria-label="Extend by">
            {EXTEND_CHIPS.map((c) => (
              <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => { setChip(c.id); setDate(c.next(base)); }} className={chipCls(chip === c.id)} data-extend-chip={c.id}>{c.label}</button>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-[#8A8A90]">
            Counted from {base === today ? 'today' : `the current expiry (${longDate(base)})`}. {firstName(v.guestName)} can use the {whatLeft} until {longDate(date)}.
          </p>
        </div>
        <Field label="Reason" required id="vx-reason">
          <TextInput id="vx-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest was ill in September" />
        </Field>
        <InfoRows rows={[['Valid until', <span key="v">{longDate(v.expiryDate)} → <b className="font-semibold">{longDate(date)}</b></span>], ['Value left', `${whatLeft} (unchanged)`]]} />
        <p className="text-[12.5px] text-[#8A8A90]">Only admins can extend. It&apos;s saved in the voucher&apos;s history with your name and the reason.</p>
      </FormBody>
    </PanelShell>
  );
};

// ── Edit contact (manager/admin) ────────────────────────────────────────────────────────────────
// For: name (autocomplete links a profile), phone or a note; Bought by: name (autocomplete) and phone. Saved in one call; the
// voucher's history notes what changed.
const PersonFields = ({ idPrefix, label, name, setName, linked, setLinked, dial, setDial, phone, setPhone, branchId, extra }) => (
  <div className="space-y-2">
    <Field label={label} id={`${idPrefix}-name`} labelExtra={linked ? (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />Linked to a profile
        <button type="button" onClick={() => setLinked(null)} className="text-primary hover:underline">Unlink</button>
      </span>
    ) : null}>
      <CustomerAutocomplete id={`${idPrefix}-name`} value={name} branchId={branchId} searchBy="name" placeholder="Full name" inputClassName={CONTROL}
        onChange={(val) => { setName(val); if (linked) setLinked(null); }}
        onSelect={(c) => {
          setName(c.full_name);
          setLinked({ id: c.id, name: c.full_name });
          if (c.phone) { const p = parsePhone(c.phone); setDial(p.dial); setPhone(p.national); }
        }} />
    </Field>
    <div className="flex">
      <CountryCodeSelect value={dial} onChange={setDial} />
      <input {...controlA11y(`${idPrefix}-phone`)} type="tel" inputMode="numeric" aria-label={`${label} phone`} value={phone} placeholder="9841234567"
        onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
        className="flex-1 min-w-0 h-10 px-3 text-[13px] border border-border rounded-r-spa rounded-l-none bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
    </div>
    {extra}
  </div>
);

const splitPhone = (s) => {
  if (!s || digitsOf(s).length < 7) return { dial: '+977', national: '' };
  const p = parsePhone(s);
  return { dial: p.dial || '+977', national: p.national || digitsOf(s) };
};

export const ContactView = ({ voucher: v, onBack, onClose, onDone, width, focus = 'for' }) => {
  const { branchId } = useBranch();
  const forIsPhone = digitsOf(v.guestInfo).length >= 7;
  const fp = splitPhone(forIsPhone ? v.guestInfo : (v.customerPhone || ''));
  const bp = splitPhone(v.buyerPhone || v.buyerCustomerPhone || '');
  const [name, setName] = useState(v.guestName || '');
  const [linked, setLinked] = useState(v.customerId ? { id: v.customerId, name: v.customerName } : null);
  const [dial, setDial] = useState(fp.dial);
  const [phone, setPhone] = useState(fp.national);
  const [note, setNote] = useState(forIsPhone ? '' : (v.guestInfo || ''));
  const [bName, setBName] = useState(v.buyerName || '');
  const [bLinked, setBLinked] = useState(v.buyerCustomerId ? { id: v.buyerCustomerId, name: v.buyerName } : null);
  const [bDial, setBDial] = useState(bp.dial);
  const [bPhone, setBPhone] = useState(bp.national);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => document.getElementById(focus === 'buyer' ? 'vcb-name' : (focus === 'phone' ? 'vcf-phone' : 'vcf-name'))?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, [focus]);

  const phoneDigits = digitsOf(phone);
  const bPhoneDigits = digitsOf(bPhone);
  const badPhone = (d) => d && (d.length < 7 || d.length > 15);
  const why = !name.trim() ? 'Enter the guest name' : badPhone(phoneDigits) || badPhone(bPhoneDigits) ? 'Check the phone number' : (bPhoneDigits && !bName.trim()) ? 'Add who bought it' : '';
  const guestInfo = phoneDigits ? `${dial}${phoneDigits}` : (note.trim() || null);
  const buyerPhone = bPhoneDigits ? `${bDial}${bPhoneDigits}` : null;
  const dirty = name !== (v.guestName || '') || (linked?.id || null) !== (v.customerId || null) || (guestInfo || null) !== (v.guestInfo || null)
    || bName !== (v.buyerName || '') || (bLinked?.id || null) !== (v.buyerCustomerId || null) || (buyerPhone || null) !== (v.buyerPhone || null);

  const submit = async () => {
    if (why || busy || !dirty) return;
    setBusy(true);
    setError(null);
    const { error: err } = await updateVoucherContact({
      voucherId: v.id, guestName: name.trim(), guestInfo, customerId: linked?.id || null,
      buyerName: bName.trim() || null, buyerPhone, buyerCustomerId: bName.trim() ? (bLinked?.id || null) : null,
    });
    setBusy(false);
    if (err) { setError(friendlyError(err, 'Could not save the contact.')); return; }
    onDone('Contact saved.');
  };
  useCmdEnter(submit);

  return (
    <PanelShell width={width} variant="panel" title="Edit contact" onBack={onBack} onClose={onClose} dirty={dirty} busy={busy} reason={why || (!dirty ? 'Nothing changed yet' : '')}
      primary={{ label: busy ? 'Saving…' : 'Save', onClick: submit, disabled: !!why || !dirty, loading: busy }}>
      <FormBody>
        <InlineError message={error} />
        <PersonFields idPrefix="vcf" label="For" name={name} setName={setName} linked={linked} setLinked={setLinked} dial={dial} setDial={setDial} phone={phone} setPhone={setPhone} branchId={branchId}
          extra={!phoneDigits ? <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Company or note (optional)" aria-label="Company or note" /> : null} />
        <PersonFields idPrefix="vcb" label="Bought by" name={bName} setName={setBName} linked={bLinked} setLinked={setBLinked} dial={bDial} setDial={setBDial} phone={bPhone} setPhone={setBPhone} branchId={branchId} />
        <p className="text-[12.5px] text-[#8A8A90]">Leave Bought by empty when the guest bought it for themselves. Changes are saved in the voucher&apos;s history.</p>
      </FormBody>
    </PanelShell>
  );
};

// ── Mark coupon used ────────────────────────────────────────────────────────────────────────────
// Applying the % at checkout comes later (V24); for now staff take the discount by hand and record it here.
export const CouponView = ({ voucher: v, today, onBack, onClose, onDone, width }) => {
  const [booking, setBooking] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let bookingId = null;
    if (booking.trim()) {
      const { data, error: err } = await findBookingIdByNumber(booking);
      if (err || !data) { setBusy(false); setError(`No booking ${booking.trim().toUpperCase()} found.`); return; }
      bookingId = data.id;
    }
    const { error: err } = await markCouponUsed({ voucherId: v.id, bookingId, note: note.trim() || null });
    setBusy(false);
    if (err) { setError(friendlyError(err, 'Could not mark the coupon used.')); return; }
    onDone('Coupon marked used.');
  };
  useCmdEnter(submit);
  const d = daysUntil(v.expiryDate, today);
  return (
    <PanelShell width={width} variant="panel" title="Mark coupon used" onBack={onBack} onClose={onClose} dirty={!!(booking || note)} busy={busy}
      primary={{ label: busy ? 'Saving…' : 'Mark used', onClick: submit, loading: busy }}>
      <FormBody>
        <InlineError message={error} />
        <TicketCard v={v} sub={`off one visit · for ${v.guestName}`} left={`${v.issueKind === 'free' ? 'Given' : 'Sold'} ${longDate(v.issuedDate)} · ${v.branchName}`}
          right={validLine(v, today).text} rightTone={d != null && d <= 30 ? 'amber' : ''} />
        <p className="flex items-start gap-2 text-[13px] text-[#515152]">
          <Icon name="Info" size={14} className="mt-0.5 flex-shrink-0 text-[#8A8A90]" />
          <span>Take the {Number(v.percentOff)}% off on the bill as a discount, then record it here so {shortName(v.guestName) || 'the guest'} can&apos;t use the coupon twice.</span>
        </p>
        <Field label="Booking number" id="vcu-booking" hint="Optional. The visit the coupon was used on.">
          <TextInput id="vcu-booking" value={booking} onChange={(e) => setBooking(e.target.value.toUpperCase())} placeholder="BK-20261019-0004" className="font-data" />
        </Field>
        <Field label="Note" id="vcu-note">
          <TextInput id="vcu-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </FormBody>
    </PanelShell>
  );
};
