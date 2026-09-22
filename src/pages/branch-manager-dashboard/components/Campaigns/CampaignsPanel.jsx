import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import {
  fetchCampaignsForManagement,
  fetchServicesForManagement,
  fetchCategoriesForManagement,
  createCampaign,
  updateCampaign,
  toggleCampaignActive,
  deleteCampaign,
  uploadCampaignBanner,
} from '../../../../services/api';

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// A campaign's real-world status is derived from is_active + today vs. its
// date window — not a stored column, so it can never drift out of sync.
function campaignStatus(campaign) {
  if (!campaign.is_active) return { label: 'Disabled', className: 'bg-text-secondary/10 text-text-secondary' };
  const today = toDateInputValue(new Date());
  if (today < campaign.start_date) return { label: 'Scheduled', className: 'bg-accent/10 text-accent' };
  if (today > campaign.end_date) return { label: 'Ended', className: 'bg-text-secondary/10 text-text-secondary' };
  return { label: 'Live', className: 'bg-success/10 text-success' };
}

const EMPTY_FORM = {
  name: '', message: '', bannerImageUrl: '', discountPercent: '',
  startDate: toDateInputValue(new Date()), endDate: toDateInputValue(new Date()),
  serviceIds: [], categoryIds: [],
};

const CampaignsPanel = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [campaignsResult, servicesResult, categoriesResult] = await Promise.all([
      fetchCampaignsForManagement(),
      fetchServicesForManagement(),
      fetchCategoriesForManagement(),
    ]);
    if (campaignsResult.error) {
      setError(campaignsResult.error.message || 'Failed to load campaigns.');
    } else {
      setCampaigns(campaignsResult.data || []);
    }
    setServices(servicesResult.data || []);
    setCategories(categoriesResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleOpenCreate = () => {
    setEditingCampaign(null);
    setFormData(EMPTY_FORM);
    setImageFile(null);
    setImagePreview(null);
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (campaign) => {
    setEditingCampaign(campaign);
    setFormData({
      name: campaign.name,
      message: campaign.message || '',
      bannerImageUrl: campaign.banner_image_url || '',
      discountPercent: String(campaign.discount_percent),
      startDate: campaign.start_date,
      endDate: campaign.end_date,
      serviceIds: campaign.service_ids || [],
      categoryIds: campaign.category_ids || [],
    });
    setImageFile(null);
    setImagePreview(campaign.banner_image_url || null);
    setFormError(null);
    setShowModal(true);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        setFormError('Only JPEG, PNG, WebP, and GIF images are allowed.');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setFormError('Image must be less than 5MB.');
        return;
      }
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setFormError(null);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData({ ...formData, bannerImageUrl: '' });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setFormError('Campaign name is required.');
      return;
    }
    const percent = Number(formData.discountPercent);
    if (!percent || percent <= 0 || percent >= 100) {
      setFormError('Discount percent must be between 1 and 99.');
      return;
    }
    if (!formData.startDate || !formData.endDate) {
      setFormError('Start and end dates are required.');
      return;
    }
    if (formData.endDate < formData.startDate) {
      setFormError('End date cannot be before the start date.');
      return;
    }
    if (formData.serviceIds.length === 0 && formData.categoryIds.length === 0) {
      setFormError('Pick at least one service or category for this campaign to apply to.');
      return;
    }

    setSaving(true);
    setFormError(null);

    let finalImageUrl = formData.bannerImageUrl.trim() || null;
    if (imageFile) {
      setUploading(true);
      const uploadResult = await uploadCampaignBanner(imageFile);
      setUploading(false);
      if (uploadResult.error) {
        setFormError(uploadResult.error.message || 'Failed to upload image.');
        setSaving(false);
        return;
      }
      finalImageUrl = uploadResult.url;
    }

    const payload = {
      name: formData.name.trim(),
      message: formData.message.trim() || null,
      bannerImageUrl: finalImageUrl,
      discountPercent: percent,
      startDate: formData.startDate,
      endDate: formData.endDate,
      serviceIds: formData.serviceIds,
      categoryIds: formData.categoryIds,
    };

    const result = editingCampaign
      ? await updateCampaign({ campaignId: editingCampaign.id, ...payload })
      : await createCampaign(payload);

    if (result.error) {
      setFormError(result.error.message || 'Save failed.');
    } else {
      setShowModal(false);
      await loadAll();
    }
    setSaving(false);
  };

  const handleToggle = async (campaign) => {
    setError(null);
    const result = await toggleCampaignActive({ campaignId: campaign.id, isActive: !campaign.is_active });
    if (result.error) {
      setError(result.error.message || 'Toggle failed.');
    } else {
      await loadAll();
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    const result = await deleteCampaign({ campaignId: confirmDelete.id });
    if (result.error) {
      setError(result.error.message || 'Delete failed.');
    } else {
      await loadAll();
    }
    setConfirmDelete(null);
    setDeleting(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading campaigns...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Campaigns</h3>
          <p className="font-body text-sm text-text-secondary">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} — named promotions for specific services/categories on specific days
          </p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={handleOpenCreate}>
          Add Campaign
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Name</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Dates</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Discount</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">Applies to</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  No campaigns yet. Click "Add Campaign" to create one.
                </td>
              </tr>
            ) : (
              campaigns.map((c) => {
                const status = campaignStatus(c);
                const linkedCount = (c.service_ids?.length || 0) + (c.category_ids?.length || 0);
                return (
                  <tr key={c.id} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                    <td className="px-4 py-3 font-body font-body-medium text-sm text-text-primary">{c.name}</td>
                    <td className="px-4 py-3 font-body text-sm text-text-secondary">{formatDate(c.start_date)} – {formatDate(c.end_date)}</td>
                    <td className="px-4 py-3 font-data text-sm text-text-primary">{c.discount_percent}%</td>
                    <td className="px-4 py-3 font-body text-sm text-text-secondary hidden md:table-cell">
                      {c.category_ids?.length > 0 && `${c.category_ids.length} categor${c.category_ids.length !== 1 ? 'ies' : 'y'}`}
                      {c.category_ids?.length > 0 && c.service_ids?.length > 0 && ', '}
                      {c.service_ids?.length > 0 && `${c.service_ids.length} service${c.service_ids.length !== 1 ? 's' : ''}`}
                      {linkedCount === 0 && '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenEdit(c)}
                          className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                          title="Edit"
                        >
                          <Icon name="Pencil" size={16} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(c)}
                          className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                          title="Delete"
                        >
                          <Icon name="Trash2" size={16} />
                        </button>
                        <button
                          onClick={() => handleToggle(c)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                            c.is_active ? 'bg-success' : 'bg-border'
                          }`}
                          title={c.is_active ? 'Disable' : 'Enable'}
                        >
                          <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                            c.is_active ? 'translate-x-6' : 'translate-x-1'
                          }`} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                {editingCampaign ? 'Edit Campaign' : 'Add Campaign'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Campaign Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Dashain Offer"
                />
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">
                  Message <span className="text-text-tertiary font-normal">(optional banner text)</span>
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Celebrate with us — special prices for a limited time"
                  rows={2}
                  className="w-full rounded-spa border border-border bg-background px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary spa-transition-fast resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-body font-body-medium text-sm text-text-primary">Start Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-body font-body-medium text-sm text-text-primary">End Date</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Discount %</label>
                <Input
                  type="number"
                  value={formData.discountPercent}
                  onChange={(e) => setFormData({ ...formData, discountPercent: e.target.value })}
                  placeholder="e.g. 20"
                  min="1"
                  max="99"
                />
                <p className="font-caption text-xs text-text-secondary">
                  Overrides any manual offer on the services/categories below while the campaign is live.
                </p>
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">
                  Categories{formData.categoryIds.length > 0 && <span className="ml-1 text-xs text-text-secondary font-normal">({formData.categoryIds.length} selected)</span>}
                </label>
                <div className="border border-border rounded-spa bg-background max-h-[120px] overflow-y-auto p-2 space-y-1">
                  {categories.length === 0 ? (
                    <p className="text-xs text-text-secondary px-2 py-1">No categories yet.</p>
                  ) : (
                    categories.map((cat) => (
                      <label key={cat.id} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-primary/5 ${formData.categoryIds.includes(cat.id) ? 'bg-primary/5' : ''}`}>
                        <input
                          type="checkbox"
                          checked={formData.categoryIds.includes(cat.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData((f) => ({ ...f, categoryIds: [...f.categoryIds, cat.id] }));
                            } else {
                              setFormData((f) => ({ ...f, categoryIds: f.categoryIds.filter((id) => id !== cat.id) }));
                            }
                          }}
                          className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                        />
                        <span className="font-body text-sm text-text-primary">{cat.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">
                  Individual Services{formData.serviceIds.length > 0 && <span className="ml-1 text-xs text-text-secondary font-normal">({formData.serviceIds.length} selected)</span>}
                </label>
                <div className="border border-border rounded-spa bg-background max-h-[160px] overflow-y-auto p-2 space-y-1">
                  {services.length === 0 ? (
                    <p className="text-xs text-text-secondary px-2 py-1">No services yet.</p>
                  ) : (
                    services.map((svc) => (
                      <label key={svc.id} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-primary/5 ${formData.serviceIds.includes(svc.id) ? 'bg-primary/5' : ''}`}>
                        <input
                          type="checkbox"
                          checked={formData.serviceIds.includes(svc.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData((f) => ({ ...f, serviceIds: [...f.serviceIds, svc.id] }));
                            } else {
                              setFormData((f) => ({ ...f, serviceIds: f.serviceIds.filter((id) => id !== svc.id) }));
                            }
                          }}
                          className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                        />
                        <span className="font-body text-sm text-text-primary">{svc.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Banner image */}
              <div className="space-y-2">
                <label className="block font-body font-body-medium text-sm text-text-primary">
                  Banner Image <span className="text-text-tertiary font-normal">(optional)</span>
                </label>

                {imagePreview ? (
                  <div className="flex items-start gap-3">
                    <div className="relative w-24 h-24 rounded-spa overflow-hidden border border-border flex-shrink-0">
                      <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-background hover:bg-background/80 spa-transition-fast text-sm text-text-secondary">
                        <Icon name="RefreshCw" size={14} />
                        Replace
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleImageChange} className="hidden" />
                      </label>
                      <button
                        type="button"
                        onClick={handleRemoveImage}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-error/30 bg-error/5 hover:bg-error/10 spa-transition-fast text-sm text-error"
                      >
                        <Icon name="Trash2" size={14} />
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="cursor-pointer flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-border rounded-spa hover:border-primary/50 hover:bg-primary/5 spa-transition-fast">
                    <Icon name="Upload" size={20} className="text-text-tertiary mb-1" />
                    <span className="font-body text-sm text-text-secondary">Click to upload image</span>
                    <span className="font-caption text-xs text-text-tertiary mt-1">No image? The banner just shows text.</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleImageChange} className="hidden" />
                  </label>
                )}

                {uploading && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                    Uploading image...
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {editingCampaign ? 'Save Changes' : 'Create Campaign'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="Trash2" size={20} className="text-error" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Delete Campaign?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmDelete.name}" will be permanently deleted. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CampaignsPanel;
