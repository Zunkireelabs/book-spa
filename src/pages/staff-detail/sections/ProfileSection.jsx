import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import CountryCodeSelect from '../../../components/ui/CountryCodeSelect';
import StaffTypeToggle from '../components/StaffTypeToggle';
import PositionSpecialtiesFields from '../components/PositionSpecialtiesFields';
import { FormRow, Changed, Note, KV, Tag } from './ui';

const GENDER_OPTIONS = [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }];
const PRONOUN_OPTIONS = [
  { value: 'He/Him', label: 'He/Him' },
  { value: 'She/Her', label: 'She/Her' },
  { value: 'They/Them', label: 'They/Them' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

const Label = ({ children }) => <label className="block font-body font-body-medium text-sm text-text-primary mb-1">{children}</label>;

const initialsOf = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

// Specialties live in the form as one comma string; this shows them as removable chips with an add box.
const SpecialtyChips = ({ value, onChange, disabled }) => {
  const [draft, setDraft] = useState('');
  const chips = value.split(',').map((s) => s.trim()).filter(Boolean);
  const commit = (list) => onChange(list.join(', '));
  const add = () => {
    const v = draft.trim().replace(/,$/, '');
    if (v && !chips.some((c) => c.toLowerCase() === v.toLowerCase())) commit([...chips, v]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {chips.length === 0 && <span className="text-xs text-text-tertiary">None yet</span>}
        {chips.map((c) => (
          <span key={c} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs">
            {c}
            {!disabled && <button type="button" aria-label={`Remove ${c}`} onClick={() => commit(chips.filter((x) => x !== c))}><Icon name="X" size={12} /></button>}
          </span>
        ))}
      </div>
      {!disabled && (
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder="Type a specialty and press Enter"
        />
      )}
    </div>
  );
};

const ProfileEdit = ({
  form, setForm, changed, readOnly, isAdmin, enableStaffRatings, allPositionNames, staffLabel,
  photoPreview, uploadingPhoto, onPhotoChange, onRemovePhoto, isCreate,
}) => {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const ch = (k) => changed.includes(k);
  const showRating = form.isServiceStaff && enableStaffRatings;

  return (
    <div className="mt-2">
      <div>
        <FormRow title="Type" hint={`Service staff can be booked. Support staff (front desk, cleaning) can't.`}>
          <Changed on={ch('isServiceStaff')} field="type">
            <div className={readOnly ? 'pointer-events-none opacity-70' : ''}>
              <StaffTypeToggle isServiceStaff={form.isServiceStaff} onChange={(v) => set({ isServiceStaff: v })} />
            </div>
          </Changed>
        </FormRow>

        <FormRow title="Basics">
          <fieldset disabled={readOnly} className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <Changed on={ch('name')} field="name">
              <Label>Full name</Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Anjali Thapa" />
            </Changed>
            <Changed on={ch('gender')} field="gender">
              <Select label="Gender" options={GENDER_OPTIONS} value={form.gender} onChange={(v) => set({ gender: v })} disabled={readOnly} />
            </Changed>
            <Changed on={ch('pronouns')} field="pronouns">
              <Select label="Pronouns" options={PRONOUN_OPTIONS} value={form.pronouns} onChange={(v) => set({ pronouns: v })} placeholder="Select pronouns" disabled={readOnly} />
            </Changed>
            <Changed on={ch('positions')} className="sm:col-span-2" field="positions">
              <PositionSpecialtiesFields formData={form} setFormData={setForm} allPositionNames={allPositionNames} showSpecialties={false} />
            </Changed>
          </fieldset>
        </FormRow>

        <FormRow title="Contact" hint="Only staff see this.">
          <fieldset disabled={readOnly} className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <Changed on={ch('phone') || ch('countryCode')} field="phone">
              <Label>Phone</Label>
              <div className="flex">
                <CountryCodeSelect value={form.countryCode || '+977'} onChange={(dial) => set({ countryCode: dial })} />
                <input
                  type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="98XXXXXXXX"
                  className="flex-1 min-w-0 h-10 px-3 text-sm border border-border rounded-r-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </Changed>
            <Changed on={ch('email')} field="email">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="e.g. anjali@example.com" />
            </Changed>
            <Changed on={ch('address')} field="address">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => set({ address: e.target.value })} />
            </Changed>
            <Changed on={ch('city')} field="city">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => set({ city: e.target.value })} />
            </Changed>
          </fieldset>
        </FormRow>

        <FormRow title="Online profile" hint="Shown to customers on the booking page." last>
          <div className="space-y-4 max-w-2xl">
            <Changed on={ch('photoUrl') || ch('photo')} field="photo">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary font-medium">
                  {photoPreview ? <img src={photoPreview} alt="" className="w-full h-full object-cover" /> : initialsOf(form.name)}
                </div>
                {!readOnly && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-surface hover:bg-background text-sm text-text-primary">
                      <Icon name="Upload" size={14} />{photoPreview ? 'Replace photo' : 'Upload photo'}
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPhotoChange} className="hidden" />
                    </label>
                    {photoPreview && <button type="button" onClick={onRemovePhoto} className="text-sm text-error hover:underline">Remove</button>}
                    <span className="text-xs text-text-tertiary">JPG, PNG, WebP or GIF · up to 2 MB</span>
                  </div>
                )}
                {uploadingPhoto && <span className="text-xs text-text-secondary">Uploading…</span>}
              </div>
            </Changed>
            <Changed on={ch('bio')} field="bio">
              <Label>Bio</Label>
              <textarea
                value={form.bio} onChange={(e) => set({ bio: e.target.value })} disabled={readOnly} rows={3}
                placeholder="A short bio shown on the booking page"
                className="w-full px-3 py-2 border border-border rounded-spa font-body text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-70"
              />
            </Changed>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Changed on={ch('experienceYears')} field="experienceYears">
                <Label>Experience (years)</Label>
                <Input type="number" min="0" value={form.experienceYears} onChange={(e) => set({ experienceYears: e.target.value })} disabled={readOnly} />
              </Changed>
              {showRating && (
                <Changed on={ch('rating')} field="rating">
                  <Label>Rating <span className="text-xs text-text-tertiary font-normal">· admins only</span></Label>
                  <Input type="number" min="0" max="5" step="0.1" value={form.rating} onChange={(e) => set({ rating: e.target.value })} disabled={readOnly || !isAdmin} />
                </Changed>
              )}
            </div>
            {form.isServiceStaff && (
              <Changed on={ch('specialties')} field="specialties">
                <Label>Specialties</Label>
                <SpecialtyChips value={form.specialties} onChange={(v) => set({ specialties: v })} disabled={readOnly} />
              </Changed>
            )}
          </div>
        </FormRow>
      </div>
      {readOnly && <div className="mt-3"><Note icon="Lock">You can view this profile but not change it.</Note></div>}
    </div>
  );
};



const ProfileView = ({ form, canEdit, onAdd, isAdmin, enableStaffRatings, staffLabel }) => {
  const add = (field, label) => (canEdit ? { add: label, onAdd: () => onAdd(field) } : {});
  const chips = form.specialties.split(',').map((s) => s.trim()).filter(Boolean);
  const showRating = form.isServiceStaff && enableStaffRatings;
  return (
    <KV items={[
      { group: 'Basics' },
      { label: 'Type', value: form.isServiceStaff ? 'Service staff · takes bookings' : `Support staff · not bookable` },
      { label: 'Position', value: form.positions[0] || null, ...add('positions', 'Add position') },
      { label: 'Gender', value: form.gender },
      { label: 'Pronouns', value: form.pronouns || null, ...add('pronouns', 'Add pronouns') },
      { group: 'Contact · only your team sees this' },
      { label: 'Phone', value: form.phone ? `${form.countryCode} ${form.phone}` : null, ...add('phone', 'Add phone') },
      { label: 'Email', value: form.email || null, ...add('email', 'Add email') },
      { label: 'Address', wide: true, value: [form.address, form.city].filter(Boolean).join(', ') || null, ...add('address', 'Add address') },
      ...(form.isServiceStaff ? [
        { group: 'Online profile · shown on your booking page' },
        { label: 'Bio', wide: true, value: form.bio || null, ...add('bio', 'Add a bio') },
        { label: 'Experience', value: form.experienceYears !== '' ? `${form.experienceYears} year${form.experienceYears === '1' ? '' : 's'}` : null, ...add('experienceYears', 'Add experience') },
        ...(showRating ? [{ label: 'Rating', value: form.rating !== '' ? <>★ {form.rating} <span className="text-text-secondary text-xs">· set by admins</span></> : null, ...(isAdmin ? add('rating', 'Add rating') : {}) }] : []),
        { label: 'Specialties', wide: true, value: chips.length ? chips.map((c) => <Tag key={c}>{c}</Tag>) : null, ...add('specialties', 'Add specialties') },
      ] : []),
    ]} />
  );
};

const ProfileSection = ({ editing, ...props }) => (editing
  ? <ProfileEdit {...props} />
  : <ProfileView form={props.form} canEdit={!props.readOnly} onAdd={props.onAdd} isAdmin={props.isAdmin} enableStaffRatings={props.enableStaffRatings} staffLabel={props.staffLabel} />);

export default ProfileSection;
