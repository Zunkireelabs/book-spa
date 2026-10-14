import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchCustomerPhotos, uploadCustomerPhoto, deleteCustomerPhoto } from '../../../services/api';

// `compact` is used inside CustomerEditModal's Photo sub-tab (small space,
// keeps the dashed-tile-in-grid pattern). The default (full Photos tab)
// shows Timely's bigger "Let's add some photos" empty state instead.
const CustomerPhotosTab = ({ customerId, branchId, compact = false }) => {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchCustomerPhotos(customerId);
    if (!result.error) setPhotos(result.data || []);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const result = await uploadCustomerPhoto(customerId, branchId, file);
    setUploading(false);
    if (result.error) {
      setError(result.error.message || 'Failed to upload photo.');
      return;
    }
    load();
  };

  const handleDelete = async (photoId) => {
    setDeletingId(photoId);
    const result = await deleteCustomerPhoto(photoId);
    setDeletingId(null);
    if (result.error) {
      setError(result.error.message || 'Failed to delete photo.');
      return;
    }
    setPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  if (loading) {
    return (
      <div className="py-6 text-center">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      onChange={handleUpload}
      disabled={uploading}
      className="hidden"
    />
  );

  if (!compact && photos.length === 0) {
    return (
      <div className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
            <Icon name="AlertCircle" size={16} />
            <span>{error}</span>
          </div>
        )}
        <div className="flex flex-col items-center text-center py-16">
          <Icon name="Camera" size={48} className="text-text-tertiary mb-5" />
          <h3 className="font-accent text-2xl text-text-primary mb-2">Let's add some photos</h3>
          <p className="font-body text-sm text-text-secondary max-w-sm mb-5">
            Keep a record of this customer's progress to help you provide a consistent service and evidence of your great work.
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
          >
            {uploading ? 'Uploading...' : 'Add photo'}
          </button>
          <p className="font-caption text-xs text-text-tertiary mt-3">JPEG, PNG, WebP, GIF (max 2.0MB)</p>
          {hiddenInput}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {photos.map((p) => (
          <div key={p.id} className="relative group w-28 h-40 flex-shrink-0 rounded-spa overflow-hidden border border-border">
            <img src={p.photo_url} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => handleDelete(p.id)}
              disabled={deletingId === p.id}
              title="Remove photo"
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 hover:bg-error flex items-center justify-center spa-transition-fast opacity-0 group-hover:opacity-100"
            >
              <Icon name="Trash2" size={12} className="text-white" />
            </button>
          </div>
        ))}

        <label className="cursor-pointer flex flex-col items-center justify-center w-28 h-40 flex-shrink-0 border-2 border-dashed border-border rounded-spa hover:border-primary/50 hover:bg-primary/5 spa-transition-fast text-center">
          <Icon name="Upload" size={20} className="text-text-tertiary mb-1" />
          <span className="font-caption text-xs text-text-secondary px-2">{uploading ? 'Uploading...' : 'Add photo'}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleUpload} disabled={uploading} className="hidden" />
        </label>
      </div>
    </div>
  );
};

export default CustomerPhotosTab;
