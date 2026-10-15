import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import {
  PanelShell, FormBody, Field, TextInput, MoneyInput, InlineError, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { fetchMembershipTiers, createMembershipTier, updateMembershipTier } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
const headerBtn = 'h-8 px-2.5 text-[13px] font-body font-body-medium rounded-spa spa-transition-fast whitespace-nowrap';

const WholeNumberInput = React.forwardRef(({ value, onChange, error, ...props }, ref) => (
  <TextInput ref={ref} inputMode="numeric" value={value} error={error} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} {...props} />
));

// ── Add form (stacked sub-view) ───────────────────────────────────────────────────────────────────────────────────────────
const TierForm = ({ tiers, orgId, onBack, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [advance, setAdvance] = useState('');
  const [days, setDays] = useState('365');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const submitRef = useRef(null);

  const initial = useRef(JSON.stringify([name, prefix, advance, days])).current;
  const dirty = JSON.stringify([name, prefix, advance, days]) !== initial;

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = 'Tier name is required.';
    else if (tiers.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) e.name = `A tier called "${name.trim()}" already exists.`;
    {
      if (!prefix.trim()) e.prefix = 'Code prefix is required (e.g. PCM, DCM, GLD).';
      else if (!/^[A-Za-z]{2,5}$/.test(prefix)) e.prefix = 'Use 2–5 letters, no digits or symbols.';
      else if (tiers.some((t) => (t.code_prefix || '').toUpperCase() === prefix.trim().toUpperCase())) e.prefix = `Prefix "${prefix.trim().toUpperCase()}" is already used by another tier.`;
    }
    if (!(Number(advance) > 0)) e.advance = 'Advance amount must be greater than zero.';
    if (!(Number(days) >= 1)) e.days = 'Validity must be at least 1 day.';
    return e;
  };

  const onSubmit = async () => {
    if (busyRef.current) return;
    const e = validate();
    setErrors(e);
    setServerError(null);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`tier-${first}`)?.focus({ preventScroll: true }); return; }
    busyRef.current = true;
    setBusy(true);
    const { error } = await createMembershipTier({ orgId, name: name.trim(), codePrefix: prefix.trim().toUpperCase(), advanceAmount: Number(advance), validityDays: Number(days), displayOrder: tiers.length + 1 });
    busyRef.current = false;
    setBusy(false);
    if (error) { setServerError(friendlyError(error, 'Failed to create the tier.')); return; }
    onSaved(`Added ${name.trim()}.`);
  };
  submitRef.current = onSubmit;

  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('tier-name')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  const label = 'Add tier';
  return (
    <PanelShell
      variant="panel" title="New tier" onBack={onBack} onClose={onClose} dirty={dirty} busy={busy}
      primary={{ label: busy ? 'Saving…' : label, onClick: onSubmit, disabled: false, loading: busy }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Tier name" required id="tier-name" error={errors.name}>
          <TextInput {...controlA11y('tier-name', errors.name)} error={!!errors.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gold Club" />
        </Field>
        <Field label="Code prefix" required id="tier-prefix" error={errors.prefix} hint="2–5 letters, used on card numbers. Permanent once created.">
          <TextInput
            {...controlA11y('tier-prefix', errors.prefix)} error={!!errors.prefix} value={prefix} maxLength={5} placeholder="e.g. GLD"
            onChange={(e) => setPrefix(e.target.value.toUpperCase())} className="font-data tracking-wide"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Advance amount" required id="tier-advance" error={errors.advance}>
            <MoneyInput {...controlA11y('tier-advance', errors.advance)} error={!!errors.advance} value={advance} onChange={setAdvance} placeholder="75000" />
          </Field>
          <Field label="Validity (days)" required id="tier-days" error={errors.days}>
            <WholeNumberInput {...controlA11y('tier-days', errors.days)} error={!!errors.days} value={days} onChange={setDays} />
          </Field>
        </div>
      </FormBody>
    </PanelShell>
  );
};

// ── Tier list ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const MembershipTiersPanel = ({ orgId, onClose, onChanged }) => {
  const [tiers, setTiers] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ kind: 'list' }); // list | form {tier?}
  const [notice, setNotice] = useState('');
  const [toggling, setToggling] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await fetchMembershipTiers(orgId, { includeInactive: true });
    if (e) { setError(friendlyError(e, 'Failed to load tiers.')); return; }
    setTiers(data || []);
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (tier) => {
    if (toggling) return;
    setToggling(tier.id);
    setNotice('');
    const { error: e } = await updateMembershipTier({ id: tier.id, isActive: !tier.is_active });
    setToggling(null);
    if (e) { setError(friendlyError(e, 'Failed to update the tier.')); return; }
    await load();
    onChanged?.();
  };

  if (view.kind === 'form' && tiers) {
    return (
      <TierForm
        tiers={tiers} orgId={orgId} onBack={() => setView({ kind: 'list' })} onClose={onClose}
        onSaved={(msg) => { setView({ kind: 'list' }); setNotice(msg); load(); onChanged?.(); }}
      />
    );
  }

  return (
    <PanelShell
      variant="panel" title="Membership tiers" onClose={onClose} hideFooter
      headerExtra={<button type="button" onClick={() => { setNotice(''); setView({ kind: 'form' }); }} className={`${headerBtn} bg-primary text-white hover:bg-primary/90`}>New tier</button>}
    >
      <FormBody>
        {notice && (
          <p role="status" className="flex items-start gap-2 border border-success/30 bg-success/5 rounded-spa px-3 py-2 text-[13px] text-success">
            <Icon name="CheckCircle2" size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span>
          </p>
        )}
        {error && (
          <div role="alert" className="flex items-center gap-2 border border-error/30 bg-error/5 rounded-spa px-3 py-2">
            <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
            <p className="flex-1 text-[13px] text-error">{error}</p>
            <button type="button" onClick={load} className="text-[13px] font-body-medium text-error underline">Retry</button>
          </div>
        )}
        {tiers === null && !error && (
          <div className="space-y-2" aria-busy="true" aria-label="Loading tiers">
            {[0, 1].map((i) => <div key={i} className="h-16 rounded-spa border border-border bg-background animate-pulse" />)}
          </div>
        )}
        {tiers && tiers.length === 0 && <p className="py-6 text-center text-[13px] text-text-secondary">No tiers yet. Add the first one.</p>}
        {tiers && tiers.length > 0 && (
          <ul className="border border-border rounded-spa divide-y divide-border">
            {tiers.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-body-medium truncate ${t.is_active ? 'text-text-primary' : 'text-text-tertiary'}`}>{t.name} <span className="font-data text-xs text-text-secondary tracking-wide">· {t.code_prefix}</span></p>
                  <p className="text-xs text-text-secondary">{formatNPR(t.advance_amount)} advance · {t.validity_days} days</p>
                </div>
                <button
                  type="button" role="switch" aria-checked={!!t.is_active} aria-label={`${t.name} active`} disabled={toggling === t.id} onClick={() => toggle(t)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60 ${t.is_active ? 'bg-primary' : 'bg-border'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${t.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-text-secondary">Inactive tiers are hidden from enrollment and the marketing page; existing members keep their cards. A tier's code prefix is permanent.</p>
      </FormBody>
    </PanelShell>
  );
};

export default MembershipTiersPanel;
