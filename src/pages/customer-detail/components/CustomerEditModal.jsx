import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import CustomerPhotosTab from './CustomerPhotosTab';
import { updateCustomerContact, updateCustomerProfileDetails } from '../../../services/api';

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

const MORE_INFO_FIELDS = [
  { key: 'clientSource', label: 'Client Source', placeholder: 'e.g. Walk-in, Instagram, Referral' },
  { key: 'referredBy', label: 'Referred By', placeholder: "e.g. a friend's name" },
  { key: 'preferredLanguage', label: 'Preferred Language' },
  { key: 'country', label: 'Country' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'additionalEmail', label: 'Additional Email' },
  { key: 'additionalPhone', label: 'Additional Phone' },
];

const SUB_TABS = [
  { key: 'details', label: 'Details' },
  { key: 'moreInfo', label: 'More Info' },
  { key: 'photo', label: 'Photo' },
];

// Pops up when "Edit" is clicked on the customer detail page, matching
// Timely's Edit Customer modal — sub-tabbed (Details / More Info / Photo)
// with one Save button across the form sub-tabs. Photo uploads immediately
// via CustomerPhotosTab (not part of the Save/Cancel form state), same as
// every other gallery upload in this app.
const CustomerEditModal = ({ customer, onClose, onSaved }) => {
  const [subTab, setSubTab] = useState('details');
  const [form, setForm] = useState({
    fullName: customer.fullName || '',
    phone: customer.phone || '',
    email: customer.email || '',
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

    const trimmedName = form.fullName.trim();
    const trimmedPhone = form.phone.trim();
    const trimmedEmail = form.email.trim();

    const [contactResult, detailsResult] = await Promise.all([
      updateCustomerContact(customer.id, {
        fullName: trimmedName !== (customer.fullName || '') ? (trimmedName || null) : null,
        phone: trimmedPhone !== (customer.phone || '') ? (trimmedPhone || null) : null,
        email: trimmedEmail !== (customer.email || '') ? (trimmedEmail || null) : null,
      }),
      updateCustomerProfileDetails(customer.id, {
        clientSource: form.clientSource,
        referredBy: form.referredBy,
        preferredLanguage: form.preferredLanguage,
        country: form.country,
        occupation: form.occupation,
        additionalEmail: form.additionalEmail,
        additionalPhone: form.additionalPhone,
        gender: form.gender,
        pronouns: form.pronouns,
        dateOfBirth: form.dateOfBirth,
        tags: form.tags,
      }),
    ]);

    setSaving(false);

    if (contactResult.error || detailsResult.error) {
      setError((contactResult.error || detailsResult.error).message || 'Failed to save customer.');
      return;
    }

    onSaved?.();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="edit-customer-title">
        <div className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-surface border-b border-border px-5 py-3 flex items-center justify-between z-header">
            <h2 id="edit-customer-title" className="font-heading font-heading-semibold text-base text-text-primary">Edit Customer</h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 pt-3 flex items-center gap-1 border-b border-border">
            {SUB_TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSubTab(tab.key)}
                className={`px-3 py-2 font-body font-body-medium text-sm spa-transition-fast border-b-2 -mb-px ${
                  subTab === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="px-5 py-4">
            {error && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{error}</span>
              </div>
            )}

            {subTab === 'details' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1 sm:col-span-2">
                  <label className="block font-body font-body-medium text-sm text-text-primary">Full Name</label>
                  <Input value={form.fullName} onChange={(e) => setForm(f => ({ ...f, fullName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="block font-body font-body-medium text-sm text-text-primary">Telephone</label>
                  <Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="98XXXXXXXX" />
                </div>
                <div className="space-y-1">
                  <label className="block font-body font-body-medium text-sm text-text-primary">Email</label>
                  <Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
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
              </div>
            )}

            {subTab === 'moreInfo' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {MORE_INFO_FIELDS.map(({ key, label, placeholder }) => (
                    <div key={key} className="space-y-1">
                      <label className="block font-body font-body-medium text-sm text-text-primary">{label}</label>
                      <Input
                        value={form[key]}
                        onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
                        placeholder={placeholder}
                      />
                    </div>
                  ))}
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
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
                      onBlur={addTag}
                      placeholder="Add tag..."
                      className="flex-1 min-w-[100px] bg-transparent text-sm font-body text-text-primary focus:outline-none"
                    />
                  </div>
                  <p className="font-caption text-xs text-text-secondary">Press Enter or comma to add a tag</p>
                </div>
              </div>
            )}

            {subTab === 'photo' && (
              <CustomerPhotosTab customerId={customer.id} branchId={customer.branchId} compact />
            )}
          </div>

          <div className="sticky bottom-0 bg-surface border-t border-border px-5 py-3 flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>Save</Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default CustomerEditModal;
