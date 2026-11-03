import React from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';

const PersonalInfoFields = ({
  formData, setFormData, enableStaffRatings,
  photoPreview, uploadingPhoto, onPhotoChange, onRemovePhoto,
}) => {
  return (
    <div className="space-y-4 max-w-xl">
      <div className="space-y-2">
        <label className="block font-body font-body-medium text-sm text-text-primary">Photo</label>

        {photoPreview ? (
          <div className="flex items-start gap-3">
            <div className="relative w-20 h-20 rounded-full overflow-hidden border border-border flex-shrink-0">
              <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-background hover:bg-background/80 spa-transition-fast text-sm text-text-secondary">
                <Icon name="RefreshCw" size={14} />
                Replace
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPhotoChange} className="hidden" />
              </label>
              <button
                type="button"
                onClick={onRemovePhoto}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-error/30 bg-error/5 hover:bg-error/10 spa-transition-fast text-sm text-error"
              >
                <Icon name="Trash2" size={14} />
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="cursor-pointer flex flex-col items-center justify-center w-40 h-56 border-2 border-dashed border-border rounded-spa hover:border-primary/50 hover:bg-primary/5 spa-transition-fast text-center">
              <Icon name="Upload" size={24} className="text-text-tertiary mb-2" />
              <span className="font-body text-sm text-text-secondary px-2">Click to upload photo</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPhotoChange} className="hidden" />
            </label>
            <p className="font-caption text-xs text-text-tertiary">Accepted formats: PNG, GIF or JPG. Maximum file size is 2.0MB.</p>
          </div>
        )}

        {uploadingPhoto && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
            Uploading photo...
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Bio</label>
        <textarea
          value={formData.bio}
          onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
          placeholder="Short bio shown on the staff profile"
          rows={3}
          className="w-full px-3 py-2 border border-border rounded-spa font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary spa-transition-fast resize-none"
        />
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Experience (years)</label>
        <Input
          type="number"
          min="0"
          value={formData.experienceYears}
          onChange={(e) => setFormData({ ...formData, experienceYears: e.target.value })}
        />
      </div>

      {formData.isServiceStaff && enableStaffRatings && (
        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Rating</label>
          <Input
            type="number"
            min="0"
            max="5"
            step="0.1"
            value={formData.rating}
            onChange={(e) => setFormData({ ...formData, rating: e.target.value })}
          />
        </div>
      )}
    </div>
  );
};

export default PersonalInfoFields;
