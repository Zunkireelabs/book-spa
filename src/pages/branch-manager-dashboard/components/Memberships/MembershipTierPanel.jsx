import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import {
  PanelShell, FormBody, Field, SelectField, TextInput, MoneyInput, SwitchRow, InlineError, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { useOrg } from '../../../../contexts/OrgContext';
import { createMembershipTier, updateMembershipTier } from '../../../../services/api';
import { CATEGORY_LABELS } from '../../../../services/membershipsView';
import { validityLabel } from '../../../../services/packagesView';
import { friendlyError } from '../../../../utils/friendlyError';

const digitsOnly = (v, max = 6) => String(v).replace(/\D/g, '').slice(0, max);
const rulesToRows = (rules) => Object.entries(rules || {}).filter(([, v]) => Number(v) > 0).map(([category, v]) => ({ category, pct: String(v) }))
  .sort((a, b) => Number(b.pct) - Number(a.pct));

// Admin create / edit of one membership tier (V21, Tiers tab): name, card prefix (set once, at creation), what members pay up front,
// validity, the member discounts (category + % rows) and, when editing, On sale. Replaces the old "Manage tiers" panel.
const MembershipTierPanel = ({ tier = null, tiers = [], onClose, onSaved }) => {
  const { orgId } = useOrg();
  const editing = !!tier;
  const initial = useMemo(() => ({
    name: tier?.name || '',
    prefix: tier?.code_prefix || '',
    advance: tier ? String(Number(tier.advance_amount)) : '',
    days: tier ? String(tier.validity_days) : '365',
    rules: rulesToRows(tier?.discount_rules),
    active: tier ? !!tier.is_active : true,
  }), [tier]);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, []);

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); setServerError(null); };
  const setRule = (i, patch) => setForm((f) => ({ ...f, rules: f.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const usedCats = form.rules.map((r) => r.category);
  const freeCats = Object.keys(CATEGORY_LABELS).filter((c) => !usedCats.includes(c));
  const addRule = () => freeCats.length && setForm((f) => ({ ...f, rules: [...f.rules, { category: freeCats[0], pct: '' }] }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const others = tiers.filter((t) => t.id !== tier?.id);
  const validate = () => {
    const e = {};
    const name = form.name.trim();
    if (!name) e.name = 'Enter a name.';
    else if (others.some((t) => t.name.toLowerCase() === name.toLowerCase())) e.name = `A tier called "${name}" already exists.`;
    if (!editing) {
      const p = form.prefix.trim().toUpperCase();
      if (!p) e.prefix = 'Enter a card prefix (e.g. PCM).';
      else if (!/^[A-Z]{2,5}$/.test(p)) e.prefix = 'Use 2–5 letters, no digits or symbols.';
      else if (others.some((t) => (t.code_prefix || '').toUpperCase() === p)) e.prefix = `Prefix "${p}" is already used by another tier.`;
    }
    if (!(Number(form.advance) > 0)) e.advance = 'Enter what members pay up front.';
    if (!(Number(form.days) >= 1)) e.days = 'Enter at least 1 day.';
    if (form.rules.some((r) => !(Number(r.pct) > 0 && Number(r.pct) <= 100))) e.rules = 'Each discount needs a % between 1 and 100 (or remove the row).';
    return e;
  };
  const reason = !form.name.trim() ? 'Enter a name' : !editing && !form.prefix.trim() ? 'Enter a card prefix' : !(Number(form.advance) > 0) ? 'Enter what members pay up front' : '';

  const submit = async () => {
    const e = validate();
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`tier-${first}`)?.focus({ preventScroll: true }); return; }
    setSaving(true);
    const discountRules = Object.fromEntries(form.rules.map((r) => [r.category, Number(r.pct)]));
    const res = editing
      ? await updateMembershipTier({ id: tier.id, name: form.name.trim(), advanceAmount: Number(form.advance), validityDays: Number(form.days), discountRules, isActive: form.active })
      : await createMembershipTier({ orgId, name: form.name.trim(), codePrefix: form.prefix.trim().toUpperCase(), advanceAmount: Number(form.advance), validityDays: Number(form.days), displayOrder: tiers.length + 1, discountRules });
    setSaving(false);
    if (res.error) { setServerError(friendlyError(res.error, editing ? 'Could not save the tier.' : 'Could not create the tier.')); return; }
    onSaved(res.data, !editing);
  };

  return (
    <PanelShell
      variant="panel"
      title={editing ? 'Edit tier' : 'New tier'}
      onClose={onClose}
      dirty={dirty}
      busy={saving}
      reason={reason}
      primary={{ label: saving ? 'Saving…' : editing ? 'Save' : 'Create tier', onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Name" required id="tier-name" error={errors.name}>
          <TextInput ref={nameRef} value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="e.g. Premium Club" error={errors.name} {...controlA11y('tier-name', errors.name)} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {editing ? (
            <Field label="Card numbers" id="tier-prefix" hint="The prefix is set when the tier is created.">
              <p className="h-10 px-3 flex items-center rounded-spa border border-border bg-background text-[13px] font-data text-text-secondary">{tier.code_prefix || '—'}-0001…</p>
            </Field>
          ) : (
            <Field label="Card prefix" required id="tier-prefix" error={errors.prefix} hint="2–5 letters, e.g. PCM. Card numbers start with it.">
              <TextInput value={form.prefix} onChange={(e) => set('prefix')(e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 5).toUpperCase())} placeholder="PCM" error={errors.prefix} {...controlA11y('tier-prefix', errors.prefix)} />
            </Field>
          )}
          <Field label="Valid for (days)" required id="tier-days" error={errors.days} hint={Number(form.days) > 0 ? validityLabel(Number(form.days)) : undefined}>
            <TextInput inputMode="numeric" value={form.days} onChange={(e) => set('days')(digitsOnly(e.target.value, 4))} error={errors.days} {...controlA11y('tier-days', errors.days)} />
          </Field>
        </div>
        <Field label="Pays up front" required id="tier-advance" error={errors.advance} hint="The joining deposit. It goes into the member's wallet.">
          <MoneyInput id="tier-advance" value={form.advance} onChange={set('advance')} error={errors.advance} />
        </Field>

        <div>
          <p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">Member discounts</p>
          {form.rules.length === 0 && <p className="text-xs text-text-secondary mb-2">No discounts yet. Members still get a birthday gift each year.</p>}
          <div className="space-y-2" data-rule-rows>
            {form.rules.map((r, i) => (
              <div key={r.category} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SelectField value={r.category} onChange={(v) => setRule(i, { category: v })}
                    options={[r.category, ...freeCats].map((c) => ({ value: c, label: CATEGORY_LABELS[c] || c }))} />
                </div>
                <div className="relative w-24">
                  <TextInput inputMode="numeric" aria-label={`${CATEGORY_LABELS[r.category] || r.category} discount %`} value={r.pct} onChange={(e) => { setRule(i, { pct: digitsOnly(e.target.value, 3) }); setErrors((x) => ({ ...x, rules: undefined })); }} className="pr-7 text-right tabular-nums" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-text-tertiary pointer-events-none">%</span>
                </div>
                <button type="button" aria-label={`Remove ${CATEGORY_LABELS[r.category] || r.category} discount`} onClick={() => setForm((f) => ({ ...f, rules: f.rules.filter((_, j) => j !== i) }))}
                  className="w-9 h-9 grid place-items-center rounded-spa text-text-tertiary hover:bg-black/[0.05] hover:text-text-primary"><Icon name="X" size={15} /></button>
              </div>
            ))}
          </div>
          {errors.rules && <p role="alert" className="mt-1.5 text-xs text-error">{errors.rules}</p>}
          {freeCats.length > 0 && (
            <button type="button" onClick={addRule} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"><Icon name="Plus" size={14} />Add a discount</button>
          )}
          <p className="mt-2 text-xs text-text-secondary">Filled in when you sell a voucher to a member of this tier.</p>
        </div>

        {editing && (
          <SwitchRow id="tier-active" label="On sale" description="Off stops new enrolments. Current members keep their wallet and discounts." checked={form.active} onChange={set('active')} />
        )}
      </FormBody>
    </PanelShell>
  );
};

export default MembershipTierPanel;
