import React, { useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { PanelShell, FormBody, Field, TextInput, SwitchRow, InlineError, InfoRows } from '../../../../components/ui/PanelFormKit';
import { createSupplier, updateSupplier, deleteSupplier } from '../../../../services/api';
import { npr } from '../../../../services/productsView';
import { friendlyError } from '../../../../utils/friendlyError';

// New / edit supplier (V25). A supplier that products or receives point to is switched off instead of deleted.
const SupplierPanel = ({ supplier = null, suppliers, canManage, onClose, onSaved, onDeleted, width }) => {
  const editing = !!supplier;
  const initial = useMemo(() => ({
    name: supplier?.name || '', contactName: supplier?.contactName || '', phone: supplier?.phone || '', email: supplier?.email || '', notes: supplier?.notes || '', isActive: supplier ? supplier.isActive : true,
  }), [supplier]);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef(null);
  useEffect(() => { const t = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 260); return () => clearTimeout(t); }, []);
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); setServerError(null); };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const used = !!supplier && (supplier.products > 0 || !!supplier.lastReceived);
  const others = suppliers.filter((s) => s.id !== supplier?.id);

  const reason = !canManage ? '' : !form.name.trim() ? 'Enter the supplier name' : editing && !dirty ? 'No changes' : '';
  const save = async () => {
    if (reason || saving) return;
    const name = form.name.trim();
    if (others.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())) { setErrors({ name: `A supplier called "${name}" already exists.` }); return; }
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) { setErrors({ email: 'Check the email address.' }); return; }
    setSaving(true); setServerError(null);
    const res = editing ? await updateSupplier({ id: supplier.id, ...form }) : await createSupplier(form);
    setSaving(false);
    if (res.error) { setServerError(friendlyError(res.error, 'Could not save the supplier.')); return; }
    onSaved(res.data, !editing);
  };
  const doDelete = async () => {
    setSaving(true);
    const { error } = await deleteSupplier({ id: supplier.id });
    setSaving(false); setConfirmDelete(false);
    if (error) { setServerError(friendlyError(error, 'Could not delete the supplier.')); return; }
    onDeleted(supplier);
  };

  return (
    <PanelShell width={width} variant="panel" title={editing ? 'Supplier' : 'New supplier'} onClose={onClose} dirty={dirty} busy={saving} reason={reason}
      hideFooter={!canManage}
      footerLeft={editing && canManage && !used ? <button type="button" onClick={() => setConfirmDelete(true)} className="h-9 px-2 text-[13px] text-error hover:underline">Delete</button> : null}
      primary={{ label: saving ? 'Saving…' : (editing ? 'Save changes' : 'Add supplier'), onClick: save, disabled: !!reason, loading: saving }}>
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Name" required id="sp-name" error={errors.name}>
          <TextInput ref={nameRef} id="sp-name" error={errors.name} value={form.name} disabled={!canManage} onChange={(e) => set('name')(e.target.value)} placeholder="e.g. Himalayan Herbals" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Contact person" id="sp-contact"><TextInput id="sp-contact" value={form.contactName} disabled={!canManage} onChange={(e) => set('contactName')(e.target.value)} /></Field>
          <Field label="Phone" id="sp-phone"><TextInput id="sp-phone" type="tel" value={form.phone} disabled={!canManage} onChange={(e) => set('phone')(e.target.value)} /></Field>
        </div>
        <Field label="Email" id="sp-email" error={errors.email}><TextInput id="sp-email" error={errors.email} value={form.email} disabled={!canManage} onChange={(e) => set('email')(e.target.value)} /></Field>
        <Field label="Notes" id="sp-notes">
          <textarea id="sp-notes" rows={3} value={form.notes} disabled={!canManage} onChange={(e) => set('notes')(e.target.value)} placeholder="Delivery days, order desk number…"
            className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y" />
        </Field>
        {editing && canManage && <SwitchRow id="sp-active" label="Active" description="Switch off to stop offering them when receiving stock. Their history stays." checked={form.isActive} onChange={set('isActive')} />}
        {editing && <InfoRows rows={[['Products', String(supplier.products)], supplier.value ? ['Stock here, at cost', npr(supplier.value)] : null]} />}
      </FormBody>
      {confirmDelete && (
        <ConfirmDialog title="Delete supplier?" message={`"${supplier.name}" will be permanently deleted.`} confirmLabel="Delete" requireReason={false} isSubmitting={saving}
          onConfirm={doDelete} onClose={() => !saving && setConfirmDelete(false)} />
      )}
    </PanelShell>
  );
};

export default SupplierPanel;
