import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanelShell, FormBody, Field, TextInput, SwitchRow, InlineError, controlA11y } from '../../../../components/ui/PanelFormKit';
import { createCategory, updateCategory } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

// "New category" / "Edit category" in the right-hand panel. Callbacks: onClose(), onSaved(id, isNew).
const CategoryFormPanel = ({ category, onClose, onSaved }) => {
  const editing = !!category;
  const original = useMemo(() => ({
    name: category?.name || '',
    description: category?.description || '',
    offerEnabled: !!category?.offer_enabled,
    offerPercent: category?.offer_percent != null ? String(category.offer_percent) : '',
  }), [category]);
  const [form, setForm] = useState(original);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setServerError(null); };
  const clear = (k) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  const changed = form.name !== original.name || form.description !== original.description || form.offerEnabled !== original.offerEnabled
    || (form.offerEnabled && form.offerPercent !== original.offerPercent);
  const reason = editing && !changed ? 'No changes' : !form.name.trim() ? 'Enter the category name' : (form.offerEnabled && !form.offerPercent ? 'Enter the offer percentage' : '');

  const submit = async () => {
    if (savingRef.current || reason) return;
    const e = {};
    if (!form.name.trim()) e.name = 'Category name is required.';
    let pct = null;
    if (form.offerEnabled) {
      pct = Number(form.offerPercent);
      if (!pct || pct <= 0 || pct >= 100) e.offer = 'Offer percentage must be between 1 and 99.';
    }
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`cat-${first === 'offer' ? 'offer' : first}`)?.focus({ preventScroll: true }); return; }
    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    const payload = { name: form.name.trim(), description: form.description.trim() || null, offerEnabled: form.offerEnabled, offerPercent: form.offerEnabled ? pct : null };
    const result = editing ? await updateCategory({ categoryId: category.id, ...payload }) : await createCategory(payload);
    savingRef.current = false;
    setSaving(false);
    if (result.error) { setServerError(friendlyError(result.error, 'Could not save the category.')); return; }
    onSaved(editing ? category.id : result.data?.id, !editing);
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('cat-name')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  return (
    <PanelShell
      variant="panel" title={editing ? 'Edit category' : 'New category'} onClose={onClose} dirty={changed} busy={saving} reason={reason}
      primary={{ label: saving ? 'Saving…' : (editing ? 'Save changes' : 'Create category'), onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Category name" required id="cat-name" error={errors.name} hint={editing ? 'Renaming a category updates all services using it.' : undefined}>
          <TextInput {...controlA11y('cat-name', errors.name)} error={!!errors.name} value={form.name} onChange={(e) => { set({ name: e.target.value }); clear('name'); }} placeholder="e.g. Spa, Salon, Wellness" />
        </Field>
        <Field label="Description" id="cat-description">
          <textarea
            id="cat-description" value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} placeholder="Optional"
            className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          />
        </Field>
        <SwitchRow
          id="cat-offer-switch" label="Offer" checked={form.offerEnabled} onChange={(v) => { set({ offerEnabled: v }); clear('offer'); }}
          description="A percentage off every service in this category."
        />
        {form.offerEnabled && (
          <Field label="Offer percentage" required id="cat-offer" error={errors.offer} hint="Applies to every service in this category unless that service has its own offer (which always takes priority).">
            <TextInput {...controlA11y('cat-offer', errors.offer)} error={!!errors.offer} inputMode="numeric" value={form.offerPercent} onChange={(e) => { set({ offerPercent: e.target.value.replace(/[^\d.]/g, '') }); clear('offer'); }} placeholder="e.g. 30" />
          </Field>
        )}
      </FormBody>
    </PanelShell>
  );
};

export default CategoryFormPanel;
