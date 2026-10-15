import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { PanelShell, FormBody, Field, TextInput, InlineError, controlA11y, CONTROL, CONTROL_ERROR } from '../../../../components/ui/PanelFormKit';
import { updateOrgPaymentMethods } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

// A method entry is either a plain string (leaf) or { name, subMethods } (a group).
const entryName = (m) => (typeof m === 'string' ? m : m.name);
const entrySubMethods = (m) => (typeof m === 'string' ? [] : m.subMethods || []);
const MAX = 40;

// "New payment method" / "Edit payment method" in the right-hand panel. The sub-options are an inline row editor: rename in place,
// remove with ×, add at the bottom. Everything is a draft until the primary saves it (so no per-row confirm).
// Callbacks: onClose(), onSaved(name, isNew).
const PaymentMethodFormPanel = ({ methods, index, onClose, onSaved }) => {
  const editing = index != null;
  const original = useMemo(() => ({
    name: editing ? entryName(methods[index]) : '',
    subs: editing ? entrySubMethods(methods[index]) : [],
  }), [editing, methods, index]);
  const [name, setName] = useState(original.name);
  const [subs, setSubs] = useState(original.subs);
  const [subInput, setSubInput] = useState('');
  const [errors, setErrors] = useState({});
  const [subErrors, setSubErrors] = useState({}); // row index -> message
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const changed = name !== original.name || JSON.stringify(subs) !== JSON.stringify(original.subs) || !!subInput.trim();
  const reason = editing && !changed ? 'No changes' : !name.trim() ? 'Enter the method name' : '';

  const clearSub = (i) => setSubErrors((e) => (e[i] ? { ...e, [i]: undefined } : e));
  const addSub = () => {
    const t = subInput.trim();
    if (!t) return true;
    if (t.length > MAX) { setErrors((e) => ({ ...e, newSub: `Sub-option name must be ${MAX} characters or fewer.` })); return false; }
    if (subs.some((s) => s.toLowerCase() === t.toLowerCase())) { setErrors((e) => ({ ...e, newSub: 'That sub-option is already added.' })); return false; }
    setSubs((p) => [...p, t]);
    setSubInput('');
    setErrors((e) => ({ ...e, newSub: undefined }));
    return true;
  };

  const submit = async () => {
    if (savingRef.current || reason) return;
    const trimmed = name.trim();
    const e = {};
    if (trimmed.length > MAX) e.name = `Payment method name must be ${MAX} characters or fewer.`;
    else if (methods.some((m, i) => entryName(m).toLowerCase() === trimmed.toLowerCase() && i !== index)) e.name = 'A payment method with this name already exists.';
    // fold a typed-but-not-added sub-option in, like pressing Add
    let finalSubs = subs;
    const pending = subInput.trim();
    if (pending) {
      if (pending.length > MAX) e.newSub = `Sub-option name must be ${MAX} characters or fewer.`;
      else if (subs.some((s) => s.toLowerCase() === pending.toLowerCase())) e.newSub = 'That sub-option is already added.';
      else finalSubs = [...subs, pending];
    }
    const se = {};
    const seen = new Set();
    finalSubs.forEach((s, i) => {
      const t = s.trim();
      if (!t) se[i] = 'Enter a name or remove this row.';
      else if (t.length > MAX) se[i] = `Keep it to ${MAX} characters or fewer.`;
      else if (seen.has(t.toLowerCase())) se[i] = 'That sub-option already exists.';
      seen.add(t.toLowerCase());
    });
    setErrors(e);
    setSubErrors(se);
    if (e.name) { document.getElementById('pm-name')?.focus({ preventScroll: true }); return; }
    const firstBad = Object.keys(se)[0];
    if (firstBad != null) { document.getElementById(`pm-sub-${firstBad}`)?.focus({ preventScroll: true }); return; }
    if (e.newSub) { document.getElementById('pm-newsub')?.focus({ preventScroll: true }); return; }

    const cleanSubs = finalSubs.map((s) => s.trim());
    const nextEntry = cleanSubs.length > 0 ? { name: trimmed, subMethods: cleanSubs } : trimmed;
    const next = [...methods];
    if (editing) next[index] = nextEntry; else next.push(nextEntry);
    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    const result = await updateOrgPaymentMethods(next);
    savingRef.current = false;
    setSaving(false);
    if (result.error) { setServerError(friendlyError(result.error, 'Could not save the payment method.')); return; }
    onSaved(trimmed, !editing);
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('pm-name')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  return (
    <PanelShell
      variant="panel" title={editing ? 'Edit payment method' : 'New payment method'} onClose={onClose} dirty={changed} busy={saving} reason={reason}
      primary={{ label: saving ? 'Saving…' : (editing ? 'Save changes' : 'Create payment method'), onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Method name" required id="pm-name" error={errors.name}>
          <TextInput {...controlA11y('pm-name', errors.name)} error={!!errors.name} maxLength={MAX} value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); setServerError(null); }} placeholder="e.g. Bank Transfer" />
        </Field>

        <div>
          <p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">Sub-options <span className="font-body text-text-secondary">(optional)</span></p>
          <p className="mb-2 text-xs text-text-secondary">
            e.g. Mastercard under Card. Once you add sub-options, only they (not the generic "{name.trim() || 'method'}") are offered when recording a payment.
          </p>
          {subs.length > 0 && (
            <ul className="mb-2 border border-border rounded-spa divide-y divide-border">
              {subs.map((s, i) => (
                <li key={i} className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      id={`pm-sub-${i}`} type="text" aria-label={`Sub-option ${i + 1}`} maxLength={MAX} value={s}
                      aria-invalid={subErrors[i] ? true : undefined}
                      onChange={(e) => { const v = e.target.value; setSubs((p) => p.map((x, j) => (j === i ? v : x))); clearSub(i); }}
                      className={`${CONTROL} h-9 ${subErrors[i] ? CONTROL_ERROR : ''}`}
                    />
                    <button type="button" aria-label={`Remove ${s || 'sub-option'}`} onClick={() => { setSubs((p) => p.filter((_, j) => j !== i)); setSubErrors({}); }} className="w-8 h-8 flex items-center justify-center rounded-spa text-text-secondary hover:bg-error/10 hover:text-error flex-shrink-0">
                      <Icon name="X" size={14} />
                    </button>
                  </div>
                  {subErrors[i] && <p role="alert" className="mt-1 text-xs text-error">{subErrors[i]}</p>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              id="pm-newsub" type="text" aria-label="New sub-option" maxLength={MAX} value={subInput} placeholder="e.g. Mastercard"
              aria-invalid={errors.newSub ? true : undefined}
              onChange={(e) => { setSubInput(e.target.value); setErrors((x) => ({ ...x, newSub: undefined })); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); addSub(); } }}
              className={`${CONTROL} ${errors.newSub ? CONTROL_ERROR : ''}`}
            />
            <button type="button" onClick={addSub} disabled={!subInput.trim()} className="h-10 px-3 text-[13px] font-body font-body-medium bg-text-primary text-white rounded-spa hover:opacity-90 disabled:opacity-50 whitespace-nowrap">Add</button>
          </div>
          {errors.newSub && <p role="alert" className="mt-1.5 text-xs text-error">{errors.newSub}</p>}
        </div>
      </FormBody>
    </PanelShell>
  );
};

export default PaymentMethodFormPanel;
