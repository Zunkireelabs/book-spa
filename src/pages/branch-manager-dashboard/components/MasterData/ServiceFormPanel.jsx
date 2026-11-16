import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanelShell, FormBody, Field, TextInput, MoneyInput, SelectField, SwitchRow, Segmented, InfoRows, InlineError, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import {
  createService, updateServicePricing, uploadServiceImage, fetchServiceTherapists, setServiceTherapists,
} from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';
import ImageDropzone from '../Products/ImageDropzone';

const formatNPR = (amount) => `NPR ${Math.round(Number(amount) || 0).toLocaleString('en-IN')}`;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// "New service" / "Edit service" in the right-hand panel. Callbacks: onClose(), onSaved(id, isNew); onPartial() refreshes the list when
// the service saved but its eligible-staff list did not (the panel then stays open, now targeting the saved service so a retry never
// creates a duplicate).
const ServiceFormPanel = ({ service, categories, allTherapists, branchId, isBeauty, onClose, onSaved, onPartial }) => {
  const [target, setTarget] = useState(service || null); // set after a create whose staff write failed
  const editing = !!target;
  const original = useMemo(() => ({
    name: service?.name || '',
    category: service?.category || categories[0]?.name || 'Spa',
    priceNpr: service ? String(service.price_npr) : '',
    durationMinutes: service ? String(service.duration_minutes) : '',
    description: service?.description || '',
    isCouple: !!service?.is_couple,
    offerEnabled: !!service?.offer_enabled,
    offerType: service?.offer_type || 'percent',
    offerValue: service?.offer_value != null ? String(service.offer_value) : '',
  }), [service, categories]);

  const [form, setForm] = useState(original);
  const [restrictStaff, setRestrictStaff] = useState(false);
  const [eligibleIds, setEligibleIds] = useState([]);
  const [origStaff, setOrigStaff] = useState({ restrict: false, ids: [] });
  const [staffLoaded, setStaffLoaded] = useState(!service);
  const [staffQuery, setStaffQuery] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(service?.image_url || null);
  const [imageUrl, setImageUrl] = useState(service?.image_url || '');
  const [imageError, setImageError] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Load the current allow-list (per branch) before the form can be saved, so a save never writes another service's staff.
  useEffect(() => {
    if (!service) return undefined;
    let cancelled = false;
    fetchServiceTherapists(service.id, branchId).then(({ data }) => {
      if (cancelled) return;
      const ids = data || [];
      setEligibleIds(ids);
      setRestrictStaff(ids.length > 0);
      setOrigStaff({ restrict: ids.length > 0, ids });
      setStaffLoaded(true);
    });
    return () => { cancelled = true; };
  }, [service, branchId]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setServerError(null); };
  const clear = (k) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  const price = Number(form.priceNpr) || 0;
  const offerNum = Number(form.offerValue) || 0;
  const imageChanged = !!imageFile || (service ? (service.image_url || '') !== imageUrl : false);
  const staffChanged = restrictStaff !== origStaff.restrict || (restrictStaff && !sameSet(eligibleIds, origStaff.ids));
  const formChanged = Object.keys(original).some((k) => (k.startsWith('offer') && !form.offerEnabled && k !== 'offerEnabled' ? false : form[k] !== original[k]));
  const changed = service
    ? (formChanged || imageChanged || staffChanged)
    : !!(form.name || form.priceNpr || form.durationMinutes || form.description || form.offerEnabled || form.isCouple || imageFile || restrictStaff);
  const retrying = !!target && !service; // created already; only the staff write is outstanding

  const reason = !staffLoaded ? 'Loading eligible staff…'
    : service && !changed && !retrying ? 'No changes'
    : !form.name.trim() ? 'Enter the service name' : !(price > 0) ? 'Enter the price' : !(Number(form.durationMinutes) > 0) ? 'Enter the duration' : '';

  const category = categories.find((c) => c.name === form.category);
  const offerPrice = form.offerEnabled && offerNum > 0
    ? (form.offerType === 'percent' ? price * (1 - offerNum / 100) : offerNum) : null;
  const offerProblem = form.offerEnabled && offerNum > 0 && ((form.offerType === 'percent' && offerNum >= 100) || (form.offerType === 'fixed' && price > 0 && offerNum >= price));

  const submit = async () => {
    if (savingRef.current || reason) return;
    const duration = Number(form.durationMinutes);
    const e = {};
    if (!form.name.trim()) e.name = 'Service name is required.';
    if (!price || price <= 0) e.price = 'Price must be a positive number.';
    if (!duration || duration <= 0 || !Number.isInteger(duration)) e.duration = 'Duration must be a positive whole number.';
    if (form.offerEnabled) {
      if (!offerNum || offerNum <= 0) e.offer = 'Offer value must be a positive number.';
      else if (form.offerType === 'percent' && offerNum >= 100) e.offer = 'Offer percentage must be less than 100.';
      else if (form.offerType === 'fixed' && offerNum >= price) e.offer = 'Fixed offer price must be less than the regular price.';
    }
    setErrors(e);
    const first = ['name', 'price', 'duration', 'offer'].find((k) => e[k]);
    if (first) { document.getElementById(`svc-${first}`)?.focus({ preventScroll: true }); return; }

    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    let finalImageUrl = imageUrl.trim() || null;
    if (imageFile) {
      const up = await uploadServiceImage(imageFile);
      if (up.error) {
        savingRef.current = false;
        setSaving(false);
        setImageError(friendlyError(up.error, 'Could not upload the image.'));
        document.getElementById('svc-image')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      finalImageUrl = up.url;
    }
    const payload = {
      name: form.name.trim(), priceNpr: price, durationMinutes: duration, description: form.description.trim() || null, imageUrl: finalImageUrl,
      category: form.category, isCouple: form.isCouple, offerEnabled: form.offerEnabled,
      offerType: form.offerEnabled ? form.offerType : null, offerValue: form.offerEnabled ? offerNum : null,
    };
    const result = editing ? await updateServicePricing({ serviceId: target.id, ...payload }) : await createService(payload);
    if (result.error) {
      savingRef.current = false;
      setSaving(false);
      setServerError(friendlyError(result.error, 'Could not save the service.'));
      return;
    }
    const serviceId = editing ? target.id : result.data?.id;
    if (!serviceId) {
      savingRef.current = false;
      setSaving(false);
      setServerError('Service saved, but its id was not returned, so eligible staff could not be saved. Reopen it from the list to set eligible staff.');
      onPartial?.();
      return;
    }
    const staff = await setServiceTherapists(serviceId, restrictStaff ? eligibleIds : [], branchId);
    savingRef.current = false;
    setSaving(false);
    if (staff.error) {
      // The service itself saved; only the allow-list failed. Keep the panel open, now aimed at the saved row.
      setServerError(friendlyError(staff.error, 'Failed to save eligible staff.'));
      if (!editing) setTarget(result.data);
      onPartial?.();
      return;
    }
    onSaved(serviceId, !editing);
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('svc-name')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  const filteredTherapists = staffQuery ? allTherapists.filter((t) => t.name.toLowerCase().includes(staffQuery.toLowerCase())) : allTherapists;

  return (
    <PanelShell
      variant="panel" title={service ? 'Edit service' : 'New service'} onClose={onClose} dirty={changed} busy={saving} reason={reason}
      primary={{ label: saving ? 'Saving…' : (service || retrying ? 'Save changes' : 'Create service'), onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Service name" required id="svc-name" error={errors.name}>
          <TextInput {...controlA11y('svc-name', errors.name)} error={!!errors.name} value={form.name} onChange={(e) => { set({ name: e.target.value }); clear('name'); }} placeholder="e.g. Deep Tissue Massage" />
        </Field>
        <Field label="Category">
          <SelectField value={form.category} onChange={(v) => set({ category: v })} options={categories.map((c) => ({ value: c.name, label: c.name }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price" required id="svc-price" error={errors.price}>
            <MoneyInput {...controlA11y('svc-price', errors.price)} error={!!errors.price} value={form.priceNpr} onChange={(v) => { set({ priceNpr: v }); clear('price'); }} placeholder="2000" />
          </Field>
          <Field label="Duration (min)" required id="svc-duration" error={errors.duration}>
            <TextInput {...controlA11y('svc-duration', errors.duration)} error={!!errors.duration} inputMode="numeric" value={form.durationMinutes} onChange={(e) => { set({ durationMinutes: e.target.value.replace(/\D/g, '') }); clear('duration'); }} placeholder="60" />
          </Field>
        </div>

        <SwitchRow id="svc-offer-switch" label="Offer" checked={form.offerEnabled} onChange={(v) => { set({ offerEnabled: v }); clear('offer'); }} description="A discounted price for this service." />
        {form.offerEnabled && (
          <>
            <Segmented options={[['percent', 'Percentage off'], ['fixed', 'Flat price']]} value={form.offerType} onChange={(v) => { set({ offerType: v }); clear('offer'); }} />
            <Field label={form.offerType === 'percent' ? 'Percentage off' : 'Flat price'} required id="svc-offer" error={errors.offer}>
              <TextInput {...controlA11y('svc-offer', errors.offer)} error={!!errors.offer} inputMode="decimal" value={form.offerValue} onChange={(e) => { set({ offerValue: e.target.value.replace(/[^\d.]/g, '') }); clear('offer'); }} placeholder={form.offerType === 'percent' ? 'e.g. 30' : 'e.g. 4500'} />
            </Field>
          </>
        )}
        {price > 0 && (form.offerEnabled ? offerPrice != null && !offerProblem : !!category?.offer_enabled) && (
          <InfoRows rows={form.offerEnabled
            ? [['Regular price', formatNPR(price)], ['Customers pay', formatNPR(offerPrice), 'total']]
            : [['Regular price', formatNPR(price)], [`Inherits the ${category.name} offer (${category.offer_percent}% off)`, formatNPR(price * (1 - Number(category.offer_percent) / 100)), 'total']]}
          />
        )}

        {!isBeauty && (
          <SwitchRow
            id="svc-couple-switch" label="Couple service" checked={form.isCouple} onChange={(v) => set({ isCouple: v })}
            description="Priced for two. Shows the companion room/name/phone option when 2 team members are assigned, and is left out of the calendar's group-booking service pickers."
          />
        )}

        <Field label="Description" id="svc-description">
          <textarea
            id="svc-description" value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} placeholder="Optional"
            className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          />
        </Field>

        <SwitchRow
          id="svc-restrict-switch" label="Restrict to specific staff" checked={restrictStaff} disabled={!staffLoaded}
          onChange={(v) => { setRestrictStaff(v); if (!v) { setEligibleIds([]); setStaffQuery(''); } }}
          description="Only the staff you pick can be booked for this service."
        />
        {restrictStaff && (
          <div className="space-y-2">
            <TextInput value={staffQuery} onChange={(e) => setStaffQuery(e.target.value)} placeholder="Search staff…" aria-label="Search staff" />
            <div className="border border-border rounded-spa max-h-40 overflow-y-auto p-1">
              {allTherapists.length === 0 ? <p className="text-xs text-text-secondary px-2 py-1">No staff found.</p>
                : filteredTherapists.length === 0 ? <p className="text-xs text-text-secondary px-2 py-1">No staff match "{staffQuery}".</p>
                : filteredTherapists.map((t) => (
                  <label key={t.id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-background ${eligibleIds.includes(t.id) ? 'bg-primary/5' : ''}`}>
                    <input type="checkbox" checked={eligibleIds.includes(t.id)} onChange={(e) => setEligibleIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((id) => id !== t.id)))} className="w-3.5 h-3.5 rounded text-primary" />
                    <span className="text-[13px] text-text-primary">{t.name}</span>
                  </label>
                ))}
            </div>
            <p className="text-xs text-text-secondary">{eligibleIds.length} selected</p>
          </div>
        )}

        <Field label="Service image" id="svc-image" hint="Shown in the customer booking page.">
          <ImageDropzone
            id="svc-image" previewUrl={imagePreview} error={imageError} onError={setImageError} disabled={saving}
            onPick={(file) => { setImageFile(file); setImagePreview(URL.createObjectURL(file)); }}
            onRemove={() => { setImageFile(null); setImagePreview(null); setImageUrl(''); setImageError(null); }}
          />
        </Field>

        <p className="text-xs text-text-secondary">
          {service ? 'Price and duration changes only affect future bookings; past bookings keep their original figures.' : 'A new service is available for booking at every branch straight away.'}
        </p>
      </FormBody>
    </PanelShell>
  );
};

export default ServiceFormPanel;
