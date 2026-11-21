import PhoneField, { usePhoneState } from '../../components/ui/PhoneField';
import { friendlyError } from '../../utils/friendlyError';
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBranch } from '../../contexts/BranchContext';
import Icon from '../../components/AppIcon';
import { Field, TextInput, InlineError } from '../../components/ui/PanelFormKit';
import StaffSidebar from '../../components/ui/StaffSidebar';
import BranchHoursEditor, { closesBeforeOpens } from './components/BranchHoursEditor';
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

const SECTION = 'border border-border rounded-spa-lg bg-surface p-4 max-lg:p-3.5';
const SECTION_TITLE = 'font-heading font-heading-semibold text-sm text-text-primary';
const SECTION_HINT = 'mt-0.5 mb-3 text-xs text-text-secondary';

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
  const { refreshBranches } = useBranch();
  const { profile } = useAuth();
  const { orgId } = useOrg();
  const userRole = profile?.role || 'staff';
  const isEdit = !!branchId;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pageLoading, setPageLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState(null);

  const [formData, setFormData] = useState(EMPTY_FORM);
  const phone = usePhoneState('', { kind: 'business' }); // a branch line: length check only, landlines pass
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
      setLoadError(`Couldn't load this location. Try again.`);
      setPageLoading(false);
      return;
    }

    const branch = (branchesResult.data || []).find(b => b.id === branchId);
    if (!branch) {
      setLoadError(`This location was not found.`);
      setPageLoading(false);
      return;
    }

    setFormData({
      name: branch.name || '',
      address: branch.address || '',
      phone: branch.phone || '',
      mapsUrl: branch.maps_url || '',
    });
    phone.reset(branch.phone || '');
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
      setFormError('Name is required.');
      return;
    }

    if (phone.problem) { setFormError(phone.problem); return; }

    // B7: refuse before anything is written (hours used to be checked last, after the location was already saved).
    const badDay = hours.find(closesBeforeOpens);
    if (badDay) {
      setFormError(`${badDay.dayLabel} closes before it opens. Fix the hours to save.`);
      return;
    }

    setSaving(true);
    setFormError(null);

    const details = {
      name: formData.name.trim(),
      address: formData.address.trim() || null,
      phone: phone.value || null,
      mapsUrl: formData.mapsUrl.trim() || null,
    };

    const result = isEdit
      ? await updateBranchDetails({ branchId, ...details })
      : await createBranch(details);

    if (result.error) {
      setFormError(friendlyError(result.error, 'Operation failed.'));
      setSaving(false);
      return;
    }

    const targetBranchId = isEdit ? branchId : result.data?.id;
    // The location row exists now (even if the photo/hours steps below fail): refresh the header's location list.
    await refreshBranches();

    let finalPhotoUrl = photoPreview;
    if (photoFile) {
      setUploadingPhoto(true);
      const uploadResult = await uploadBranchPhoto(targetBranchId, photoFile);
      setUploadingPhoto(false);
      if (uploadResult.error) {
        setFormError(friendlyError(uploadResult.error, 'Saved location, but failed to upload photo.'));
        setSaving(false);
        return;
      }
      finalPhotoUrl = uploadResult.url;
    }

    const photoResult = await updateBranchPhoto(targetBranchId, finalPhotoUrl || null);
    if (photoResult.error) {
      setFormError(friendlyError(photoResult.error, 'Saved location, but failed to save photo.'));
      setSaving(false);
      return;
    }

    const hoursResult = await upsertBranchOpeningHours(targetBranchId, hours);
    if (hoursResult.error) {
      setFormError(friendlyError(hoursResult.error, 'Saved location, but failed to save hours.'));
      setSaving(false);
      return;
    }

    setSaving(false);
    goBack();
  };

  const pageTitle = `${isEdit ? 'Edit' : 'Add'} location`;
  return (
    <div className="min-h-screen bg-background">
      <StaffSidebar userRole={userRole} onCollapseChange={setSidebarCollapsed} />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'} lg:mb-0 mb-16 spa-transition-slow`}>
        <div className="sticky top-0 z-header bg-surface border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0 text-[13px] font-body">
            <button type="button" onClick={goBack} className="text-primary hover:underline h-9 max-lg:h-11 px-1 flex items-center gap-1 flex-shrink-0">
              <Icon name="ChevronLeft" size={16} />Locations
            </button>
            <Icon name="ChevronRight" size={14} className="text-text-tertiary flex-shrink-0" />
            <h1 className="font-heading font-heading-semibold text-[15px] text-text-primary truncate">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={goBack} disabled={saving} className="h-9 max-lg:h-11 px-3.5 rounded-spa border border-border text-[13px] font-body-medium text-text-primary hover:bg-background disabled:opacity-50">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving || pageLoading || !!loadError} className="h-9 max-lg:h-11 px-4 rounded-spa bg-primary text-white text-[13px] font-body-medium hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-4">
          {pageLoading ? (
            <div className="space-y-4">{[0, 1, 2].map(i => <div key={i} className="h-32 rounded-spa-lg bg-surface animate-pulse" />)}</div>
          ) : loadError ? (
            <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 bg-error/10 border border-error/20 rounded-spa text-error text-[13px]">
              <span>{loadError}</span>
              <button type="button" onClick={loadBranch} className="underline font-body-medium h-9 max-lg:h-11 px-2">Retry</button>
            </div>
          ) : (
            <>
              <InlineError message={formError} />

              <section className={SECTION}>
                <h2 className={SECTION_TITLE}>Photo</h2>
                <p className={SECTION_HINT}>Shown on the booking page when customers choose between your locations. Leave empty for a plain icon tile.</p>
                <LocationPhotoField
                  preview={photoPreview}
                  onFileSelected={handlePhotoSelected}
                  onRemove={handleRemovePhoto}
                  uploading={uploadingPhoto}
                />
              </section>

              <section className={SECTION}>
                <h2 className={SECTION_TITLE}>Details</h2>
                <div className="mt-3 space-y-4">
                  <Field label="Name" required id="loc-name">
                    <TextInput id="loc-name" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))} autoFocus />
                  </Field>
                  <Field label="Address" id="loc-address">
                    <TextInput id="loc-address" value={formData.address} onChange={e => setFormData(f => ({ ...f, address: e.target.value }))} />
                  </Field>
                  <Field label="Phone" id="loc-phone">
                    <PhoneField {...phone.field} id="loc-phone" kind="business" />
                  </Field>
                  <Field label="Map link" id="loc-map" hint="Optional. Customers get this on their confirmation.">
                    <TextInput id="loc-map" value={formData.mapsUrl} onChange={e => setFormData(f => ({ ...f, mapsUrl: e.target.value }))} placeholder="https://maps.google.com/..." />
                  </Field>
                </div>
              </section>

              <section className={SECTION}>
                <h2 className={SECTION_TITLE}>Opening hours</h2>
                <p className={SECTION_HINT}>Turn each day on or off and set when it opens and closes. Customers see these when they book.</p>
                <BranchHoursEditor rows={hours} onChange={setHours} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocationDetailPage;
