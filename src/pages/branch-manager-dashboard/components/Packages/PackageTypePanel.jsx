import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanelShell, FormBody, Field, SelectField, TextInput, MoneyInput, SwitchRow, InlineError, InfoRows, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { useOrg } from '../../../../contexts/OrgContext';
import ServicePickRow from '../../../../components/ui/ServicePickRow';
import { useBranch } from '../../../../contexts/BranchContext';
import { createPackageType, updatePackageType, fetchServicesForManagement } from '../../../../services/api';
import { perSession, validityLabel } from '../../../../services/packagesView';
import { friendlyError } from '../../../../utils/friendlyError';
import { npr } from './packageBits';

const intOnly = (v) => String(v).replace(/\D/g, '').slice(0, 4);
const str = (v) => (v == null ? '' : String(v));

// Admin create / edit of a package type (V20, Package types tab). Empty sessions = open (set when selling), empty price = set at
// sale. Packages already sold copy their sessions, price and expiry at sale, so editing a type never changes them.
const PackageTypePanel = ({ type = null, onClose, onSaved }) => {
  const { branchId: curBranch, isOverall } = useBranch();
  const pickerBranchId = isOverall ? null : curBranch;
  const { orgId } = useOrg();
  const editing = !!type;
  const initial = useMemo(() => ({
    name: type?.name || '',
    serviceId: type?.service_id || '',
    sessions: str(type?.default_sessions),
    price: str(type?.standard_price != null ? Number(type.standard_price) : ''),
    days: type ? str(type.validity_days) : '365',
    active: type ? !!type.is_active : true,
  }), [type]);
  const [form, setForm] = useState(initial);
  const [services, setServices] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    let off = false;
    fetchServicesForManagement().then(({ data, error }) => {
      if (off) return;
      if (error) { setServerError(friendlyError(error, 'Failed to load services.')); setServices([]); return; }
      // Keep the type's current service in the list even if it has since been switched off.
      setServices((data || []).filter((s) => s.is_active || s.id === type?.service_id));
    });
    const t = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 260);
    return () => { off = true; clearTimeout(t); };
  }, [type?.service_id]);

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); setServerError(null); };
  const dirty = Object.keys(initial).some((k) => form[k] !== initial[k]);
  const service = (services || []).find((s) => s.id === form.serviceId) || null;
  const preview = perSession({ standard_price: form.price === '' ? null : Number(form.price), default_sessions: form.sessions === '' ? null : Number(form.sessions), service: service ? { price_npr: service.price_npr } : null });

  const reason = !form.name.trim() ? 'Enter a name' : !form.serviceId ? 'Pick a service' : !(Number(form.days) > 0) ? 'Enter how many days it is valid' : '';

  const submit = async () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Enter a name.';
    if (!form.serviceId) errs.serviceId = 'Pick a service.';
    if (form.sessions !== '' && !(Number(form.sessions) > 0)) errs.sessions = 'Enter at least 1, or leave it empty.';
    if (!(Number(form.days) > 0)) errs.days = 'Enter at least 1 day.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    const fields = { name: form.name, serviceId: form.serviceId, defaultSessions: form.sessions, standardPrice: form.price, validityDays: form.days };
    const res = editing
      ? await updatePackageType({ id: type.id, ...fields, isActive: form.active })
      : await createPackageType({ orgId, ...fields });
    setSaving(false);
    if (res.error) { setServerError(friendlyError(res.error, editing ? 'Could not save the package type.' : 'Could not create the package type.')); return; }
    onSaved(res.data, !editing);
  };

  return (
    <PanelShell
      variant="panel"
      title={editing ? 'Edit package type' : 'New package type'}
      onClose={onClose}
      dirty={dirty}
      busy={saving}
      reason={reason}
      primary={{ label: saving ? 'Saving…' : editing ? 'Save' : 'Create package type', onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Name" required id="pt-name" error={errors.name}>
          <TextInput ref={nameRef} id="pt-name" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="e.g. Swedish · 6 sessions" error={errors.name} {...controlA11y('pt-name', errors.name)} />
        </Field>
        <Field label="Service" required id="pt-service" error={errors.serviceId}>
          <ServicePickRow services={services || []} value={form.serviceId} onChange={set('serviceId')} branchId={pickerBranchId} loading={services === null} title="Service for the package" ariaLabel="Service" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Sessions" id="pt-sessions" error={errors.sessions} hint="Leave empty to set it when selling.">
            <TextInput id="pt-sessions" inputMode="numeric" value={form.sessions} onChange={(e) => set('sessions')(intOnly(e.target.value))} placeholder="Open" error={errors.sessions} {...controlA11y('pt-sessions', errors.sessions)} />
          </Field>
          <Field label="Price" id="pt-price" hint="Leave empty to set it at sale.">
            <MoneyInput id="pt-price" value={form.price} onChange={set('price')} placeholder="Set at sale" />
          </Field>
        </div>
        <Field label="Valid for (days)" required id="pt-days" error={errors.days} hint={Number(form.days) > 0 ? `From the day it is sold: ${validityLabel(Number(form.days))}.` : undefined}>
          <TextInput id="pt-days" inputMode="numeric" value={form.days} onChange={(e) => set('days')(intOnly(e.target.value))} error={errors.days} {...controlA11y('pt-days', errors.days)} />
        </Field>
        {preview.per != null && (
          <InfoRows rows={[
            ['Per session', npr(preview.per), 'total'],
            preview.single != null ? ['Single visit', npr(preview.single)] : null,
            preview.saves != null ? ['Guest saves', `${preview.saves}%`] : null,
          ]} />
        )}
        {editing && (
          <SwitchRow id="pt-active" label="On sale" description="Off hides it from Sell package. Guests who already bought it keep their sessions." checked={form.active} onChange={set('active')} />
        )}
      </FormBody>
    </PanelShell>
  );
};

export default PackageTypePanel;
