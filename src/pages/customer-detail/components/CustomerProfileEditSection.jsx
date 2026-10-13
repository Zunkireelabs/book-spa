import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import { updateCustomerProfileDetails } from '../../../services/api';

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

const PRONOUN_OPTIONS = [
  { value: 'He/Him', label: 'He/Him' },
  { value: 'She/Her', label: 'She/Her' },
  { value: 'They/Them', label: 'They/Them' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

const FIELD_DEFS = [
  { key: 'clientSource', label: 'Client Source', placeholder: 'e.g. Walk-in, Instagram, Referral' },
  { key: 'referredBy', label: 'Referred By', placeholder: 'e.g. a friend\'s name' },
  { key: 'preferredLanguage', label: 'Preferred Language' },
  { key: 'country', label: 'Country' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'additionalEmail', label: 'Additional Email' },
  { key: 'additionalPhone', label: 'Additional Phone' },
];

const CustomerProfileEditSection = ({ customer, onSaved }) => {
  const [form, setForm] = useState({
    clientSource: customer.clientSource || '',
    referredBy: customer.referredBy || '',
    preferredLanguage: customer.preferredLanguage || '',
    country: customer.country || '',
    occupation: customer.occupation || '',
    additionalEmail: customer.additionalEmail || '',
    additionalPhone: customer.additionalPhone || '',
    gender: customer.gender || '',
    pronouns: customer.pronouns || '',
    dateOfBirth: customer.dateOfBirth || '',
    tags: customer.tags || [],
  });
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || form.tags.includes(tag)) { setTagInput(''); return; }
    setForm(f => ({ ...f, tags: [...f.tags, tag] }));
    setTagInput('');
  };

  const removeTag = (tag) => {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await updateCustomerProfileDetails(customer.id, form);

    if (result.error) {
      setError(result.error.message || 'Failed to save profile.');
      setSaving(false);
      return;
    }

    setSaving(false);
    setSaved(true);
    onSaved?.();
  };

  return (
    <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-4">
      <h3 className="font-heading font-heading-semibold text-base text-text-primary">Profile Details</h3>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELD_DEFS.map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">{label}</label>
            <Input
              value={form[key]}
              onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
            />
          </div>
        ))}

        <Select
          label="Gender"
          options={GENDER_OPTIONS}
          value={form.gender}
          onChange={(val) => setForm(f => ({ ...f, gender: val }))}
          placeholder="Select gender"
        />

        <Select
          label="Pronouns"
          options={PRONOUN_OPTIONS}
          value={form.pronouns}
          onChange={(val) => setForm(f => ({ ...f, pronouns: val }))}
          placeholder="Select pronouns"
        />

        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Date of Birth</label>
          <input
            type="date"
            value={form.dateOfBirth || ''}
            onChange={(e) => setForm(f => ({ ...f, dateOfBirth: e.target.value }))}
            className="w-full px-3 py-2 border border-border rounded-spa font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary spa-transition-fast"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Tags</label>
        <div className="flex flex-wrap items-center gap-2 p-2 border border-border rounded-spa bg-background min-h-[42px]">
          {form.tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-caption bg-primary/10 text-primary">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="hover:text-error">
                <Icon name="X" size={10} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
            }}
            onBlur={addTag}
            placeholder="Add tag..."
            className="flex-1 min-w-[100px] bg-transparent text-sm font-body text-text-primary focus:outline-none"
          />
        </div>
        <p className="font-caption text-xs text-text-secondary">Press Enter or comma to add a tag</p>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>Save Profile</Button>
        {saved && <span className="font-caption text-xs text-success">Saved</span>}
      </div>
    </div>
  );
};

export default CustomerProfileEditSection;
