import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import StaffSidebar from '../../components/ui/StaffSidebar';
import StaffTypeToggle from './components/StaffTypeToggle';
import StaffProfileSection from './components/StaffProfileSection';
import StaffServicesSection from './components/StaffServicesSection';
import WorkingHoursSection from './components/WorkingHoursSection';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { useOrg } from '../../contexts/OrgContext';
import { useIndustry } from '../../hooks/useIndustry';
import {
  fetchTherapistById,
  fetchTherapistsForManagement,
  fetchTherapistWorkingHours,
  upsertTherapistWorkingHours,
  createTherapist,
  updateTherapist,
  uploadStaffPhoto,
} from '../../services/api';

const EMPTY_FORM = { name: '', gender: 'Male', positions: [], specialties: '', isServiceStaff: true, photoUrl: '', bio: '', experienceYears: '', rating: '', phone: '', address: '', city: '' };

const DEFAULT_WORKING_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  dayLabel: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][dayOfWeek],
  startTime: null,
  endTime: null,
  isDayOff: true,
}));

const StaffDetailPage = () => {
  const navigate = useNavigate();
  const { orgSlug, staffId } = useParams();
  const { profile } = useAuth();
  const { branchId } = useBranch();
  const { enableStaffRatings } = useOrg();
  const { staffLabel } = useIndustry();
  const userRole = profile?.role || 'staff';
  const isEdit = !!staffId;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pageLoading, setPageLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState(null);
  const [allPositionNames, setAllPositionNames] = useState([]);

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [workingHours, setWorkingHours] = useState(DEFAULT_WORKING_HOURS);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const effectiveBranchId = profile?.role === 'manager' ? profile.branch_id : branchId;

  const loadPositionNames = useCallback(async () => {
    const { data } = await fetchTherapistsForManagement(effectiveBranchId);
    const names = new Set();
    (data || []).forEach(t => { if (t.position) t.position.split('/').forEach(p => names.add(p.trim())); });
    setAllPositionNames(Array.from(names).sort());
  }, [effectiveBranchId]);

  useEffect(() => { if (effectiveBranchId) loadPositionNames(); }, [effectiveBranchId, loadPositionNames]);

  const loadTherapist = useCallback(async () => {
    if (!isEdit) return;
    setPageLoading(true);
    setLoadError(null);

    const [therapistResult, hoursResult] = await Promise.all([
      fetchTherapistById(staffId),
      fetchTherapistWorkingHours(staffId),
    ]);

    if (therapistResult.error) {
      setLoadError(therapistResult.error.message || 'Failed to load staff member.');
      setPageLoading(false);
      return;
    }

    const t = therapistResult.data;
    setFormData({
      name: t.name,
      gender: t.gender || 'Male',
      positions: t.position ? t.position.split('/').map(p => p.trim()) : [],
      specialties: (t.specialties || []).join(', '),
      isServiceStaff: t.is_service_staff !== false,
      photoUrl: t.photo_url || '',
      bio: t.bio || '',
      experienceYears: t.experience_years != null ? String(t.experience_years) : '',
      rating: t.rating != null ? String(t.rating) : '',
      phone: t.phone || '',
      address: t.address || '',
      city: t.city || '',
    });
    setPhotoPreview(t.photo_url || null);

    if (hoursResult.data) setWorkingHours(hoursResult.data);

    setPageLoading(false);
  }, [isEdit, staffId]);

  useEffect(() => { loadTherapist(); }, [loadTherapist]);

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setFormError('Only JPEG, PNG, WebP, and GIF images are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError('Image must be less than 5MB.');
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setFormError(null);
  };

  const handleRemovePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    setFormData(f => ({ ...f, photoUrl: '' }));
  };

  const goBack = () => navigate(`/${orgSlug}/dashboard?view=therapists`);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setFormError('Staff name is required.');
      return;
    }

    setSaving(true);
    setFormError(null);

    const specialtiesArr = formData.specialties.split(',').map(s => s.trim()).filter(Boolean);

    let photoUrl = formData.photoUrl.trim();
    if (photoFile) {
      setUploadingPhoto(true);
      const uploadResult = await uploadStaffPhoto(photoFile);
      setUploadingPhoto(false);
      if (uploadResult.error) {
        setFormError(uploadResult.error.message || 'Failed to upload photo.');
        setSaving(false);
        return;
      }
      photoUrl = uploadResult.url;
    }

    const bio = formData.bio.trim();
    const experienceYears = formData.experienceYears === '' ? null : parseInt(formData.experienceYears, 10);
    const rating = formData.rating === '' ? null : parseFloat(formData.rating);
    const payload = {
      name: formData.name.trim(),
      gender: formData.gender,
      position: formData.isServiceStaff && formData.positions.length > 0 ? formData.positions.join('/') : null,
      specialties: formData.isServiceStaff ? specialtiesArr : [],
      isServiceStaff: formData.isServiceStaff,
      photoUrl,
      bio,
      experienceYears,
      rating: enableStaffRatings ? rating : undefined,
      phone: formData.phone.trim(),
      address: formData.address.trim(),
      city: formData.city.trim(),
    };

    const result = isEdit
      ? await updateTherapist({ therapistId: staffId, ...payload })
      : await createTherapist({ ...payload, branchId: effectiveBranchId });

    if (result.error) {
      setFormError(result.error.message || 'Operation failed.');
      setSaving(false);
      return;
    }

    const targetId = isEdit ? staffId : result.data.id;
    const hoursResult = await upsertTherapistWorkingHours(targetId, workingHours);
    if (hoursResult.error) {
      setFormError(hoursResult.error.message || 'Staff saved, but working hours failed to save.');
      setSaving(false);
      return;
    }

    setSaving(false);
    goBack();
  };

  return (
    <div className="min-h-screen bg-background">
      <StaffSidebar userRole={userRole} onCollapseChange={setSidebarCollapsed} />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'} lg:mb-0 mb-16 spa-transition-slow`}>
        {/* Breadcrumb header */}
        <div className="sticky top-0 z-header bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-heading text-lg">
            <button onClick={goBack} className="text-primary hover:underline font-heading-semibold">{staffLabel}</button>
            <Icon name="ChevronRight" size={18} className="text-text-tertiary" />
            <span className="font-heading-semibold text-text-primary">{isEdit ? `Edit ${staffLabel}` : `Add ${staffLabel}`}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goBack} disabled={saving}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>Save</Button>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
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
              <StaffTypeToggle
                isServiceStaff={formData.isServiceStaff}
                onChange={(val) => setFormData(f => ({ ...f, isServiceStaff: val }))}
              />
              <StaffProfileSection
                formData={formData}
                setFormData={setFormData}
                formError={formError}
                allPositionNames={allPositionNames}
                enableStaffRatings={enableStaffRatings}
                photoPreview={photoPreview}
                uploadingPhoto={uploadingPhoto}
                onPhotoChange={handlePhotoChange}
                onRemovePhoto={handleRemovePhoto}
              />
              {isEdit && formData.isServiceStaff && (
                <StaffServicesSection therapistId={staffId} branchId={effectiveBranchId} />
              )}
              <WorkingHoursSection rows={workingHours} onChange={setWorkingHours} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default StaffDetailPage;
