import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import { fetchBranchPhoto, uploadBranchPhoto, updateBranchPhoto } from '../../../../services/api';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Storefront photo for this branch (branches.photo_url) — shown on BranchGate's
// multi-branch picker tile for the customer booking flow (falls back to a generic icon
// tile when empty). Same preview/replace/remove upload pattern as ProviderProfilePanel's
// BrandingImageField (logo/hero); kept as its own small component here rather than
// imported from there since that one isn't exported and this panel is per-branch (takes
// a branchId prop) while ProviderProfilePanel is org-level.
const PhotoField = ({ preview, onFileSelected, onRemove, uploading }) => {
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
      {preview ? (
        <div className="flex items-start gap-3">
          <div className="relative w-32 h-20 rounded-spa overflow-hidden border border-border flex-shrink-0 bg-background">
            <img src={preview} alt="Branch photo preview" className="w-full h-full object-cover" />
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
      <p className="font-caption text-xs text-text-tertiary mt-1.5">PNG, JPG, WebP or GIF. Max 5MB.</p>
      {uploading && (
        <div className="flex items-center gap-2 text-xs text-text-secondary mt-1.5">
          <div className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />
          Uploading...
        </div>
      )}
    </div>
  );
};

const BranchPhotoPanel = ({ branchId }) => {
  const [branch, setBranch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // preview is what's shown — either the branch's saved URL, an objectURL for a
  // just-picked file (not yet uploaded), or '' if removed.
  // file holds the picked File, uploaded only when Save runs.
  const [preview, setPreview] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchErr } = await fetchBranchPhoto(branchId);
    if (fetchErr) setError(fetchErr.message || 'Failed to load the branch photo.');
    else {
      setBranch(data);
      setPreview(data?.photo_url ?? '');
      setFile(null);
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleFileSelected = (picked, validationError) => {
    if (validationError) { setError(validationError); return; }
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
    setError(null);
    setSavedAt(null);
  };
  const handleRemove = () => { setFile(null); setPreview(''); setSavedAt(null); };

  const isDirty = !!file || preview !== (branch?.photo_url ?? '');

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedAt(null);

    let finalUrl = preview;
    if (file) {
      const { url, error: uploadErr } = await uploadBranchPhoto(branchId, file);
      if (uploadErr) { setError(uploadErr.message || 'Failed to upload photo.'); setSaving(false); return; }
      finalUrl = url;
    }

    const { error: saveErr } = await updateBranchPhoto(branchId, finalUrl || null);
    if (saveErr) {
      setError(saveErr.message || 'Failed to save the branch photo.');
      setSaving(false);
      return;
    }

    setBranch((prev) => ({ ...prev, photo_url: finalUrl || null }));
    setPreview(finalUrl || '');
    setFile(null);
    setSaving(false);
    setSavedAt(Date.now());
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-accent text-3xl text-text-primary leading-tight">Branch photo</h3>
        <p className="font-body text-sm text-text-secondary mt-1 max-w-xl">
          Shown on the storefront picker when a customer chooses between{' '}
          {branch?.name ? <span className="font-body-semibold text-text-primary">{branch.name}</span> : 'this branch'} and your other branches.
          Leave empty to show a generic icon tile instead.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm animate-fade-in">
          <Icon name="AlertCircle" size={16} className="flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto flex-shrink-0"><Icon name="X" size={14} /></button>
        </div>
      )}

      {loading ? (
        <div className="h-32 rounded-spa-lg border border-border bg-background animate-pulse" />
      ) : (
        <div className="p-5 border border-border rounded-spa-lg bg-surface shadow-spa-resting space-y-4 animate-fade-in">
          <PhotoField
            preview={preview}
            onFileSelected={handleFileSelected}
            onRemove={handleRemove}
            uploading={saving && !!file}
          />

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" loading={saving} disabled={!isDirty} onClick={handleSave}>
              Save
            </Button>
            {savedAt && !isDirty && (
              <span className="inline-flex items-center gap-1.5 text-success font-body text-sm animate-fade-in">
                <Icon name="Check" size={15} />
                Saved
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchPhotoPanel;
