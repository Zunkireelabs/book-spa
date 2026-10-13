import React from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

const StaffProfileSection = ({
  formData, setFormData, formError,
  allPositionNames, enableStaffRatings,
  photoPreview, uploadingPhoto, onPhotoChange, onRemovePhoto,
}) => {
  return (
    <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-4">
      <h3 className="font-heading font-heading-semibold text-base text-text-primary">Staff Details</h3>

      {formError && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{formError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Name</label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Anjali Thapa"
            autoFocus
          />
        </div>

        <Select
          label="Gender"
          options={GENDER_OPTIONS}
          value={formData.gender}
          onChange={(val) => setFormData({ ...formData, gender: val })}
        />

        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Phone Number</label>
          <Input
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="e.g. 98XXXXXXXX"
          />
        </div>

        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">City</label>
          <Input
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
          />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label className="block font-body font-body-medium text-sm text-text-primary">Address</label>
          <Input
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          />
        </div>
      </div>

      {formData.isServiceStaff && (
        <>
          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">
              Position{formData.positions.length > 0 && <span className="ml-1 text-xs text-text-secondary font-normal">({formData.positions.join(', ')})</span>}
            </label>
            <div className="border border-border rounded-spa bg-background max-h-[120px] overflow-y-auto p-2 space-y-1">
              {allPositionNames.length === 0 ? (
                <p className="text-xs text-text-secondary px-2 py-1">No positions yet. Use "Add Position" from the staff list to create one.</p>
              ) : (
                allPositionNames.map(pos => (
                  <label key={pos} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-primary/5 ${formData.positions.includes(pos) ? 'bg-primary/5' : ''}`}>
                    <input
                      type="checkbox"
                      checked={formData.positions.includes(pos)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData(f => ({ ...f, positions: [...f.positions, pos] }));
                        } else {
                          setFormData(f => ({ ...f, positions: f.positions.filter(p => p !== pos) }));
                        }
                      }}
                      className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                    />
                    <span className="font-body text-sm text-text-primary">{pos}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="block font-body font-body-medium text-sm text-text-primary">Specialties</label>
            <Input
              value={formData.specialties}
              onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
              placeholder="e.g. Deep Tissue, Swedish (comma-separated)"
            />
            <p className="font-caption text-xs text-text-secondary">Separate multiple specialties with commas</p>
          </div>
        </>
      )}

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
          <label className="cursor-pointer flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border rounded-spa hover:border-primary/50 hover:bg-primary/5 spa-transition-fast">
            <Icon name="Upload" size={24} className="text-text-tertiary mb-2" />
            <span className="font-body text-sm text-text-secondary">Click to upload photo</span>
            <span className="font-caption text-xs text-text-tertiary mt-1">JPEG, PNG, WebP, GIF (max 5MB)</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPhotoChange} className="hidden" />
          </label>
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

export default StaffProfileSection;
