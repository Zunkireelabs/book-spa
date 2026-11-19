import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanelShell, FormBody, Field, TextInput, DateField, InfoRows, InlineError, controlA11y,
} from '../../../../components/ui/PanelFormKit';
import { createCampaign, updateCampaign, uploadCampaignBanner } from '../../../../services/api';
import { toDateInputValue } from '../../../../utils/date';
import { friendlyError } from '../../../../utils/friendlyError';
import ImageDropzone from '../Products/ImageDropzone';

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const shortDate = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dayCount = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000) + 1;

const Checklist = ({ items, selected, onToggle, empty, maxH }) => (
  <div className={`border border-border rounded-spa ${maxH} overflow-y-auto p-1`}>
    {items.length === 0 ? <p className="text-xs text-text-secondary px-2 py-1">{empty}</p> : items.map((it) => (
      <label key={it.id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-background ${selected.includes(it.id) ? 'bg-primary/5' : ''}`}>
        <input type="checkbox" checked={selected.includes(it.id)} onChange={(e) => onToggle(it.id, e.target.checked)} className="w-3.5 h-3.5 rounded text-primary" />
        <span className="text-[13px] text-text-primary">{it.name}</span>
      </label>
    ))}
  </div>
);

// "New campaign" / "Edit campaign" in the right-hand panel. Callbacks: onClose(), onSaved(id, isNew).
const CampaignFormPanel = ({ campaign, services, categories, onClose, onSaved }) => {
  const editing = !!campaign;
  const today = toDateInputValue(new Date());
  const original = useMemo(() => ({
    name: campaign?.name || '',
    message: campaign?.message || '',
    discountPercent: campaign ? String(campaign.discount_percent) : '',
    startDate: campaign?.start_date || today,
    endDate: campaign?.end_date || today,
    serviceIds: campaign?.service_ids || [],
    categoryIds: campaign?.category_ids || [],
  }), [campaign, today]);
  const [form, setForm] = useState(original);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(campaign?.banner_image_url || null);
  const [imageUrl, setImageUrl] = useState(campaign?.banner_image_url || '');
  const [imageError, setImageError] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setServerError(null); };
  const clear = (k) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  const percent = Number(form.discountPercent) || 0;
  const imageChanged = !!imageFile || (editing && (campaign.banner_image_url || '') !== imageUrl);
  const changed = editing
    ? (form.name !== original.name || form.message !== original.message || form.discountPercent !== original.discountPercent
      || form.startDate !== original.startDate || form.endDate !== original.endDate
      || !sameSet(form.serviceIds, original.serviceIds) || !sameSet(form.categoryIds, original.categoryIds) || imageChanged)
    : !!(form.name || form.message || form.discountPercent || form.serviceIds.length || form.categoryIds.length || imageFile
      || form.startDate !== today || form.endDate !== today);
  const targets = form.serviceIds.length + form.categoryIds.length;
  const reason = editing && !changed ? 'No changes'
    : !form.name.trim() ? 'Enter the campaign name' : !(percent > 0) ? 'Enter the discount' : targets === 0 ? 'Pick what it applies to' : '';

  const submit = async () => {
    if (savingRef.current || reason) return;
    const e = {};
    if (!form.name.trim()) e.name = 'Campaign name is required.';
    if (!percent || percent <= 0 || percent >= 100) e.percent = 'Discount percent must be between 1 and 99.';
    if (!form.startDate || !form.endDate) e.dates = 'Start and end dates are required.';
    else if (form.endDate < form.startDate) e.dates = 'End date cannot be before the start date.';
    if (targets === 0) e.targets = 'Pick at least one service or category for this campaign to apply to.';
    setErrors(e);
    const first = ['name', 'percent', 'dates', 'targets'].find((k) => e[k]);
    if (first) { document.getElementById(`cmp-${first}`)?.focus({ preventScroll: true }); document.getElementById(`cmp-${first}`)?.scrollIntoView?.({ block: 'center' }); return; }

    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    let finalImageUrl = imageUrl.trim() || null;
    if (imageFile) {
      const up = await uploadCampaignBanner(imageFile);
      if (up.error) {
        savingRef.current = false;
        setSaving(false);
        setImageError(friendlyError(up.error, 'Could not upload the image.'));
        document.getElementById('cmp-image')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      finalImageUrl = up.url;
    }
    const payload = {
      name: form.name.trim(), message: form.message.trim() || null, bannerImageUrl: finalImageUrl, discountPercent: percent,
      startDate: form.startDate, endDate: form.endDate, serviceIds: form.serviceIds, categoryIds: form.categoryIds,
    };
    const result = editing ? await updateCampaign({ campaignId: campaign.id, ...payload }) : await createCampaign(payload);
    savingRef.current = false;
    setSaving(false);
    if (result.error) { setServerError(friendlyError(result.error, 'Could not save the campaign.')); return; }
    onSaved(editing ? campaign.id : result.data?.id, !editing);
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitRef.current(); } };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.getElementById('cmp-name')?.focus({ preventScroll: true }), 260);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  const toggle = (key) => (id, on) => { set({ [key]: on ? [...form[key], id] : form[key].filter((x) => x !== id) }); clear('targets'); };
  const appliesTo = [
    form.categoryIds.length > 0 ? `${form.categoryIds.length} categor${form.categoryIds.length === 1 ? 'y' : 'ies'}` : null,
    form.serviceIds.length > 0 ? `${form.serviceIds.length} service${form.serviceIds.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ');
  const datesOk = form.startDate && form.endDate && form.endDate >= form.startDate;

  return (
    <PanelShell
      variant="panel" title={editing ? 'Edit campaign' : 'New campaign'} onClose={onClose} dirty={changed} busy={saving} reason={reason}
      primary={{ label: saving ? 'Saving…' : (editing ? 'Save changes' : 'Create campaign'), onClick: submit, disabled: !!reason, loading: saving }}
    >
      <FormBody>
        <InlineError message={serverError} />
        <Field label="Campaign name" required id="cmp-name" error={errors.name}>
          <TextInput {...controlA11y('cmp-name', errors.name)} error={!!errors.name} value={form.name} onChange={(e) => { set({ name: e.target.value }); clear('name'); }} placeholder="e.g. Dashain Offer" />
        </Field>
        <Field label="Message" id="cmp-message" hint="Optional banner text.">
          <textarea
            id="cmp-message" value={form.message} onChange={(e) => set({ message: e.target.value })} rows={2} placeholder="Celebrate with us — special prices for a limited time"
            className="w-full px-3 py-2 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          />
        </Field>
        <div id="cmp-dates" tabIndex={-1} className="space-y-1.5">
          <div className="grid grid-cols-2 gap-3">
            <DateField label="Start date" required value={form.startDate} onChange={(v) => { set({ startDate: v, endDate: form.endDate < v ? v : form.endDate }); clear('dates'); }} />
            <DateField label="End date" required value={form.endDate} min={form.startDate} onChange={(v) => { set({ endDate: v }); clear('dates'); }} />
          </div>
          {errors.dates && <p role="alert" className="text-xs text-error">{errors.dates}</p>}
        </div>
        <Field label="Discount %" required id="cmp-percent" error={errors.percent} hint="Overrides any manual offer on the services/categories below while the campaign is live.">
          <TextInput {...controlA11y('cmp-percent', errors.percent)} error={!!errors.percent} inputMode="decimal" value={form.discountPercent} onChange={(e) => { set({ discountPercent: e.target.value.replace(/[^\d.]/g, '') }); clear('percent'); }} placeholder="e.g. 20" />
        </Field>

        <div id="cmp-targets" tabIndex={-1} className="space-y-4">
          <Field label={`Categories${form.categoryIds.length > 0 ? ` (${form.categoryIds.length} selected)` : ''}`}>
            <Checklist items={categories} selected={form.categoryIds} onToggle={toggle('categoryIds')} empty="No categories yet." maxH="max-h-32" />
          </Field>
          <Field label={`Individual services${form.serviceIds.length > 0 ? ` (${form.serviceIds.length} selected)` : ''}`} error={errors.targets}>
            <Checklist items={services} selected={form.serviceIds} onToggle={toggle('serviceIds')} empty="No services yet." maxH="max-h-44" />
          </Field>
        </div>

        <Field label="Banner image" id="cmp-image" hint="Optional. Without one, the banner just shows text.">
          <ImageDropzone
            id="cmp-image" previewUrl={imagePreview} error={imageError} onError={setImageError} disabled={saving}
            onPick={(file) => { setImageFile(file); setImagePreview(URL.createObjectURL(file)); }}
            onRemove={() => { setImageFile(null); setImagePreview(null); setImageUrl(''); setImageError(null); }}
          />
        </Field>

        {(datesOk || percent > 0 || targets > 0) && (
          <InfoRows rows={[
            datesOk ? ['Runs', `${shortDate(form.startDate)} – ${shortDate(form.endDate)} (${dayCount(form.startDate, form.endDate)} day${dayCount(form.startDate, form.endDate) === 1 ? '' : 's'})`] : null,
            percent > 0 && percent < 100 ? ['Discount', `${percent}% off while live`, 'total'] : null,
            targets > 0 ? ['Applies to', appliesTo] : null,
          ]} />
        )}
      </FormBody>
    </PanelShell>
  );
};

export default CampaignFormPanel;
