import React from 'react';
import Icon from '../../../components/AppIcon';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Same preview/replace/remove upload pattern as the old standalone BranchPhotoPanel's
// PhotoField (5MB / JPEG-PNG-WebP-GIF validation), folded into this page's own section.
const LocationPhotoField = ({ preview, onFileSelected, onRemove, uploading }) => {
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

export default LocationPhotoField;
