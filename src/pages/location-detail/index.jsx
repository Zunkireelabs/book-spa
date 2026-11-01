import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import StaffSidebar from '../../components/ui/StaffSidebar';
import SettingsRow from '../staff-detail/components/SettingsRow';
import BranchHoursEditor from './components/BranchHoursEditor';
import LocationPhotoField from './components/LocationPhotoField';
import { useAuth } from '../../contexts/AuthContext';
import { useOrg } from '../../contexts/OrgContext';
import {
  fetchBranchesForManagement,
  createBranch,
  updateBranchDetails,
  fetchBranchOpeningHours,
  upsertBranchOpeningHours,
  fetchBranchPhoto,
  uploadBranchPhoto,
  updateBranchPhoto,
} from '../../services/api';

const EMPTY_FORM = { name: '', address: '', phone: '', mapsUrl: '' };

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  dayLabel: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][dayOfWeek],
  startTime: null,
  endTime: null,
  isDayOff: true,
}));

const LocationDetailPage = () => {
  const navigate = useNavigate();
  const { orgSlug, branchId } = useParams();
  const { profile } = useAuth();
  const { orgId } = useOrg();
  const userRole = profile?.role || 'staff';
  const isEdit = !!branchId;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pageLoading, setPageLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState(null);

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadBranch = useCallback(async () => {
    if (!isEdit || !orgId) return;
    setPageLoading(true);
    setLoadError(null);

    const [branchesResult, photoResult, hoursResult] = await Promise.all([
      fetchBranchesForManagement(orgId),
      fetchBranchPhoto(branchId),
      fetchBranchOpeningHours(branchId),
    ]);

    if (branchesResult.error) {
      setLoadError(branchesResult.error.message || 'Failed to load location.');
      setPageLoading(false);
      return;
    }

    const branch = (branchesResult.data || []).find(b => b.id === branchId);
    if (!branch) {
      setLoadError('Location not found.');
      setPageLoading(false);
      return;
    }

    setFormData({
      name: branch.name || '',
      address: branch.address || '',
      phone: branch.phone || '',
      mapsUrl: branch.maps_url || '',
    });
    setPhotoPreview(photoResult.data?.photo_url || '');
    if (hoursResult.data) setHours(hoursResult.data);

    setPageLoading(false);
  }, [isEdit, orgId, branchId]);

  useEffect(() => { loadBranch(); }, [loadBranch]);

  const handlePhotoSelected = (file, validationError) => {
    if (validationError) { setFormError(validationError); return; }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setFormError(null);
  };

  const handleRemovePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview('');
  };

  const goBack = () => navigate(`/${orgSlug}/dashboard?view=locations`);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setFormError('Location name is required.');
      return;
    }

    setSaving(true);
    setFormError(null);

    const details = {
      name: formData.name.trim(),
      address: formData.address.trim() || null,
      phone: formData.phone.trim() || null,
      mapsUrl: formData.mapsUrl.trim() || null,
    };

    const result = isEdit
      ? await updateBranchDetails({ branchId, ...details })
      : await createBranch(details);

    if (result.error) {
      setFormError(result.error.message || 'Operation failed.');
      setSaving(false);
      return;
    }

    const targetBranchId = isEdit ? branchId : result.data?.id;

    let finalPhotoUrl = photoPreview;
    if (photoFile) {
      setUploadingPhoto(true);
      const uploadResult = await uploadBranchPhoto(targetBranchId, photoFile);
      setUploadingPhoto(false);
      if (uploadResult.error) {
        setFormError(uploadResult.error.message || 'Saved location, but failed to upload photo.');
        setSaving(false);
        return;
      }
      finalPhotoUrl = uploadResult.url;
    }

    const photoResult = await updateBranchPhoto(targetBranchId, finalPhotoUrl || null);
    if (photoResult.error) {
      setFormError(photoResult.error.message || 'Saved location, but failed to save photo.');
      setSaving(false);
      return;
    }

    const hoursResult = await upsertBranchOpeningHours(targetBranchId, hours);
    if (hoursResult.error) {
      setFormError(hoursResult.error.message || 'Saved location, but failed to save hours.');
      setSaving(false);
      return;
    }

    setSaving(false);
    goBack();
  };

  return (
    <div className="min-h-screen bg-surface">
      <StaffSidebar userRole={userRole} onCollapseChange={setSidebarCollapsed} />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'} lg:mb-0 mb-16 spa-transition-slow`}>
        <div className="sticky top-0 z-header bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 font-accent text-2xl">
            <button onClick={goBack} className="text-primary hover:underline">Locations</button>
            <Icon name="ChevronRight" size={20} className="text-text-tertiary" />
            <span className="text-text-primary">{isEdit ? 'Edit Location' : 'Add Location'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goBack} disabled={saving}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>Save</Button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
          {pageLoading ? (
            <div className="text-center py-20">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="font-body text-sm text-text-secondary">Loading...</p>
            </div>
          ) : loadError ? (
            <div className="flex items-center gap-2 p-4 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
              <Icon name="AlertCircle" size={16} />
              <span>{loadError}</span>
            </div>
          ) : (
            <>
              {formError && (
                <div className="flex items-center gap-2 p-4 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                  <Icon name="AlertCircle" size={16} />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <SettingsRow title="Location Details" description="Name, address, phone, and map link for this location.">
                  <div className="space-y-4 max-w-md">
                    <div>
                      <label className="block text-sm font-medium mb-1">Name</label>
                      <Input value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))} autoFocus />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Address</label>
                      <Input value={formData.address} onChange={e => setFormData(f => ({ ...f, address: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Phone</label>
                      <Input value={formData.phone} onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Map Link</label>
                      <Input value={formData.mapsUrl} onChange={e => setFormData(f => ({ ...f, mapsUrl: e.target.value }))} placeholder="https://maps.google.com/..." />
                    </div>
                  </div>
                </SettingsRow>

                <SettingsRow title="Weekly Opening Hours" description="Toggle each day on or off and set its open/close time. Shown to customers on the booking flow.">
                  <BranchHoursEditor rows={hours} onChange={setHours} />
                </SettingsRow>

                <SettingsRow title="Branch Photo" description="Shown on the storefront picker when a customer chooses between this location and your other branches. Leave empty to show a generic icon tile instead.">
                  <LocationPhotoField
                    preview={photoPreview}
                    onFileSelected={handlePhotoSelected}
                    onRemove={handleRemovePhoto}
                    uploading={uploadingPhoto}
                  />
                </SettingsRow>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocationDetailPage;
