import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import CountryCodeSelect, { parsePhone } from '../../../../components/ui/CountryCodeSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import {
  PanelShell, FormBody, Field, SelectField, Segmented, DateField, MoneyInput, RadioCards,
  InlineError, InlineWarning, CONTROL, CONTROL_ERROR, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { buildPaymentMethodTree } from '../../../../services/paymentMethods';
import { fetchMembershipTiers, fetchCustomersLightweight, findOrCreateCustomer, enrollMember } from '../../../../services/api';
import { toDateInputValue } from '../../../../utils/date';
import { friendlyError } from '../../../../utils/friendlyError';
import { samePhone } from '../../../../utils/phone';
import { maskDob, parseDob } from '../../../../utils/dobInput';

const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RADIO_TIERS = 4;
const SPLIT = 'grid grid-cols-1 sm:grid-cols-2 gap-3';

// First immediately-selectable leaf of the payment tree (a group's name isn't selectable once it has sub-methods).
function firstLeafValue(tree) {
  for (const item of tree) {
    if (!item.subMethods || item.subMethods.length === 0) return item.value;
    return item.subMethods[0].value;
  }
  return undefined;
}

// "15 Oct 2027" for the validity line.
const longDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const addDays = (ymd, days) => { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + Number(days || 0)); return d; };

const MEMBERSHIP_STATE_COPY = {
  active: 'is already a member',
  pending: 'already has a pending membership',
};

// "New membership": the right-hand panel (same shell, fields and footer as New booking). Callbacks are unchanged:
// onEnrolled(newMembershipId, { message }), onRenewExisting(membershipId), onClose().
const EnrollMemberPanel = ({ onClose, onEnrolled, onRenewExisting }) => {
  const { profile } = useAuth();
  const { branchId } = useBranch();
  const { paymentMethods } = useOrg();
  const orgId = profile?.org_id;
  const isAdmin = profile?.role === 'admin';
  const paymentTree = useMemo(() => buildPaymentMethodTree(paymentMethods), [paymentMethods]);

  const [tiers, setTiers] = useState(null); // null while loading
  const [tierId, setTierId] = useState('');
  const [customers, setCustomers] = useState(null); // the org's lightweight list (with each customer's membership status)

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+977');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [dobText, setDobText] = useState('');
  const [picked, setPicked] = useState(null); // the existing customer chosen from the suggestions
  // Which fields were filled from the pick (and not typed since): they are cleared again when the pick is dropped.
  const pickSourced = useRef({ email: false, gender: false });
  const [deposit, setDeposit] = useState('');
  const [paymentMode, setPaymentMode] = useState(() => firstLeafValue(paymentTree));
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [showBackdate, setShowBackdate] = useState(false);
  const [activationDate, setActivationDate] = useState('');

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const nameRef = useRef(null);

  // ── Data ───────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tRes, cRes] = await Promise.all([
        fetchMembershipTiers(orgId),
        branchId ? fetchCustomersLightweight(branchId) : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;
      if (tRes.error) { setServerError(friendlyError(tRes.error, 'Failed to load membership plans.')); setTiers([]); }
      else {
        setTiers(tRes.data || []);
        if (tRes.data?.length) setTierId(tRes.data[0].id);
      }
      setCustomers(cRes.error ? [] : (cRes.data || []));
    })();
    return () => { cancelled = true; };
  }, [orgId, branchId]);

  useEffect(() => { if (!paymentMode) setPaymentMode(firstLeafValue(paymentTree)); }, [paymentTree, paymentMode]);

  // Focus the first field once the panel has slid in (never scroll an ancestor while it is still moving).
  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────────────────────────
  const fullPhone = `${countryCode}${digitsOf(phone)}`;
  // A typed number that exactly matches an existing customer who has not been picked.
  const phoneOwner = useMemo(() => {
    if (picked || !customers || digitsOf(phone).length < 7) return null;
    return customers.find((c) => samePhone(c.phone, fullPhone)) || null;
  }, [picked, customers, phone, fullPhone]);
  const subject = picked || null; // the customer whose membership state we show (only a deliberate pick)
  const pm = subject?.primaryMembership || null;
  const blockingMembership = pm && (pm.status === 'active' || pm.status === 'pending') ? pm : null;
  const endedMembership = pm && (pm.status === 'lapsed' || pm.status === 'depleted') ? pm : null;

  const selectedTier = (tiers || []).find((t) => t.id === tierId) || null;
  const depositNum = Number(deposit) || 0;
  const advance = Number(selectedTier?.advance_amount || 0);
  const meetsThreshold = !!selectedTier && depositNum > 0 && depositNum >= advance;
  const today = toDateInputValue(new Date());
  const activatesOn = activationDate || today;
  const validUntil = selectedTier ? addDays(activatesOn, selectedTier.validity_days) : null;

  const dirty = !!(name || phone || email || gender || dobText || deposit || notes || activationDate);

  const reason = !name.trim() ? 'Enter the customer name'
    : !digitsOf(phone) ? 'Enter the phone'
    : blockingMembership ? 'Already a member'
    : phoneOwner ? 'Phone already on file'
    : !selectedTier ? 'Pick a plan'
    : depositNum <= 0 ? 'Enter the deposit'
    : '';

  // ── Handlers ───────────────────────────────────────────────────────────────────────────────────
  const clearError = (key) => { setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e)); setServerError(null); };

  const handleSelect = useCallback((c) => {
    setPicked(c);
    setName(c.full_name || '');
    const { dial, national } = parsePhone(c.phone);
    setCountryCode(dial);
    setPhone(national);
    setEmail(c.email || '');
    setGender(String(c.gender || '').toLowerCase()); // stored as 'Male' / 'Female'; the control uses lowercase
    pickSourced.current = { email: true, gender: true };
    setDobText('');
    setErrors({});
    setServerError(null);
  }, []);

  // Dropping the pick (name / phone / country edited) also drops what it filled in: a new customer must not inherit
  // someone else's email or gender.
  const unpick = () => {
    if (!picked) return;
    setPicked(null);
    if (pickSourced.current.email) setEmail('');
    if (pickSourced.current.gender) setGender('');
    pickSourced.current = { email: false, gender: false };
  };
  const onNameChange = (v) => { setName(v); unpick(); clearError('name'); };
  const onPhoneChange = (v) => { setPhone(v.replace(/\D/g, '').slice(0, 15)); unpick(); clearError('phone'); };

  const submit = async () => {
    if (submittingRef.current || reason) return;
    // Field-level validation: show every problem, then focus the first invalid field.
    const next = {};
    const digits = digitsOf(phone);
    if (digits.length < 7 || digits.length > 15) next.phone = 'Enter a valid phone number (7–15 digits).';
    if (!picked && email.trim() && !EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    const dob = picked ? { iso: '', error: null } : parseDob(dobText);
    if (dob.error) next.dob = dob.error;
    if (!(depositNum > 0)) next.deposit = 'Enter the deposit.';
    setErrors(next);
    const order = ['phone', 'email', 'dob', 'deposit'];
    const first = order.find((k) => next[k]);
    if (first) {
      const el = document.getElementById(`enr-${first}`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setServerError(null);

    let customerId = picked?.id || null;
    if (!customerId) {
      const { data: cust, error: custErr } = await findOrCreateCustomer({
        orgId,
        branchId,
        fullName: name.trim(),
        phone: `${countryCode}${digits}`,
        email: email.trim() || null,
        gender: gender || null,
        dateOfBirth: dob.iso || null,
      });
      if (custErr) {
        submittingRef.current = false;
        setSubmitting(false);
        setServerError(friendlyError(custErr, 'Failed to find or create the customer.'));
        return;
      }
      customerId = cust?.customerId;
    }

    const { data, error: rpcError } = await enrollMember({
      customerId,
      tierId,
      initialDeposit: depositNum,
      paymentMode,
      notes: notes.trim() || null,
      branchId,
      activationDate: activationDate || null,
    });
    submittingRef.current = false;
    setSubmitting(false);

    if (rpcError) {
      setServerError(/uniq_active_membership_per_customer/.test(rpcError?.message || '')
        ? 'This customer already has an active membership. Open it from Memberships to top up or renew.'
        : friendlyError(rpcError, 'Failed to enroll member.'));
      return;
    }
    const who = name.trim();
    onEnrolled(data?.membershipId || null, {
      message: meetsThreshold
        ? `${who} is now a member.`
        : `Membership created for ${who} — pending until ${formatNPR(Math.max(0, advance - depositNum))} more is paid.`,
    });
  };

  // ⌘/Ctrl+Enter submits when the primary is enabled. (Enter in a single-line field never submits: this is not a <form>.)
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitRef.current(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────
  const primaryLabel = depositNum > 0 ? `Enroll · ${formatNPR(depositNum)}` : 'Enroll';
  const tierOptions = (tiers || []).map((t) => ({
    value: t.id,
    title: t.name,
    detail: `${formatNPR(t.advance_amount)} advance · ${t.validity_days} days`,
  }));
  const phoneInputClass = `flex-1 min-w-0 h-10 px-3 text-[13px] border rounded-r-spa rounded-l-none bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ${errors.phone ? 'border-error' : 'border-border'}`;
  const nameInputClass = `${CONTROL}`;
  const lockedContact = !!picked;

  return (
    <PanelShell
      variant="panel"
      title="New membership"
      onClose={onClose}
      dirty={dirty}
      busy={submitting}
      reason={reason}
      primary={{ label: primaryLabel, onClick: submit, disabled: !!reason || tiers === null, loading: submitting }}
    >
      <FormBody>
        <InlineError message={serverError} />

        <Field label="Customer name" required id="enr-name" error={errors.name}>
          <CustomerAutocomplete
            id="enr-name"
            value={name}
            onChange={onNameChange}
            onSelect={handleSelect}
            branchId={branchId}
            customers={customers || undefined}
            inputRef={nameRef}
            inputClassName={nameInputClass}
          />
        </Field>

        <Field label="Phone" required id="enr-phone" error={errors.phone}>
          <div className="flex">
            <CountryCodeSelect value={countryCode} onChange={(v) => { setCountryCode(v); unpick(); }} />
            <CustomerAutocomplete
              id="enr-phone"
              ariaInvalid={!!errors.phone}
              ariaDescribedBy={errors.phone ? 'enr-phone-error' : undefined}
              value={phone}
              onChange={onPhoneChange}
              onSelect={handleSelect}
              branchId={branchId}
              customers={customers || undefined}
              searchBy="phone"
              inputClassName={phoneInputClass}
            />
          </div>
        </Field>

        {phoneOwner && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-spa border border-border text-[13px]">
            <span className="flex-1 min-w-0 text-text-primary">This number belongs to <span className="font-body-medium">{phoneOwner.full_name}</span>.</span>
            <button type="button" onClick={() => handleSelect(phoneOwner)} className="font-body-medium text-primary hover:underline whitespace-nowrap">Use {phoneOwner.full_name.split(' ')[0]}</button>
          </div>
        )}

        {blockingMembership && (
          <div className="space-y-2">
            <InlineWarning message={`${subject.full_name} ${MEMBERSHIP_STATE_COPY[blockingMembership.status]} (${blockingMembership.membershipNumber || 'no card number yet'}).`} />
            {onRenewExisting && (
              <button type="button" onClick={() => onRenewExisting(blockingMembership.id)} className="text-[13px] font-body-medium text-primary hover:underline">Open membership</button>
            )}
          </div>
        )}
        {endedMembership && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-spa border border-border text-[13px]">
            <span className="flex-1 min-w-0 text-text-secondary">
              {endedMembership.membershipNumber || 'Their last membership'} {endedMembership.status === 'lapsed' ? 'has lapsed' : 'is used up'}.
            </span>
            {onRenewExisting && (
              <button type="button" onClick={() => onRenewExisting(endedMembership.id)} className="font-body-medium text-primary hover:underline whitespace-nowrap">Renew instead</button>
            )}
          </div>
        )}

        <Field label="Email" id="enr-email" error={errors.email} hint={lockedContact ? "Edit contact details from the customer's profile." : undefined}>
          <input
            {...controlA11y('enr-email', errors.email)}
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); pickSourced.current.email = false; clearError('email'); }}
            disabled={lockedContact}
            placeholder="customer@email.com"
            className={`${CONTROL} ${errors.email ? CONTROL_ERROR : ''}`}
          />
        </Field>

        <Field label="Gender">
          <Segmented
            options={[['male', 'Male'], ['female', 'Female']]}
            value={gender}
            onChange={(v) => { setGender(gender === v ? '' : v); pickSourced.current.gender = false; }}
            disabled={lockedContact}
          />
        </Field>

        {!lockedContact && (
          <Field label="Date of birth" id="enr-dob" error={errors.dob} hint="Used for the birthday perk. Leave blank if not given.">
            <input
              {...controlA11y('enr-dob', errors.dob)}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={dobText}
              onChange={(e) => { setDobText(maskDob(e.target.value)); clearError('dob'); }}
              placeholder="DD/MM/YYYY"
              className={`${CONTROL} font-data tabular-nums ${errors.dob ? CONTROL_ERROR : ''}`}
            />
          </Field>
        )}

        <Field label="Plan" required>
          {tiers === null ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading plans">
              {[0, 1].map((i) => <div key={i} className="h-[52px] rounded-spa border border-border bg-background animate-pulse" />)}
            </div>
          ) : tiers.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No membership plans yet.</p>
          ) : tiers.length > MAX_RADIO_TIERS ? (
            <SelectField value={tierId} onChange={setTierId} options={tierOptions.map((o) => ({ value: o.value, label: `${o.title} — ${o.detail}` }))} placeholder="Select a plan" />
          ) : (
            <RadioCards options={tierOptions} value={tierId} onChange={setTierId} label="Plan" id="enr-plan" />
          )}
        </Field>

        <div className={SPLIT}>
          <Field label="Deposit" required id="enr-deposit" error={errors.deposit}>
            <MoneyInput
              {...controlA11y('enr-deposit', errors.deposit)}
              value={deposit}
              onChange={(v) => { setDeposit(v); clearError('deposit'); }}
              error={errors.deposit}
            />
          </Field>
          <Field label="Method" required>
            <PaymentMethodSelector value={paymentMode} onChange={setPaymentMode} paymentMethods={paymentMethods} />
          </Field>
        </div>
        {selectedTier && advance > 0 && depositNum !== advance && (
          <button type="button" onClick={() => { setDeposit(String(advance)); clearError('deposit'); }} className="-mt-2 text-[13px] font-body-medium text-primary hover:underline">Fill advance ({formatNPR(advance)})</button>
        )}

        {selectedTier && depositNum > 0 && (
          meetsThreshold ? (
            <p className="flex items-start gap-2 text-[13px] text-success" aria-live="polite">
              <Icon name="Check" size={14} className="mt-0.5 flex-shrink-0" />
              <span>{activationDate && activationDate < today ? `Activates ${longDate(new Date(`${activationDate}T00:00:00`))}` : 'Activates today'} · valid until {longDate(validUntil)}</span>
            </p>
          ) : (
            <p className="flex items-start gap-2 text-[13px] text-warning" aria-live="polite">
              <Icon name="Clock" size={14} className="mt-0.5 flex-shrink-0" />
              <span>Starts as pending — {formatNPR(Math.max(0, advance - depositNum))} more to activate</span>
            </p>
          )
        )}

        {isAdmin && (showBackdate ? (
          <DateField
            label="Backdate activation"
            value={activationDate}
            onChange={setActivationDate}
            hint="Admin only. Leave blank to activate today. Only applies if this deposit meets the plan's advance."
          />
        ) : (
          <button type="button" onClick={() => { setShowBackdate(true); setActivationDate(today); }} className="block text-[13px] font-body-medium text-primary hover:underline">Backdate activation</button>
        ))}
        {showBackdate && (
          <button type="button" onClick={() => { setShowBackdate(false); setActivationDate(''); }} className="-mt-2 block text-[13px] text-text-secondary hover:underline">Don't backdate</button>
        )}

        {showNotes ? (
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything to remember for this member…"
              className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
            />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowNotes(true)} className="block text-[13px] font-body-medium text-primary hover:underline">+ Add note</button>
        )}
      </FormBody>
    </PanelShell>
  );
};

export default EnrollMemberPanel;
