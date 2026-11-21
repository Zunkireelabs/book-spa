import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanelShell, FormBody, Field, SelectField, TextInput, MoneyInput, SwitchRow, InlineError, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { useOrg } from '../../../../contexts/OrgContext';
import { createVoucherType, updateVoucherType } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';
import { useIndustry } from '../../../../hooks/useIndustry';
import { wordBranch } from '../../../../utils/industryTerms';

const CATEGORIES = [
  { value: 'spa', label: 'Spa' },
  { value: 'salon', label: 'Salon' },
  { value: 'body_scrub', label: 'Body scrub' },
  { value: 'package', label: 'Package' },
];
const segBtn = (on) => `h-9 rounded-md text-[13px] font-medium transition-colors ${on ? 'bg-white text-text-primary shadow-[0_1px_2px_rgba(14,13,12,.08)] border border-border' : 'text-[#515152] hover:text-text-primary'}`;
const Seg = ({ value, onChange, options, label }) => (
  <div className="grid gap-0.5 p-0.5 bg-background border border-border rounded-lg" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="group" aria-label={label}>
    {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={segBtn(value === v)} data-seg-value={v}>{l}</button>)}
  </div>
);

// Admin create / edit of one voucher type (V23, Voucher types tab): name, code prefix, kind (money / service value or a % off
// coupon), worth or %, what member discount it counts as, usually sold or given free, and On sale (when editing). Changes apply
// to vouchers handed out from now on.
const VoucherTypePanel = ({ type = null, types = [], onClose, onSaved }) => {
  const { examples } = useIndustry();
  const { orgId } = useOrg();
  const editing = !!type;
  const initial = useMemo(() => ({
    name: type?.name || '',
    prefix: type?.code_prefix || '',
    kind: type?.percent_off != null ? 'coupon' : 'value',
    worth: type && type.percent_off == null ? String(Number(type.standard_price)) : '',
    pct: type?.percent_off != null ? String(Number(type.percent_off)) : '',
    category: type?.category || 'spa',
    usually: type?.default_issue_kind || 'sold',
    active: type ? !!type.is_active : true,
  }), [type]);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, []);

  const set = (k) => (val) => { setForm((f) => ({ ...f, [k]: val })); setErrors((e) => ({ ...e, [k]: undefined })); setServerError(null); };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const coupon = form.kind === 'coupon';
  const others = types.filter((t) => t.id !== type?.id);
  const validate = () => {
    const e = {};
    const name = form.name.trim();
    if (!name) e.name = 'Enter a name.';
    else if (others.some((t) => t.name.toLowerCase() === name.toLowerCase())) e.name = `A type called "${name}" already exists.`;
    if (!form.prefix.trim()) e.prefix = 'Enter the code prefix, e.g. NT 4326.';
    if (coupon && !(Number(form.pct) >= 1 && Number(form.pct) <= 100)) e.pct = 'Enter a % between 1 and 100.';
    if (!coupon && !(Number(form.worth) > 0)) e.worth = 'Enter what the voucher is worth.';
    return e;
  };
  const reason = !form.name.trim() ? 'Enter a name' : !form.prefix.trim() ? 'Enter the code prefix' : coupon ? (!(Number(form.pct) > 0) ? 'Enter the % off' : '') : !(Number(form.worth) > 0) ? 'Enter what it is worth' : '';

  const submit = async () => {
    const e = validate();
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`vt-${first}`)?.focus({ preventScroll: true }); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(), codePrefix: form.prefix.trim(), standardPrice: coupon ? 0 : Number(form.worth), category: form.category,
      percentOff: coupon ? Number(form.pct) : null, defaultIssueKind: form.usually,
    };
    const res = editing
      ? await updateVoucherType({ id: type.id, ...payload, isActive: form.active })
      : await createVoucherType({ orgId, ...payload, displayOrder: types.length + 1 });
    setSaving(false);
    if (res.error) { setServerError(friendlyError(res.error, editing ? 'Could not save the voucher type.' : 'Could not create the voucher type.')); return; }
    onSaved(res.data, !editing);
  };

  return (
    <PanelShell variant="panel" title={editing ? 'Edit voucher type' : 'New voucher type'} onClose={onClose} dirty={dirty} busy={saving} reason={reason}
      primary={{ label: saving ? 'Saving…' : editing ? 'Save' : 'Create type', onClick: submit, disabled: !!reason, loading: saving }}>
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Name" required id="vt-name" error={errors.name}>
          <TextInput ref={nameRef} value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder={`e.g. ${examples.voucher}`} error={errors.name} {...controlA11y('vt-name', errors.name)} />
        </Field>
        <Field label="Code prefix" required id="vt-prefix" error={errors.prefix} hint={`Codes look like ${form.prefix.trim().toUpperCase() || 'NT 4326'}-0001. Booklet codes are typed in full when handing one out.`}>
          <TextInput value={form.prefix} onChange={(e) => set('prefix')(e.target.value.toUpperCase().slice(0, 24))} placeholder="NT 4326" className="font-data" error={errors.prefix} {...controlA11y('vt-prefix', errors.prefix)} />
        </Field>
        <Field label="Kind">
          <Seg label="Kind" value={form.kind} onChange={set('kind')} options={[['value', 'Money or service value'], ['coupon', '% off coupon']]} />
          <p className="mt-1.5 text-xs text-text-secondary">{coupon ? 'A coupon takes a % off one visit. It holds no money.' : `Holds a value the guest can use over several visits, at any ${wordBranch()}.`}</p>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {coupon ? (
            <Field label="% off" required id="vt-pct" error={errors.pct}>
              <div className="relative">
                <TextInput inputMode="numeric" value={form.pct} onChange={(e) => set('pct')(e.target.value.replace(/\D/g, '').slice(0, 3))} className="pr-8 tabular-nums" error={errors.pct} {...controlA11y('vt-pct', errors.pct)} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-text-tertiary pointer-events-none">%</span>
              </div>
            </Field>
          ) : (
            <Field label="Worth" required id="vt-worth" error={errors.worth}>
              <MoneyInput id="vt-worth" value={form.worth} onChange={set('worth')} error={errors.worth} />
            </Field>
          )}
          <Field label="Counts as" hint="Which member discount applies when a member buys it.">
            <SelectField value={form.category} onChange={set('category')} options={CATEGORIES} />
          </Field>
        </div>
        <Field label="Usually">
          <Seg label="Usually" value={form.usually} onChange={set('usually')} options={[['sold', 'Sold'], ['free', 'Given free']]} />
          <p className="mt-1.5 text-xs text-text-secondary">Only sets the default on the voucher form; any voucher can still be sold or given free.</p>
        </Field>
        {editing && (
          <SwitchRow id="vt-active" label="On sale" description="Off stops new vouchers of this type. Vouchers already out can still be used until they expire." checked={form.active} onChange={set('active')} />
        )}
      </FormBody>
    </PanelShell>
  );
};

export default VoucherTypePanel;
