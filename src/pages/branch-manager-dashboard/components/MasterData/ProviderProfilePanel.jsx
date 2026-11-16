import React, { useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import { useOrg } from '../../../../contexts/OrgContext';
import { updateOrgProfileSetting, updateOrgBranding, uploadOrgBrandingImage } from '../../../../services/api';

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

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Logo/hero upload field — same preview/replace/remove pattern as staff-detail's
// PersonalInfoFields photo upload. Selecting a file only swaps the local preview (via
// an object URL); the actual upload happens when the parent's Save Branding runs, so
// picking the wrong file and immediately picking another doesn't burn two uploads.
const BrandingImageField = ({ label, hint, preview, onFileSelected, onRemove, uploading }) => {
  const handleChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let re-selecting the same file re-fire onChange
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      onFileSelected(null, 'Only JPEG, PNG, WebP, and GIF images are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      onFileSelected(null, 'Image must be less than 5MB.');
      return;
    }
    onFileSelected(file, null);
  };

  return (
    <div>
      <label className="font-caption text-xs text-text-secondary uppercase tracking-wide">{label}</label>
      <div className="mt-1.5">
        {preview ? (
          <div className="flex items-start gap-3">
            <div className="relative w-32 h-20 rounded-spa overflow-hidden border border-border flex-shrink-0 bg-background">
              <img src={preview} alt={`${label} preview`} className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-background hover:bg-background/80 spa-transition-fast text-sm text-text-secondary">
                <Icon name="RefreshCw" size={14} />
                Replace
                <input type="file" accept={ALLOWED_IMAGE_TYPES.join(',')} onChange={handleChange} className="hidden" />
              </label>
              <button
                type="button"
                onClick={onRemove}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-error/30 bg-error/5 hover:bg-error/10 spa-transition-fast text-sm text-error"
              >
                <Icon name="Trash2" size={14} />
                Remove
              </button>
            </div>
          </div>
        ) : (
          <label className="cursor-pointer flex flex-col items-center justify-center w-full max-w-xs h-28 border-2 border-dashed border-border rounded-spa hover:border-primary/50 hover:bg-primary/5 spa-transition-fast text-center">
            <Icon name="Upload" size={20} className="text-text-tertiary mb-1.5" />
            <span className="font-body text-sm text-text-secondary px-2">Click to upload</span>
            <input type="file" accept={ALLOWED_IMAGE_TYPES.join(',')} onChange={handleChange} className="hidden" />
          </label>
        )}
        {hint && <p className="font-caption text-xs text-text-tertiary mt-1.5">{hint}</p>}
        {uploading && (
          <div className="flex items-center gap-2 text-xs text-text-secondary mt-1.5">
            <div className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />
            Uploading...
          </div>
        )}
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
  // logoPreview/heroPreview are what's shown — either the org's saved URL, an
  // objectURL for a just-picked file (not yet uploaded), or '' if removed.
  // logoFile/heroFile hold the picked File, uploaded only when Save Branding runs.
  const [logoPreview, setLogoPreview] = useState(org.org?.logo_url ?? '');
  const [logoFile, setLogoFile] = useState(null);
  const [heroPreview, setHeroPreview] = useState(org.org?.hero_image_url ?? '');
  const [heroFile, setHeroFile] = useState(null);

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
    setLogoPreview(org.org.logo_url ?? '');
    setLogoFile(null);
    setHeroPreview(org.org.hero_image_url ?? '');
    setHeroFile(null);
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

  const handleLogoSelected = (file, validationError) => {
    if (validationError) { setError(validationError); return; }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setError(null);
  };
  const handleRemoveLogo = () => { setLogoFile(null); setLogoPreview(''); };

  const handleHeroSelected = (file, validationError) => {
    if (validationError) { setError(validationError); return; }
    setHeroFile(file);
    setHeroPreview(URL.createObjectURL(file));
    setError(null);
  };
  const handleRemoveHero = () => { setHeroFile(null); setHeroPreview(''); };

  const saveBranding = async () => {
    setSaving('branding');
    setError(null);

    let finalLogoUrl = logoPreview;
    if (logoFile) {
      const { url, error: uploadErr } = await uploadOrgBrandingImage('logo', logoFile);
      if (uploadErr) { setError(uploadErr.message || 'Failed to upload logo.'); setSaving(null); return; }
      finalLogoUrl = url;
    }

    let finalHeroUrl = heroPreview;
    if (heroFile) {
      const { url, error: uploadErr } = await uploadOrgBrandingImage('hero', heroFile);
      if (uploadErr) { setError(uploadErr.message || 'Failed to upload hero image.'); setSaving(null); return; }
      finalHeroUrl = url;
    }

    const result = await updateOrgBranding({ logoUrl: finalLogoUrl, heroImageUrl: finalHeroUrl });
    if (result.error) {
      setError(result.error.message || 'Failed to save branding.');
    } else {
      setLogoFile(null);
      setHeroFile(null);
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

      <div className="space-y-4 p-4 border border-border rounded-spa">
        <span className="font-body font-body-medium text-sm text-text-primary">Branding</span>
        <BrandingImageField
          label="Logo"
          hint="PNG, JPG, WebP or GIF. Max 5MB."
          preview={logoPreview}
          onFileSelected={handleLogoSelected}
          onRemove={handleRemoveLogo}
          uploading={saving === 'branding' && !!logoFile}
        />
        <BrandingImageField
          label="Hero Image"
          hint="Shown as the banner on the booking page. PNG, JPG, WebP or GIF. Max 5MB."
          preview={heroPreview}
          onFileSelected={handleHeroSelected}
          onRemove={handleRemoveHero}
          uploading={saving === 'branding' && !!heroFile}
        />
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
