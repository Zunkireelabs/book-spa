import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CountryCodeSelect, { parsePhone } from '../../../../components/ui/CountryCodeSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
import {
  PanelShell, FormBody, Field, SelectField, TextInput, MoneyInput, DateField, InfoRows, InlineError,
  CONTROL, CONTROL_ERROR, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import ServicePickRow from '../../../../components/ui/ServicePickRow';
import { useBranch } from '../../../../contexts/BranchContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { fetchPackageTypes, createPackageType, fetchServicesForManagement, issuePackage } from '../../../../services/api';
import { toDateInputValue } from '../../../../utils/date';
import { friendlyError } from '../../../../utils/friendlyError';
import { wordBranch } from '../../../../utils/industryTerms';

const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const SPLIT = 'grid grid-cols-1 sm:grid-cols-2 gap-3';
const EMPTY_NEW_TYPE = { name: '', serviceId: '', defaultSessions: '', standardPrice: '', validityDays: '365' };
const plusDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + n); return toDateInputValue(d); };
const plusYear = (ymd) => { const d = new Date(`${ymd}T00:00:00`); d.setFullYear(d.getFullYear() + 1); return toDateInputValue(d); };
const longDate = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const EXPIRY_CHIPS = [
  { label: '+30', next: (from) => plusDays(from, 30) },
  { label: '+90', next: (from) => plusDays(from, 90) },
  { label: '+180', next: (from) => plusDays(from, 180) },
  { label: '+1 year', next: plusYear },
];
const intOnly = (v) => String(v).replace(/\D/g, '').slice(0, 4);

// "New package": the right-hand panel (same shell, fields and footer as New voucher). Issues via issue_package() (migration-141).
// There is no manual code (package_code stays NULL) and no tender rows: the package records paid_amount as one number.
// Callbacks are unchanged: onClose(), onIssued(issuedPackage).
// Optional prefill (Packages page): `initialCustomer` ({ id?, full_name, phone }) for Renew, `initialPackageTypeId` for Renew / Sell.
const NewPackagePanel = ({ userRole, onClose, onIssued, initialCustomer = null, initialPackageTypeId = null }) => {
  const { branchId, branchName, isOverall } = useBranch();
  const pickerBranchId = isOverall ? null : branchId;
  const { profile } = useAuth();
  const { orgId, paymentMethods } = useOrg();
  const isAdmin = (userRole || profile?.role) === 'admin';
  const today = toDateInputValue(new Date());

  const [types, setTypes] = useState(null); // null while loading
  const [loadError, setLoadError] = useState(null);
  const [services, setServices] = useState([]);
  const [showNewType, setShowNewType] = useState(false);
  const [newType, setNewType] = useState(EMPTY_NEW_TYPE);
  const [newTypeErrors, setNewTypeErrors] = useState({});
  const [newTypeSubmitting, setNewTypeSubmitting] = useState(false);

  const [packageTypeId, setPackageTypeId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [linkedCustomer, setLinkedCustomer] = useState(null);
  const [guestCountryCode, setGuestCountryCode] = useState('+977');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestOtherInfo, setGuestOtherInfo] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [sessionsTotal, setSessionsTotal] = useState('');
  const [dueHolderName, setDueHolderName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [issuedDate, setIssuedDate] = useState(today);
  const [expiryDate, setExpiryDate] = useState('');
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [showRemarks, setShowRemarks] = useState(false);
  const phoneFromPick = useRef(false);

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);
  const guestRef = useRef(null);

  const clearError = (key) => { setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e)); setServerError(null); };

  // ── Data ───────────────────────────────────────────────────────────────────────────────────────
  // Fills sessions / paid / expiry from the type's defaults. Expiry only auto-fills while the user hasn't edited it.
  const applyType = (type, fromIssuedDate, { keepExpiryTouched = expiryTouched } = {}) => {
    if (!type) return;
    setPackageTypeId(type.id);
    setSessionsTotal(type.default_sessions != null ? String(type.default_sessions) : '');
    setPaidAmount(type.standard_price != null ? String(type.standard_price) : '');
    setDueHolderName('');
    if (!keepExpiryTouched) {
      const base = fromIssuedDate ? new Date(fromIssuedDate) : new Date();
      base.setDate(base.getDate() + (type.validity_days || 365));
      setExpiryDate(toDateInputValue(base));
    }
  };

  const loadTypes = async ({ selectId } = {}) => {
    const { data, error } = await fetchPackageTypes();
    if (error) { setLoadError(friendlyError(error, 'Failed to load package types.')); setTypes([]); return; }
    setTypes(data || []);
    const pick = (selectId && data?.find((t) => t.id === selectId)) || data?.[0];
    if (pick) applyType(pick, issuedDate, { keepExpiryTouched: selectId ? false : expiryTouched });
  };
  useEffect(() => {
    loadTypes(initialPackageTypeId ? { selectId: initialPackageTypeId } : undefined);
    if (initialCustomer?.full_name) onGuestSelect(initialCustomer);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    (async () => {
      const { data } = await fetchServicesForManagement();
      if (!cancelled) setServices((data || []).filter((s) => s.is_active));
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    if (issued) return undefined;
    const t = setTimeout(() => guestRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, [issued, isOverall]);

  // ── Derived ────────────────────────────────────────────────────────────────────────────────────
  const selectedType = (types || []).find((t) => t.id === packageTypeId) || null;
  const paidAmountNum = Number(paidAmount) || 0;
  const sessionsTotalNum = Number(sessionsTotal) || 0;
  // The type's price is already the discounted bulk rate: what is owed is simply that price; paying less becomes a due balance.
  const baseAmount = selectedType?.standard_price != null ? Number(selectedType.standard_price) : null;
  const dueAmountNum = baseAmount == null ? 0 : Math.max(0, round2(baseAmount - paidAmountNum));
  const fixedSessions = selectedType?.default_sessions != null;
  const tierName = linkedCustomer?.primaryMembership?.tierName || '';
  const tierStatus = linkedCustomer?.primaryMembership?.status || '';

  const dirty = !!(guestName || guestPhone || guestOtherInfo || remarks || dueHolderName || expiryTouched || issuedDate !== today
    || (selectedType && (paidAmount !== (selectedType.standard_price != null ? String(selectedType.standard_price) : '')
      || (!fixedSessions && sessionsTotal))));

  const reason = types === null ? 'Loading package types…'
    : !packageTypeId ? 'Pick a package type'
    : !guestName.trim() ? 'Enter the guest name'
    : !(sessionsTotalNum > 0) ? 'Enter the sessions'
    : dueAmountNum > 0 && !dueHolderName.trim() ? 'Name who settles the due'
    : '';

  // ── Handlers ───────────────────────────────────────────────────────────────────────────────────
  const handleTypeChange = (id) => { applyType((types || []).find((x) => x.id === id), issuedDate); clearError('type'); clearError('paid'); clearError('due'); };

  const handleIssuedDateChange = (value) => {
    setIssuedDate(value);
    clearError('issued');
    if (!expiryTouched && selectedType) {
      const base = new Date(value);
      base.setDate(base.getDate() + (selectedType.validity_days || 365));
      setExpiryDate(toDateInputValue(base));
    }
  };

  // Editing the guest name drops the link and the phone filled from the pick.
  const onGuestNameChange = (val) => {
    setGuestName(val);
    clearError('guest');
    if (linkedCustomer) {
      setLinkedCustomer(null);
      if (phoneFromPick.current) setGuestPhone('');
      phoneFromPick.current = false;
    }
  };
  const onGuestSelect = (customer) => {
    setGuestName(customer.full_name);
    setLinkedCustomer(customer);
    clearError('guest');
    if (customer.phone) {
      const { dial, national } = parsePhone(customer.phone);
      setGuestCountryCode(dial);
      setGuestPhone(national);
      phoneFromPick.current = true;
    }
  };

  const handleCreateNewType = async () => {
    const errs = {};
    if (!newType.name.trim()) errs.name = 'Enter the type name.';
    if (!newType.serviceId) errs.serviceId = 'Pick a service.';
    const sessions = Number(newType.defaultSessions);
    if (!Number.isFinite(sessions) || sessions <= 0) errs.defaultSessions = 'Enter the number of sessions.';
    if (newType.standardPrice === '' || !(Number(newType.standardPrice) >= 0)) errs.standardPrice = 'Enter the price.';
    if (!(Number(newType.validityDays) >= 1)) errs.validityDays = 'Enter the validity in days.';
    setNewTypeErrors(errs);
    if (Object.keys(errs).length) return;
    setNewTypeSubmitting(true);
    const { data, error } = await createPackageType({
      orgId, name: newType.name, serviceId: newType.serviceId, defaultSessions: sessions,
      standardPrice: Number(newType.standardPrice), validityDays: newType.validityDays,
    });
    setNewTypeSubmitting(false);
    if (error) { setNewTypeErrors({ form: friendlyError(error, 'Failed to create package type.') }); return; }
    setNewType(EMPTY_NEW_TYPE);
    setNewTypeErrors({});
    setShowNewType(false);
    setExpiryTouched(false);
    await loadTypes({ selectId: data.id });
  };

  const submit = async () => {
    if (submittingRef.current || reason || isOverall) return;
    const next = {};
    const phoneDigits = digitsOf(guestPhone);
    if (phoneDigits && (phoneDigits.length < 7 || phoneDigits.length > 15)) next.phone = 'Enter a valid phone number (7–15 digits).';
    if (baseAmount != null && paidAmountNum > baseAmount) next.paid = `Paid can't be more than the price (${formatNPR(baseAmount)}).`;
    if (issuedDate > today) next.issued = "The issued date can't be in the future.";
    if (!issuedDate || !expiryDate || expiryDate < issuedDate) next.expiry = 'Expiry date cannot be before the issued date.';
    setErrors(next);
    const first = ['phone', 'paid', 'issued', 'expiry'].find((k) => next[k]);
    if (first) {
      const el = document.getElementById(`pkg-${first}`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setServerError(null);
    // Guest Info is one column: a phone number takes priority (same convention as the voucher).
    const { data, error } = await issuePackage({
      orgId,
      branchId,
      packageTypeId,
      customerId: linkedCustomer?.id || null,
      guestName: guestName.trim() || null,
      guestInfo: phoneDigits ? `${guestCountryCode}${phoneDigits}` : (guestOtherInfo.trim() || null),
      issuedDate,
      expiryDate,
      paidAmount: paidAmountNum,
      sessionsTotal: sessionsTotalNum,
      remarks: remarks.trim() || null,
      dueHolderName: dueAmountNum > 0 ? dueHolderName.trim() : null,
      paymentMethod: paidAmountNum > 0 ? paymentMethod : null,
    });
    submittingRef.current = false;
    setSubmitting(false);
    if (error) { setServerError(friendlyError(error, 'Failed to issue package.')); return; }
    setIssued(data);
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !issued) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [issued]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(issued.package_code); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // "Issue another": reset everything except the package type (and re-apply its defaults).
  const issueAnother = () => {
    const t = selectedType;
    setIssued(null);
    setGuestName(''); setLinkedCustomer(null); setGuestPhone(''); setGuestOtherInfo(''); setGuestCountryCode('+977');
    setRemarks(''); setShowRemarks(false); setIssuedDate(today); setExpiryTouched(false); setPaymentMethod('Cash');
    setErrors({}); setServerError(null); phoneFromPick.current = false;
    applyType(t, today, { keepExpiryTouched: false });
  };

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────
  const typeOptions = (types || []).map((t) => ({
    value: t.id,
    label: `${t.name} — ${t.service?.name || 'service'}${t.default_sessions ? ` (${t.default_sessions} sessions)` : ''}${t.standard_price != null ? ` — ${formatNPR(t.standard_price)}` : ''}`,
  }));
  const priceRows = useMemo(() => {
    // A fixed session count is a value of the type, so it is read here rather than shown as a disabled input.
    const rows = [];
    if (fixedSessions) rows.push(['Sessions', String(selectedType.default_sessions)]);
    rows.push(['Price', baseAmount != null ? formatNPR(baseAmount) : 'Set at sale']);
    if (dueAmountNum > 0) { rows.push(['Paid', formatNPR(paidAmountNum)]); rows.push(['Due', formatNPR(dueAmountNum), 'total']); }
    return rows;
  }, [baseAmount, dueAmountNum, paidAmountNum, fixedSessions, selectedType]);

  if (issued) {
    const due = dueAmountNum; // still reflects the form that was just submitted
    return (
      <PanelShell
        variant="panel"
        title="New package"
        onClose={() => onIssued(issued)}
        footerOverride={(
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={issueAnother} className="h-9 px-3 text-[13px] font-body font-body-medium text-text-secondary hover:text-text-primary hover:bg-black/[0.04] rounded-spa spa-transition-fast whitespace-nowrap">Issue another</button>
            <button type="button" onClick={() => onIssued(issued)} className="h-9 px-4 text-[13px] font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 transition-colors whitespace-nowrap">Done</button>
          </div>
        )}
      >
        <div className="px-5 py-10 text-center" role="status" aria-live="polite">
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
            <Icon name="Check" size={24} className="text-success" />
          </div>
          <h4 className="font-heading font-heading-semibold text-[15px] text-text-primary">Package issued</h4>
          {issued.package_code ? (
            <>
              <p className="mt-3 font-data font-data-medium text-2xl text-primary tracking-wide break-all">{issued.package_code}</p>
              <button type="button" onClick={copyCode} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-body-medium text-primary hover:underline">
                <Icon name={copied ? 'Check' : 'Copy'} size={13} />{copied ? 'Copied' : 'Copy'}
              </button>
            </>
          ) : (
            <p className="mt-3 font-data font-data-medium text-2xl text-primary tabular-nums">{issued.sessions_total} session{issued.sessions_total !== 1 ? 's' : ''}</p>
          )}
          <p className="mt-4 text-[13px] text-text-secondary tabular-nums">
            {issued.package_code ? `${issued.sessions_total} session${issued.sessions_total !== 1 ? 's' : ''} · ` : ''}{guestName.trim() || 'Linked customer'} · {formatNPR(issued.paid_amount)} paid · expires {longDate(expiryDate)}
          </p>
          {due > 0 && <p className="mt-1 text-[13px] text-warning tabular-nums">{formatNPR(due)} due · {dueHolderName.trim()}</p>}
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      variant="panel"
      title="New package"
      onClose={onClose}
      dirty={dirty}
      busy={submitting}
      reason={reason}
      primary={isOverall ? undefined : {
        label: submitting ? 'Issuing…' : (paidAmountNum > 0 ? `Issue · ${formatNPR(paidAmountNum)}` : 'Issue package'),
        onClick: submit,
        disabled: !!reason,
        loading: submitting,
      }}
    >
      {isOverall ? (
        <FormBody>
          <div className="py-10 text-center">
            <Icon name="Layers" size={28} className="text-text-tertiary mx-auto mb-3" />
            <p className="text-[13px] text-text-secondary">Packages are issued from one {wordBranch()}. Switch {wordBranch()} in the header to continue.</p>
          </div>
        </FormBody>
      ) : (
        <FormBody>
          <p className="-mt-1 text-xs text-text-secondary">{branchName}{profile?.full_name ? ` · issued by ${profile.full_name}` : ''}</p>
          <InlineError message={serverError || loadError} />

          <Field
            label="Guest name"
            labelExtra={linkedCustomer && tierName ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-body text-text-secondary whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />{tierName} member{tierStatus && tierStatus !== 'active' ? ` · ${tierStatus}` : ''}</span>
            ) : null}
            required
            id="pkg-guest"
            error={errors.guest}
          >
            <CustomerAutocomplete
              id="pkg-guest"
              value={guestName}
              onChange={onGuestNameChange}
              onSelect={onGuestSelect}
              branchId={branchId}
              inputRef={guestRef}
              searchBy="name"
              placeholder="Full name"
              inputClassName={CONTROL}
            />
          </Field>

          <Field label="Phone" id="pkg-phone" error={errors.phone}>
            <div className="flex">
              <CountryCodeSelect value={guestCountryCode} onChange={setGuestCountryCode} />
              <input
                {...controlA11y('pkg-phone', errors.phone)}
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
            id="pkg-company"
            hint={digitsOf(guestPhone) && guestOtherInfo.trim() ? 'Only the phone is saved when both are given.' : undefined}
          >
            <TextInput id="pkg-company" value={guestOtherInfo} onChange={(e) => setGuestOtherInfo(e.target.value)} placeholder="Optional" />
          </Field>

          <Field label="Package type" required id="pkg-type" error={errors.type}>
            <SelectField
              value={packageTypeId}
              onChange={handleTypeChange}
              options={typeOptions}
              placeholder={types === null ? 'Loading…' : 'Select package type'}
              disabled={types === null || (types || []).length === 0}
            />
            {selectedType?.service && (
              <p className="mt-1.5 text-xs text-text-secondary">
                Redeemable against {selectedType.service.name}{selectedType.service.duration_minutes ? ` (${selectedType.service.duration_minutes} min)` : ''} only.
              </p>
            )}
            {isAdmin && !showNewType && (
              <button type="button" onClick={() => setShowNewType(true)} className="mt-1.5 text-[13px] font-body-medium text-primary hover:underline">+ New type</button>
            )}
          </Field>

          {isAdmin && showNewType && (
            <div className="border border-border rounded-spa p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-heading font-heading-semibold text-[13px] text-text-primary">New package type</h4>
                <button type="button" aria-label="Close new type" onClick={() => { setShowNewType(false); setNewType(EMPTY_NEW_TYPE); setNewTypeErrors({}); }} className="p-1 rounded-spa hover:bg-black/[0.05] text-text-secondary">
                  <Icon name="X" size={14} />
                </button>
              </div>
              <InlineError message={newTypeErrors.form} />
              <Field label="Name" required id="pkg-nt-name" error={newTypeErrors.name}>
                <TextInput {...controlA11y('pkg-nt-name', newTypeErrors.name)} error={newTypeErrors.name} placeholder="e.g. Annual Package - 60 min" value={newType.name} onChange={(e) => { setNewType((p) => ({ ...p, name: e.target.value })); setNewTypeErrors((x) => ({ ...x, name: undefined })); }} />
              </Field>
              <Field label="Service" required id="pkg-nt-service" error={newTypeErrors.serviceId}>
                <ServicePickRow required services={services} value={newType.serviceId} onChange={(v) => { setNewType((p) => ({ ...p, serviceId: v })); setNewTypeErrors((x) => ({ ...x, serviceId: undefined })); }} branchId={pickerBranchId} title="Service for the package" ariaLabel="Service" />
              </Field>
              <div className={SPLIT}>
                <Field label="Sessions" required id="pkg-nt-sessions" error={newTypeErrors.defaultSessions}>
                  <TextInput {...controlA11y('pkg-nt-sessions', newTypeErrors.defaultSessions)} error={newTypeErrors.defaultSessions} inputMode="numeric" value={newType.defaultSessions} onChange={(e) => { setNewType((p) => ({ ...p, defaultSessions: intOnly(e.target.value) })); setNewTypeErrors((x) => ({ ...x, defaultSessions: undefined })); }} />
                </Field>
                <Field label="Price" required id="pkg-nt-price" error={newTypeErrors.standardPrice}>
                  <MoneyInput {...controlA11y('pkg-nt-price', newTypeErrors.standardPrice)} error={newTypeErrors.standardPrice} value={newType.standardPrice} onChange={(v) => { setNewType((p) => ({ ...p, standardPrice: v })); setNewTypeErrors((x) => ({ ...x, standardPrice: undefined })); }} />
                </Field>
              </div>
              <Field label="Validity (days)" required id="pkg-nt-validity" error={newTypeErrors.validityDays}>
                <TextInput {...controlA11y('pkg-nt-validity', newTypeErrors.validityDays)} error={newTypeErrors.validityDays} inputMode="numeric" value={newType.validityDays} onChange={(e) => { setNewType((p) => ({ ...p, validityDays: intOnly(e.target.value) })); setNewTypeErrors((x) => ({ ...x, validityDays: undefined })); }} />
              </Field>
              <div className="flex justify-end">
                <button type="button" onClick={handleCreateNewType} disabled={newTypeSubmitting} className="h-9 px-3 text-[13px] font-body font-body-medium bg-text-primary text-white rounded-spa hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2">
                  {newTypeSubmitting && <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />}
                  Add type
                </button>
              </div>
            </div>
          )}

          {selectedType && !fixedSessions && (
            <Field
              label="Sessions"
              required
              id="pkg-sessions"
              error={errors.sessions}
              hint={selectedType && !fixedSessions ? 'This package type has no fixed session count — enter it manually.' : undefined}
            >
              <input
                {...controlA11y('pkg-sessions', errors.sessions)}
                type="text"
                inputMode="numeric"
                value={sessionsTotal}
                onChange={(e) => { setSessionsTotal(intOnly(e.target.value)); clearError('sessions'); }}
                  className={`${CONTROL} tabular-nums`}
              />
            </Field>
          )}

          <div className={SPLIT}>
            <Field label="Paid amount" id="pkg-paid" error={errors.paid}>
              <MoneyInput {...controlA11y('pkg-paid', errors.paid)} error={errors.paid} value={paidAmount} onChange={(v) => { setPaidAmount(v); clearError('paid'); }} />
            </Field>
            {paidAmountNum > 0 && (
              <Field label="Payment method">
                <PaymentMethodSelector paymentMethods={paymentMethods} value={paymentMethod} onChange={setPaymentMethod} />
              </Field>
            )}
          </div>

          <InfoRows rows={priceRows} />

          {dueAmountNum > 0 && (
            <Field label="Responsible person" required id="pkg-due" error={errors.due} hint={`Who settles the remaining ${formatNPR(dueAmountNum)}`}>
              <TextInput {...controlA11y('pkg-due', errors.due)} error={errors.due} value={dueHolderName} onChange={(e) => { setDueHolderName(e.target.value); clearError('due'); }} placeholder="Full name" />
            </Field>
          )}

          <div className={SPLIT}>
            <DateField label="Issued" id="pkg-issued" value={issuedDate} max={today} error={errors.issued} onChange={handleIssuedDateChange} />
            <DateField label="Expires" id="pkg-expiry" value={expiryDate} min={issuedDate} error={errors.expiry} onChange={(d) => { setExpiryDate(d); setExpiryTouched(true); clearError('expiry'); }} />
          </div>
          <div className="-mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {EXPIRY_CHIPS.map((c) => (
              <button key={c.label} type="button" onClick={() => { setExpiryDate(c.next(issuedDate)); setExpiryTouched(true); clearError('expiry'); }} className="text-xs font-body-medium text-primary hover:underline tabular-nums">{c.label}</button>
            ))}
          </div>

          {showRemarks ? (
            <Field label="Remarks">
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} placeholder="Anything to remember for this package…" className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y" />
            </Field>
          ) : (
            <button type="button" onClick={() => setShowRemarks(true)} className="block text-[13px] font-body-medium text-primary hover:underline">+ Add remarks</button>
          )}
        </FormBody>
      )}
    </PanelShell>
  );
};

export default NewPackagePanel;
