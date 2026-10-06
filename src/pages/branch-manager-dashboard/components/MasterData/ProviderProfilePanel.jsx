import React, { useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import { useOrg } from '../../../../contexts/OrgContext';
import { updateOrgProfileSetting, updateOrgBranding } from '../../../../services/api';

const LIST_FIELDS = [
  { key: 'amenities', label: 'Amenities', placeholder: 'e.g. Free WiFi' },
  { key: 'included_with_visit', label: 'Included With Every Visit', placeholder: 'e.g. Welcome drink' },
  { key: 'optional_extras', label: 'Optional Extras', placeholder: 'e.g. Hot towel upgrade' },
];

const ListFieldEditor = ({ label, placeholder, items, onChange }) => {
  const [draft, setDraft] = useState('');

  const addItem = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft('');
  };

  const removeItem = (index) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div>
      <span className="font-body font-body-medium text-sm text-text-primary">{label}</span>
      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <div key={`${item}-${index}`} className="flex items-center gap-2">
            <span className="flex-1 px-3 py-1.5 bg-background border border-border rounded-spa text-sm text-text-primary">
              {item}
            </span>
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="p-1.5 rounded hover:bg-error/10 text-text-secondary hover:text-error"
              aria-label={`Remove ${item}`}
            >
              <Icon name="X" size={14} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
            placeholder={placeholder}
            className="flex-1 px-3 py-1.5 border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button variant="outline" size="sm" iconName="Plus" iconSize={14} onClick={addItem}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
};

const ProviderProfilePanel = () => {
  const org = useOrg();
  const { refreshOrg } = org;
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  const [about, setAbout] = useState(org.org?.settings?.about ?? '');
  const [cancellationPolicy, setCancellationPolicy] = useState(org.org?.settings?.cancellation_policy ?? '');
  const [logoUrl, setLogoUrl] = useState(org.org?.logo_url ?? '');
  const [heroImageUrl, setHeroImageUrl] = useState(org.org?.hero_image_url ?? '');
  const useProviderProfileLayout = org.org?.settings?.use_provider_profile_layout === true;

  // OrgContext loads org asynchronously, so useState's one-time initializer above
  // mounts with org.org === null on a hard reload and seeds every field to '' — the
  // first Save would then write empty strings over real content. Re-seed once org
  // resolves. Keyed on the id (not the org object identity, which can change on
  // every refreshOrg()) so this fires once per org, not on every re-render, and
  // can't clobber an in-progress edit.
  useEffect(() => {
    if (!org.org?.id) return;
    setAbout(org.org.settings?.about ?? '');
    setCancellationPolicy(org.org.settings?.cancellation_policy ?? '');
    setLogoUrl(org.org.logo_url ?? '');
    setHeroImageUrl(org.org.hero_image_url ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.org?.id]);

  const settingsLists = {
    amenities: org.org?.settings?.amenities || [],
    included_with_visit: org.org?.settings?.included_with_visit || [],
    optional_extras: org.org?.settings?.optional_extras || [],
  };

  const saveSetting = async (key, value) => {
    setSaving(key);
    setError(null);
    const result = await updateOrgProfileSetting(key, value);
    if (result.error) {
      setError(result.error.message || 'Failed to save.');
    } else {
      await refreshOrg();
    }
    setSaving(null);
  };

  const saveBranding = async () => {
    setSaving('branding');
    setError(null);
    const result = await updateOrgBranding({ logoUrl, heroImageUrl });
    if (result.error) {
      setError(result.error.message || 'Failed to save branding.');
    } else {
      await refreshOrg();
    }
    setSaving(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Provider Profile</h3>
        <p className="font-body text-sm text-text-secondary">
          About, amenities, and branding for the profile-page-style customer booking layout.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <label className="flex items-center justify-between p-3 border border-border rounded-spa cursor-pointer hover:bg-background">
        <div className="pr-4">
          <span className="font-body font-body-medium text-sm text-text-primary">Use provider-profile layout</span>
          <p className="font-caption text-xs text-text-secondary">
            Switches /book from the default step wizard to the profile-page-style layout (scroll-spy tabs + booking drawer).
          </p>
        </div>
        <button
          type="button"
          disabled={saving === 'use_provider_profile_layout'}
          onClick={() => saveSetting('use_provider_profile_layout', !useProviderProfileLayout)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full spa-transition-fast ${
            useProviderProfileLayout ? 'bg-success' : 'bg-border'
          } ${saving === 'use_provider_profile_layout' ? 'opacity-50' : ''}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
            useProviderProfileLayout ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </label>

      <div className="space-y-3 p-4 border border-border rounded-spa">
        <span className="font-body font-body-medium text-sm text-text-primary">Branding</span>
        <div>
          <label className="font-caption text-xs text-text-secondary uppercase tracking-wide">Logo URL</label>
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
            className="mt-1 w-full px-3 py-1.5 border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="font-caption text-xs text-text-secondary uppercase tracking-wide">Hero Image URL</label>
          <input
            type="text"
            value={heroImageUrl}
            onChange={(e) => setHeroImageUrl(e.target.value)}
            placeholder="https://..."
            className="mt-1 w-full px-3 py-1.5 border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <Button variant="outline" size="sm" loading={saving === 'branding'} onClick={saveBranding}>
          Save Branding
        </Button>
      </div>

      <div className="space-y-2 p-4 border border-border rounded-spa">
        <label className="font-body font-body-medium text-sm text-text-primary">About</label>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={4}
          placeholder="A short description shown on the Overview tab of the booking page."
          className="w-full px-3 py-2 border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button variant="outline" size="sm" loading={saving === 'about'} onClick={() => saveSetting('about', about)}>
          Save About
        </Button>
      </div>

      {LIST_FIELDS.map((field) => (
        <div key={field.key} className="p-4 border border-border rounded-spa">
          <ListFieldEditor
            label={field.label}
            placeholder={field.placeholder}
            items={settingsLists[field.key]}
            onChange={(next) => saveSetting(field.key, next)}
          />
        </div>
      ))}

      <div className="space-y-2 p-4 border border-border rounded-spa">
        <label className="font-body font-body-medium text-sm text-text-primary">Cancellation Policy</label>
        <textarea
          value={cancellationPolicy}
          onChange={(e) => setCancellationPolicy(e.target.value)}
          rows={4}
          placeholder="Shown on the Policies tab of the booking page."
          className="w-full px-3 py-2 border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button
          variant="outline"
          size="sm"
          loading={saving === 'cancellation_policy'}
          onClick={() => saveSetting('cancellation_policy', cancellationPolicy)}
        >
          Save Policy
        </Button>
      </div>
    </div>
  );
};

export default ProviderProfilePanel;
