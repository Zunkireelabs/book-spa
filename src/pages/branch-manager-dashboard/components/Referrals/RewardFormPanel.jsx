import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanelShell, FormBody, Field, TextInput, MoneyInput, InlineError, controlA11y } from '../../../../components/ui/PanelFormKit';
import { createRewardCatalogItem, updateRewardCatalogItem } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

// "New gift voucher" / "Edit gift voucher" in the right-hand panel. Callbacks: onClose(), onSaved(id, isNew).
const RewardFormPanel = ({ item, onClose, onSaved }) => {
  const editing = !!item;
  const original = useMemo(() => ({ name: item?.name || '', value: item?.value != null ? String(item.value) : '' }), [item]);
  const [form, setForm] = useState(original);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const changed = form.name !== original.name || form.value !== original.value;
  const reason = editing && !changed ? 'No changes' : !form.name.trim() ? 'Enter the name' : '';

  const submit = async () => {
    if (savingRef.current || reason) return;
    if (!form.name.trim()) { setErrors({ name: 'Name is required.' }); document.getElementById('rwd-name')?.focus({ preventScroll: true }); return; }
    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    const result = editing
      ? await updateRewardCatalogItem({ id: item.id, name: form.name.trim(), value: form.value })
      : await createRewardCatalogItem({ rewardType: 'voucher', name: form.name.trim(), value: form.value });
    savingRef.current = false;
    setSaving(false);
    if (result.error) { setServerError(friendlyError(result.error, 'Could not save the gift voucher.')); return; }
    onSaved(editing ? item.id : result.data?.id, !editing);
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('rwd-name')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  return (
    <PanelShell
      variant="panel" title={editing ? 'Edit gift voucher' : 'New gift voucher'} onClose={onClose} dirty={changed} busy={saving} reason={reason}
      primary={{ label: saving ? 'Saving…' : (editing ? 'Save changes' : 'Create gift voucher'), onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Name" required id="rwd-name" error={errors.name}>
          <TextInput {...controlA11y('rwd-name', errors.name)} error={!!errors.name} value={form.name} onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setErrors({}); setServerError(null); }} placeholder="e.g. Free Facial Voucher" />
        </Field>
        <Field label="Value" id="rwd-value" hint="Optional. Shown to staff when they pick this reward.">
          <MoneyInput id="rwd-value" value={form.value} onChange={(v) => { setForm((f) => ({ ...f, value: v })); setServerError(null); }} placeholder="500" />
        </Field>
      </FormBody>
    </PanelShell>
  );
};

export default RewardFormPanel;
