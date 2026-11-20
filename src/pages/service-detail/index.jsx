import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import AppShell from '../../components/ui/AppShell';
import { Field, TextInput, NumberInput } from '../../components/ui/PanelFormKit';
import { categoryOptions, isCategoryMissing, categoryForSave } from '../../utils/serviceCategory';
import CustomSelect from '../../components/ui/CustomSelect';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch, OVERALL_BRANCH_ID } from '../../contexts/BranchContext';
import { friendlyError } from '../../utils/friendlyError';
import { useOrg } from '../../contexts/OrgContext';
import { useIndustry } from '../../hooks/useIndustry';
import {
  fetchServicesForManagement,
  fetchActiveCategories,
  createService,
  updateServicePricing,
  uploadServiceImage,
  fetchTherapistsForManagement,
  fetchServiceTherapists,
  setServiceTherapists,
  fetchServiceComboComponents,
  setServiceComboComponents,
  fetchServiceAddons,
  setServiceAddons,
  fetchBranchesForManagement,
  fetchServiceBranches,
  setServiceBranches,
  fetchPriceTiers,
  fetchTherapistsForTierAssignment,
  fetchServiceTierPrices,
  setServiceTierPrices,
  deleteService,
} from '../../services/api';
import { wordBranch } from '../../utils/industryTerms';

const EMPTY_FORM = {
  name: '', priceNpr: '', priceType: 'fixed', durationMinutes: '', description: '', imageUrl: '', category: '',
  isCouple: false, isCombo: false, offerEnabled: false, offerType: 'percent', offerValue: '',
  requiresTherapist: true,
  bookableOnline: true, isAddon: false,
  paddingEnabled: false, paddingBeforeMinutes: '0', paddingAfterMinutes: '0', paddingAfterType: 'padding',
};

const PRICE_TYPE_OPTIONS = [
  { value: 'fixed', label: 'Fixed — one price for everyone' },
  { value: 'free', label: 'Free — no charge' },
  { value: 'calendar_only', label: 'Calendar only — hidden from online booking' },
  { value: 'no_default', label: 'No default — whoever books it enters a price' },
  { value: 'tiered', label: 'Tiered: depends on who does it' },
];

// One form-kit card per section: title, one-line description, body (replaces the old two-column SettingsRow).
const SettingsRow = ({ id, title, description, children }) => (
  <section id={id} className="bg-surface border border-border rounded-spa-lg p-5 space-y-4">
    <div>
      <h3 className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-text-tertiary">{title}</h3>
      {description && <p className="mt-1 text-[12.5px] text-text-secondary leading-relaxed">{description}</p>}
    </div>
    {children}
  </section>
);

const formatNPR = (amount) => `NPR ${Number(amount).toLocaleString('en-IN')}`;

// Dedicated Add/Edit Service page, mirroring staff-detail's page structure (one page,
// :serviceId present = edit, absent (/services/new) = create) instead of the cramped
// max-w-md modal this replaced.
const ServiceDetailPage = () => {
  const navigate = useNavigate();
  const { orgSlug, serviceId } = useParams();
  const { profile } = useAuth();
  const { branchId } = useBranch();
  // The staff allow-list is stored per location (uuid). Under "All locations" ('__overall__') or before any
  // location exists (null) there is no single location to write it to, so staff scope is left untouched there.
  const staffScopeBranchId = branchId && branchId !== OVERALL_BRANCH_ID ? branchId : null;
  const savingRef = useRef(false);
  const { orgId } = useOrg();
  const { isBeauty, staffLabel, staffLabelPlural, locationLabel, enableRooms, examples, branchWord, branchWordPlural } = useIndustry();
  const userRole = profile?.role || 'staff';
  const isEdit = !!serviceId;

  const [pageLoading, setPageLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState(null);

  const [categories, setCategories] = useState([]);
  const [allTherapists, setAllTherapists] = useState([]);
  const [eligibleTherapistIds, setEligibleTherapistIds] = useState([]);
  const [restrictStaff, setRestrictStaff] = useState(false);
  const [staffSearchQuery, setStaffSearchQuery] = useState('');

  const [allBranches, setAllBranches] = useState([]);
  const [eligibleBranchIds, setEligibleBranchIds] = useState([]);
  const [restrictBranches, setRestrictBranches] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState('');

  const [allServices, setAllServices] = useState([]);
  // comboComponents: [{ serviceId, defaultTiming: 'sequential'|'concurrent', defaultSameStaff: bool }]
  const [comboComponents, setComboComponents] = useState([]);
  const [comboSearchQuery, setComboSearchQuery] = useState('');

  const [serviceAddonIds, setServiceAddonIds] = useState([]);
  const [addonSearchQuery, setAddonSearchQuery] = useState('');

  const [priceTiers, setPriceTiers] = useState([]);
  // { [tierId]: '160' } — a tier left out means "the standard price", never 0.
  const [tierPrices, setTierPrices] = useState({});

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [originalCategory, setOriginalCategory] = useState(''); // the stored category when the editor opened (so an untouched one is never rewritten)
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadCategories = useCallback(async () => {
    const result = await fetchActiveCategories();
    if (!result.error) setCategories(result.data || []);
  }, []);

  const loadTherapists = useCallback(async () => {
    if (!staffScopeBranchId) return;
    const result = await fetchTherapistsForManagement(staffScopeBranchId);
    // Eligible Staff only makes sense for staff who actually perform services —
    // fetchTherapistsForManagement returns every staff row (service staff and
    // front-desk/admin alike) for the broader staff-management pages that share
    // it; filter to service staff here, scoped to this one picker.
    if (!result.error) setAllTherapists((result.data || []).filter(t => t.is_service_staff !== false));
  }, [staffScopeBranchId]);

  const loadAllServices = useCallback(async () => {
    const result = await fetchServicesForManagement();
    if (!result.error) setAllServices(result.data || []);
  }, []);

  const loadBranches = useCallback(async () => {
    if (!orgId) return;
    const result = await fetchBranchesForManagement(orgId);
    if (!result.error) setAllBranches(result.data || []);
  }, [orgId]);

  const [tierStaffCounts, setTierStaffCounts] = useState({});
  const loadPriceTiers = useCallback(async () => {
    const [result, staff] = await Promise.all([fetchPriceTiers(), fetchTherapistsForTierAssignment()]);
    if (!result.error) setPriceTiers(result.data || []);
    const counts = {};
    (staff.data || []).forEach((t) => { if (t.price_tier_id) counts[t.price_tier_id] = (counts[t.price_tier_id] || 0) + 1; });
    setTierStaffCounts(counts);
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadTherapists(); }, [loadTherapists]);
  useEffect(() => { loadAllServices(); }, [loadAllServices]);
  useEffect(() => { loadBranches(); }, [loadBranches]);
  useEffect(() => { loadPriceTiers(); }, [loadPriceTiers]);

  const loadService = useCallback(async () => {
    if (!isEdit) return;
    setPageLoading(true);
    setLoadError(null);

    // No fetchServiceById endpoint — fetchServicesForManagement() is the same org-wide
    // list the Service Management page already loads, so reusing it here needs no new API.
    const [servicesResult, eligibleResult, comboResult, addonsResult, branchScopeResult, tierPricesResult] = await Promise.all([
      fetchServicesForManagement(),
      staffScopeBranchId ? fetchServiceTherapists(serviceId, staffScopeBranchId) : Promise.resolve({ data: [], error: null }),
      fetchServiceComboComponents(serviceId),
      fetchServiceAddons(serviceId),
      fetchServiceBranches(serviceId),
      fetchServiceTierPrices(serviceId),
    ]);

    if (servicesResult.error) {
      setLoadError(friendlyError(servicesResult.error, 'Failed to load service.'));
      setPageLoading(false);
      return;
    }

    const service = (servicesResult.data || []).find((s) => s.id === serviceId);
    if (!service) {
      setLoadError('Service not found.');
      setPageLoading(false);
      return;
    }

    setOriginalCategory(service.category ?? '');
    setFormData({
      name: service.name,
      priceNpr: String(service.price_npr),
      priceType: service.price_type || 'fixed',
      durationMinutes: String(service.duration_minutes),
      description: service.description || '',
      imageUrl: service.image_url || '',
      category: service.category || '',
      isCouple: !!service.is_couple,
      isCombo: !!service.is_combo,
      offerEnabled: !!service.offer_enabled,
      offerType: service.offer_type || 'percent',
      offerValue: service.offer_value != null ? String(service.offer_value) : '',
      requiresTherapist: service.requires_therapist !== false,
      bookableOnline: service.bookable_online !== false,
      isAddon: !!service.is_addon,
      paddingEnabled: (service.padding_before_minutes || 0) > 0 || (service.padding_after_minutes || 0) > 0,
      paddingBeforeMinutes: String(service.padding_before_minutes || 0),
      paddingAfterMinutes: String(service.padding_after_minutes || 0),
      paddingAfterType: service.padding_after_type || 'padding',
    });
    setImagePreview(service.image_url || null);
    setServiceAddonIds(addonsResult.data || []);

    const tierPriceMap = {};
    (tierPricesResult.data || []).forEach((row) => { tierPriceMap[row.price_tier_id] = String(row.price_npr); });
    setTierPrices(tierPriceMap);

    // branchId filters server-side (migration-257/258 made the allow-list per-branch,
    // but storage is still org-wide) — a service restricted only at a different branch
    // comes back empty here, so the checkboxes reflect only what a save at this branch
    // would actually write.
    const ids = eligibleResult.data || [];
    setEligibleTherapistIds(ids);
    setRestrictStaff(ids.length > 0);

    setComboComponents(
      (comboResult.data || []).map((c) => ({ serviceId: c.serviceId, defaultTiming: c.defaultTiming, defaultSameStaff: c.defaultSameStaff, defaultSameRoom: c.defaultSameRoom }))
    );

    const branchIds = branchScopeResult.data || [];
    setEligibleBranchIds(branchIds);
    setRestrictBranches(branchIds.length > 0);

    setPageLoading(false);
  }, [isEdit, serviceId, staffScopeBranchId]);

  useEffect(() => { loadService(); }, [loadService]);
  useEffect(() => { window.scrollTo(0, 0); document.querySelectorAll('main, [data-scroll-root]').forEach((el) => { el.scrollTop = 0; }); }, [serviceId]);

  // Category defaults to the first available one once categories load, for the create path.
  useEffect(() => {
    if (!isEdit && !formData.category && categories.length > 0) {
      setFormData((f) => ({ ...f, category: categories[0].name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, isEdit]);

  const handleImageChange = (e) => {
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
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setFormError(null);
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData((f) => ({ ...f, imageUrl: '' }));
  };

  const goBack = () => navigate(`/${orgSlug}/dashboard?view=services`);

  const priceNeedsAmount = ['fixed', 'calendar_only', 'tiered'].includes(formData.priceType);
  const goManageTiers = () => navigate(`/${orgSlug}/dashboard?view=price-tiers`);
  // "NPR 1,500 – 2,800": the standard price and every tier price (a blank tier charges the standard price), as customers see it online.
  const onlineRange = (() => {
    const std = Number(formData.priceNpr);
    if (formData.priceType !== 'tiered' || !std || std <= 0 || priceTiers.length === 0) return null;
    const all = [std, ...priceTiers.map((t) => { const v = Number(tierPrices[t.id]); return tierPrices[t.id] !== undefined && tierPrices[t.id] !== '' && v >= 0 ? v : std; })];
    const lo = Math.min(...all); const hi = Math.max(...all);
    return lo === hi ? formatNPR(lo) : `${formatNPR(lo)} \u2013 ${Number(hi).toLocaleString('en-IN')}`;
  })();

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try { await doSave(); } finally { savingRef.current = false; }
  };

  const doSave = async () => {
    const price = priceNeedsAmount ? Number(formData.priceNpr) : 0;
    const duration = Number(formData.durationMinutes);

    if (!formData.name.trim()) { setFormError('Service name is required.'); return; }
    if (priceNeedsAmount && (!price || price <= 0)) {
      setFormError(formData.priceType === 'tiered' ? 'The standard price must be a positive number.' : 'Price must be a positive number.');
      return;
    }
    if (!duration || duration <= 0 || !Number.isInteger(duration)) { setFormError('Duration must be a positive whole number.'); return; }
    if (restrictStaff && formData.requiresTherapist && !staffScopeBranchId) { setFormError('Pick a single location in the switcher at the top to choose which staff can do this service.'); return; }
    if (formData.isCombo && comboComponents.length === 0) { setFormError('Select at least one component service for this combo.'); return; }

    let offerValueNum = null;
    if (formData.offerEnabled) {
      offerValueNum = Number(formData.offerValue);
      if (!offerValueNum || offerValueNum <= 0) { setFormError('Offer value must be a positive number.'); return; }
      if (formData.offerType === 'percent' && offerValueNum >= 100) { setFormError('Offer percentage must be less than 100.'); return; }
      if (formData.offerType === 'fixed' && offerValueNum >= price) { setFormError('Fixed offer price must be less than the regular price.'); return; }
    }

    setSaving(true);
    setFormError(null);

    let finalImageUrl = formData.imageUrl.trim() || null;
    if (imageFile) {
      setUploadingImage(true);
      const uploadResult = await uploadServiceImage(imageFile);
      setUploadingImage(false);
      if (uploadResult.error) {
        setFormError(friendlyError(uploadResult.error, 'Failed to upload image.'));
        setSaving(false);
        return;
      }
      finalImageUrl = uploadResult.url;
    }

    const payload = {
      name: formData.name.trim(),
      priceNpr: price,
      priceType: formData.priceType,
      durationMinutes: duration,
      description: formData.description.trim() || null,
      imageUrl: finalImageUrl,
      category: categoryForSave({ isEdit, current: formData.category, original: originalCategory }),
      isCouple: formData.isCouple,
      isCombo: formData.isCombo,
      offerEnabled: formData.offerEnabled,
      offerType: formData.offerEnabled ? formData.offerType : null,
      offerValue: formData.offerEnabled ? offerValueNum : null,
      requiresTherapist: formData.requiresTherapist,
      bookableOnline: formData.bookableOnline,
      isAddon: formData.isAddon,
      paddingBeforeMinutes: formData.paddingEnabled ? (Number(formData.paddingBeforeMinutes) || 0) : 0,
      paddingAfterMinutes: formData.paddingEnabled ? (Number(formData.paddingAfterMinutes) || 0) : 0,
      paddingAfterType: formData.paddingAfterType,
    };

    const result = isEdit
      ? await updateServicePricing({ serviceId, ...payload })
      : await createService(payload);

    if (result.error) {
      setFormError(friendlyError(result.error, 'Save failed.'));
      setSaving(false);
      return;
    }

    const targetId = isEdit ? serviceId : result.data?.id;
    if (!targetId) {
      setFormError('Service saved, but its id was not returned — eligible staff could not be saved. Reopen it to configure eligible staff.');
      setSaving(false);
      return;
    }

    // Anything after the service row exists must not leave a half-saved service behind. On create the new row
    // (children cascade) is removed so a retry cannot duplicate it; on edit the row already existed, so say what failed.
    const failStep = async (err, what) => {
      if (!isEdit) {
        const rollback = await deleteService({ serviceId: targetId });
        const why = friendlyError(err, `Could not save ${what}.`).replace(/[.!?]?$/, '.');
        setFormError(`${why}${rollback.error ? ' A partly saved service may remain in Services - check before retrying.' : ' Nothing was saved.'}`);
      } else {
        setFormError(`Saved, but ${what} failed: ${friendlyError(err, 'please try again.')}`);
      }
      setSaving(false);
    };

    // Staff allow-list: nothing to write for a brand-new unrestricted service, and no single location to write it
    // to under "All locations" - an existing per-location list is left as it is there.
    if (staffScopeBranchId && (isEdit || restrictStaff)) {
      const staffResult = await setServiceTherapists(targetId, restrictStaff ? eligibleTherapistIds : [], staffScopeBranchId);
      if (staffResult.error) return failStep(staffResult.error, 'eligible staff');
    }

    // Always write the combo bundle (even an empty list when isCombo was turned off) —
    // otherwise toggling combo off after having set components would leave stale rows.
    const comboResult = await setServiceComboComponents(targetId, formData.isCombo ? comboComponents : []);
    if (comboResult.error) return failStep(comboResult.error, 'the combo bundle');

    const addonsResult = await setServiceAddons(targetId, serviceAddonIds);
    if (addonsResult.error) return failStep(addonsResult.error, 'its add-ons');

    // Always write the tier price set (even empty when price type isn't tiered
    // anymore) — otherwise switching away from Tiered would leave stale rows
    // that resurface if the service is switched back.
    const tierPriceEntries = formData.priceType === 'tiered'
      ? priceTiers
          .filter((t) => tierPrices[t.id] !== undefined && tierPrices[t.id] !== '')
          .map((t) => ({ priceTierId: t.id, priceNpr: tierPrices[t.id] }))
      : [];
    const tierPriceResult = await setServiceTierPrices(targetId, tierPriceEntries);
    if (tierPriceResult.error) return failStep(tierPriceResult.error, 'its tier prices');

    const branchScopeResult = await setServiceBranches(targetId, restrictBranches ? eligibleBranchIds : []);
    if (branchScopeResult.error) return failStep(branchScopeResult.error, `its ${wordBranch()} scope`);

    setSaving(false);
    goBack();
  };

  const selectedCategory = categories.find((c) => c.name === formData.category);

  return (
    <AppShell variant="page" sidebar={{ userRole }} header={{ realtimeStatus: 'connected' }}>
      <div className="max-w-3xl mx-auto space-y-4 pb-24">
        <nav className="flex items-center gap-1.5 text-sm text-text-secondary" aria-label="Breadcrumb">
          <button type="button" onClick={goBack} className="inline-flex items-center gap-1 hover:text-text-primary"><Icon name="ChevronLeft" size={14} />Services</button>
          <span>/</span>
          <span className="text-text-primary truncate">{isEdit ? (formData.name || 'Edit service') : 'New service'}</span>
        </nav>
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 min-w-[200px] font-heading font-heading-semibold text-2xl text-text-primary truncate">{isEdit ? (formData.name || 'Edit service') : 'New service'}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goBack} disabled={saving}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={saving}>{isEdit ? 'Save service' : 'Create service'}</Button>
          </div>
        </header>

        <div className="space-y-4">
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

              <div className="p-3 bg-accent/5 border border-accent/20 rounded-spa">
                <p className="font-caption text-xs text-accent flex items-center gap-1.5">
                  <Icon name="Info" size={14} />
                  {isEdit
                    ? `Changes apply to new appointments. Booked ones keep their price unless their ${staffLabel.toLowerCase()} or time changes before payment.`
                    : `New services will be immediately available for booking across all ${branchWordPlural}.`}
                </p>
              </div>

              <div className="space-y-4">
                <SettingsRow title="Basics" description="Name, category and duration shown to customers when booking.">
                  <div className="space-y-4 max-w-xl">
                    <Field label="Name" id="svc-name">
                      <TextInput id="svc-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder={`e.g. ${examples.service}`} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Category">
                        <CustomSelect
                          value={formData.category}
                          onChange={(val) => setFormData({ ...formData, category: val })}
                          options={categoryOptions(categories, formData.category)}
                          size="md"
                        />
                        {isEdit && isCategoryMissing(categories, formData.category) && (
                          <p className="mt-1 text-xs text-text-secondary">
                            Not in your Categories list · <Link to={`/${orgSlug}/dashboard?view=categories`} className="text-primary hover:underline">Add it</Link>
                          </p>
                        )}
                      </Field>
                      <Field label="Duration (min)" id="svc-duration">
                        <NumberInput id="svc-duration" value={formData.durationMinutes} onChange={(e) => setFormData({ ...formData, durationMinutes: e.target.value })} placeholder="60" min="1" />
                      </Field>
                    </div>
                    <Field label="Description" id="svc-description">
                      <textarea
                        id="svc-description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Service description..."
                        rows={3}
                        className="w-full rounded-spa border border-border bg-surface px-3 py-2 font-body text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      />
                    </Field>
                    {!isBeauty && (
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={formData.isCouple} onChange={(e) => setFormData({ ...formData, isCouple: e.target.checked })} className="accent-primary w-4 h-4 rounded" />
                          <span className="font-body font-body-medium text-sm text-text-primary">Couple service (priced for two)</span>
                        </label>
                        <p className="mt-1 text-xs text-text-secondary">
                          For two people at once, with two {staffLabelPlural.toLowerCase()}. Not offered in group bookings, where it would charge twice.
                        </p>
                      </div>
                    )}
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={formData.isCombo} onChange={(e) => setFormData({ ...formData, isCombo: e.target.checked })} className="accent-primary w-4 h-4 rounded" />
                        <span className="font-body font-body-medium text-sm text-text-primary">Combo service (bundle of other services)</span>
                      </label>
                      <p className="mt-1 text-xs text-text-secondary">
                        Pick which services make up the bundle below. This service's own price/duration
                        still apply at booking; the components only drive who is assigned and when.
                      </p>
                    </div>
                  </div>
                </SettingsRow>

                <SettingsRow title="Pricing" description="What this service costs, and whether it depends on who does it.">
                  <div className="space-y-4 max-w-xl" data-pricing-section>
                    <Field label="Price type" hint="Fixed · Free · Tiered · Calendar only (not offered online) · No default (price entered when booked).">
                      <CustomSelect
                        value={formData.priceType}
                        onChange={(val) => setFormData({ ...formData, priceType: val })}
                        options={PRICE_TYPE_OPTIONS}
                        size="md"
                      />
                    </Field>

                    {priceNeedsAmount && (
                      <Field
                        label={formData.priceType === 'tiered' ? 'Standard price (NPR)' : 'Price (NPR)'}
                        id="svc-price"
                        hint={formData.priceType === 'tiered' ? `Charged when a ${staffLabel.toLowerCase()} has no tier, or when nobody is assigned yet.` : undefined}
                      >
                        <NumberInput id="svc-price" value={formData.priceNpr} onChange={(e) => setFormData({ ...formData, priceNpr: e.target.value })} placeholder="2000" min="1" />
                      </Field>
                    )}

                    {formData.priceType === 'free' && <p className="text-xs text-text-secondary">No charge for this service.</p>}
                    {formData.priceType === 'calendar_only' && <p className="text-xs text-text-secondary">Staff see this price on the calendar. Customers booking online never see it.</p>}
                    {formData.priceType === 'no_default' && <p className="text-xs text-text-secondary">No price is set. Whoever takes the booking enters one.</p>}

                    {formData.priceType === 'tiered' && (
                      <div className="space-y-1.5">
                        <span className="block font-body font-body-medium text-[13px] text-text-primary">Price by tier</span>
                        {priceTiers.length === 0 ? (
                          <p className="text-xs text-text-secondary italic">
                            No price tiers yet. <button type="button" onClick={goManageTiers} className="underline not-italic text-primary">Manage tiers</button>, then come back here.
                          </p>
                        ) : (
                          <>
                            <div className="border border-border rounded-spa-lg overflow-hidden">
                              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-background border-b border-[#F0F0EE] text-[13px]">
                                <span>Standard (no tier)</span>
                                <b className="font-semibold">{formData.priceNpr ? formatNPR(formData.priceNpr) : 'NPR 0'}</b>
                              </div>
                              {priceTiers.map((tier) => {
                                const n = tierStaffCounts[tier.id] || 0;
                                return (
                                  <div key={tier.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[#F0F0EE] last:border-b-0 text-[13px]" data-tier-price-row>
                                    <span>{tier.name}<span className="text-text-tertiary text-xs"> · {n} {n === 1 ? staffLabel.toLowerCase() : staffLabelPlural.toLowerCase()}</span></span>
                                    <NumberInput
                                      aria-label={`${tier.name} price`}
                                      value={tierPrices[tier.id] ?? ''}
                                      onChange={(e) => setTierPrices((prev) => ({ ...prev, [tier.id]: e.target.value }))}
                                      placeholder={formData.priceNpr || '0'}
                                      min="0"
                                      className="!w-[130px] text-right"
                                    />
                                  </div>
                                );
                              })}
                            </div>
                            <p className="text-xs text-text-secondary">A tier left blank charges the standard price. It is never free. <button type="button" onClick={goManageTiers} className="underline text-primary">Manage tiers</button></p>
                          </>
                        )}
                        {onlineRange && (
                          <div className="rounded-spa-lg bg-[#F1F6F0] text-primary px-3 py-2.5 text-[12.5px] leading-relaxed" data-online-range>
                            <b>What clients see online:</b> {onlineRange}. At booking they are charged the price of the {staffLabel.toLowerCase()} who does it.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </SettingsRow>

                <SettingsRow title={branchWordPlural.charAt(0).toUpperCase() + branchWordPlural.slice(1)} description={`Make this service available everywhere, or restrict it to specific ${branchWordPlural}.`}>
                  <div className="space-y-2 p-3 bg-background rounded-spa border border-border max-w-xl">
                    <div className="flex items-center justify-between">
                      <span className="font-body font-body-medium text-sm text-text-primary">Restrict to specific {branchWordPlural}?</span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !restrictBranches;
                          setRestrictBranches(next);
                          if (!next) {
                            setEligibleBranchIds([]);
                            setBranchSearchQuery('');
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                          restrictBranches ? 'bg-success' : 'bg-border'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                          restrictBranches ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>

                    {restrictBranches && (
                      <div className="space-y-2">
                        <Input
                          value={branchSearchQuery}
                          onChange={(e) => setBranchSearchQuery(e.target.value)}
                          placeholder={`Search ${branchWordPlural}...`}
                        />
                        <div className="border border-border rounded-spa bg-surface max-h-[220px] overflow-y-auto p-2 space-y-1">
                          {(() => {
                            const query = branchSearchQuery.toLowerCase();
                            const filtered = query
                              ? allBranches.filter((b) => b.name.toLowerCase().includes(query))
                              : allBranches;
                            if (allBranches.length === 0) {
                              return <p className="text-xs text-text-secondary px-2 py-1">No {branchWordPlural} found.</p>;
                            }
                            if (filtered.length === 0) {
                              return <p className="text-xs text-text-secondary px-2 py-1">No {branchWordPlural} match "{branchSearchQuery}".</p>;
                            }
                            return filtered.map((b) => (
                              <label key={b.id} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-primary/5 ${eligibleBranchIds.includes(b.id) ? 'bg-primary/5' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={eligibleBranchIds.includes(b.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setEligibleBranchIds((ids) => [...ids, b.id]);
                                    } else {
                                      setEligibleBranchIds((ids) => ids.filter((id) => id !== b.id));
                                    }
                                  }}
                                  className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                                />
                                <span className="font-body text-sm text-text-primary">{b.name}</span>
                              </label>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </SettingsRow>

                <SettingsRow title="Who can do it" description={`Restrict this service to specific ${staffLabelPlural.toLowerCase()}, or leave open to everyone.`}>
                  <div className="space-y-3 max-w-xl">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={formData.requiresTherapist} onChange={(e) => setFormData({ ...formData, requiresTherapist: e.target.checked })} className="accent-primary w-4 h-4 rounded mt-0.5" />
                      <span className="font-body font-body-medium text-sm text-text-primary">Needs a {staffLabel.toLowerCase()}
                        <span className="block text-xs font-normal text-text-secondary mt-0.5">Turn off for self-service items{enableRooms ? ` (a ${locationLabel.toLowerCase()} only)` : ''}. They show in the calendar's unassigned column.</span>
                      </span>
                    </label>
                    {formData.requiresTherapist && !staffScopeBranchId && (
                      <p className="p-3 bg-background rounded-spa border border-border max-w-xl font-caption text-xs text-text-secondary">
                        {isEdit
                          ? `${staffLabelPlural} limits are set per location. Pick a location in the switcher at the top to see or change them; saving here leaves them as they are.`
                          : `Pick a location in the switcher at the top to choose which ${staffLabelPlural.toLowerCase()} can do this service. Until then it stays open to everyone.`}
                      </p>
                    )}
                    {formData.requiresTherapist && !!staffScopeBranchId && (
                      <>
                  <div className="space-y-2 p-3 bg-background rounded-spa border border-border max-w-xl">
                    <div className="flex items-center justify-between">
                      <span className="font-body font-body-medium text-sm text-text-primary">Restrict to specific {staffLabelPlural.toLowerCase()}?</span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !restrictStaff;
                          setRestrictStaff(next);
                          if (!next) {
                            setEligibleTherapistIds([]);
                            setStaffSearchQuery('');
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                          restrictStaff ? 'bg-success' : 'bg-border'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                          restrictStaff ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>

                    {restrictStaff && (
                      <div className="space-y-2">
                        <p className="font-caption text-xs text-text-secondary">
                          Checked staff can perform this service. Unchecked staff cannot.
                        </p>
                        <Input
                          value={staffSearchQuery}
                          onChange={(e) => setStaffSearchQuery(e.target.value)}
                          placeholder="Search staff..."
                        />
                        <div className="border border-border rounded-spa bg-surface max-h-[220px] overflow-y-auto p-2 space-y-1">
                          {(() => {
                            const query = staffSearchQuery.toLowerCase();
                            const filtered = query
                              ? allTherapists.filter((t) => t.name.toLowerCase().includes(query))
                              : allTherapists;
                            if (allTherapists.length === 0) {
                              return <p className="text-xs text-text-secondary px-2 py-1">No staff found.</p>;
                            }
                            if (filtered.length === 0) {
                              return <p className="text-xs text-text-secondary px-2 py-1">No staff match "{staffSearchQuery}".</p>;
                            }
                            return filtered.map((t) => (
                              <label key={t.id} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-primary/5 ${eligibleTherapistIds.includes(t.id) ? 'bg-primary/5' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={eligibleTherapistIds.includes(t.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setEligibleTherapistIds((ids) => [...ids, t.id]);
                                    } else {
                                      setEligibleTherapistIds((ids) => ids.filter((id) => id !== t.id));
                                    }
                                  }}
                                  className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                                />
                                <span className="font-body text-sm text-text-primary">{t.name}</span>
                              </label>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                
                      </>
                    )}
                  </div>
                </SettingsRow>

                <SettingsRow title="Offer" description="A discount applied to this service, shown struck-through on the booking page.">
                  <div className="space-y-2 p-3 bg-background rounded-spa border border-border max-w-xl">
                    <div className="flex items-center justify-between">
                      <span className="font-body font-body-medium text-sm text-text-primary">Enable offer</span>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, offerEnabled: !formData.offerEnabled })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                          formData.offerEnabled ? 'bg-success' : 'bg-border'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                          formData.offerEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>

                    {formData.offerEnabled ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, offerType: 'percent' })}
                            className={`flex-1 px-3 py-1.5 rounded-spa border text-sm font-body spa-transition-fast ${
                              formData.offerType === 'percent'
                                ? 'border-primary bg-primary/5 text-primary'
                                : 'border-border text-text-secondary'
                            }`}
                          >
                            Percentage off
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, offerType: 'fixed' })}
                            className={`flex-1 px-3 py-1.5 rounded-spa border text-sm font-body spa-transition-fast ${
                              formData.offerType === 'fixed'
                                ? 'border-primary bg-primary/5 text-primary'
                                : 'border-border text-text-secondary'
                            }`}
                          >
                            Flat price
                          </button>
                        </div>
                        <Input
                          type="number"
                          value={formData.offerValue}
                          onChange={(e) => setFormData({ ...formData, offerValue: e.target.value })}
                          placeholder={formData.offerType === 'percent' ? 'e.g. 30' : 'e.g. 4500'}
                          min="1"
                        />
                        {formData.priceNpr && formData.offerValue && Number(formData.offerValue) > 0 && (
                          formData.offerType === 'fixed' && Number(formData.offerValue) >= Number(formData.priceNpr) ? (
                            <p className="font-caption text-xs text-error">
                              Flat price must be less than the regular price ({formatNPR(formData.priceNpr)}).
                            </p>
                          ) : (
                            <p className="font-caption text-xs text-text-secondary">
                              Customers will see:{' '}
                              <span className="line-through text-text-tertiary">{formatNPR(formData.priceNpr)}</span>{' '}
                              {formatNPR(
                                formData.offerType === 'percent'
                                  ? Number(formData.priceNpr) * (1 - Number(formData.offerValue) / 100)
                                  : Number(formData.offerValue)
                              )}
                            </p>
                          )
                        )}
                      </div>
                    ) : (
                      selectedCategory?.offer_enabled ? (
                        <p className="font-caption text-xs text-text-secondary">
                          This service inherits the "{selectedCategory.name}" category offer
                          ({selectedCategory.offer_percent}% off) unless you enable its own offer above.
                        </p>
                      ) : null
                    )}
                  </div>
                </SettingsRow>

                <SettingsRow title="Online Booking" description="Control whether customers can book this service themselves on the public booking page, and what add-ons to offer alongside it.">
                  <div className="max-w-2xl rounded-spa-lg border border-border bg-surface shadow-spa-resting overflow-hidden">
                    <div className="divide-y divide-border">
                      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Icon name="Globe" size={15} className="text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-body font-body-medium text-sm text-text-primary">Clients can book this service online</p>
                            <p className="font-caption text-xs text-text-secondary mt-0.5">Shown on the public booking page. Turn off to keep it staff/walk-in only.</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFormData((f) => ({ ...f, bookableOnline: !f.bookableOnline }))}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast flex-shrink-0 ${
                            formData.bookableOnline ? 'bg-success' : 'bg-border'
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                            formData.bookableOnline ? 'translate-x-6' : 'translate-x-1'
                          }`} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                            <Icon name="PlusCircle" size={15} className="text-accent" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-body font-body-medium text-sm text-text-primary">Can be booked as a service add-on</p>
                            <p className="font-caption text-xs text-text-secondary mt-0.5">Makes this service selectable as an add-on when booking other services.</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFormData((f) => ({ ...f, isAddon: !f.isAddon }))}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast flex-shrink-0 ${
                            formData.isAddon ? 'bg-success' : 'bg-border'
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                            formData.isAddon ? 'translate-x-6' : 'translate-x-1'
                          }`} />
                        </button>
                      </div>

                      <div className="px-4 py-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <p className="font-body font-body-medium text-sm text-text-primary">Service Add-ons</p>
                          {serviceAddonIds.length > 0 && (
                            <span className="font-caption font-caption-medium text-[11px] text-text-secondary bg-background border border-border rounded-full px-2 py-0.5">
                              {serviceAddonIds.length} selected
                            </span>
                          )}
                        </div>
                        <p className="font-caption text-xs text-text-secondary -mt-1">
                          Once a customer selects this service online, these will be offered as paid extras they can add to their booking.
                        </p>
                        <Input
                          value={addonSearchQuery}
                          onChange={(e) => setAddonSearchQuery(e.target.value)}
                          placeholder="Search add-on services..."
                        />
                        <div className="border border-border rounded-spa bg-background max-h-[220px] overflow-y-auto">
                          {(() => {
                            const query = addonSearchQuery.toLowerCase();
                            const candidates = allServices.filter((s) =>
                              s.id !== serviceId && s.is_addon && (!query || s.name.toLowerCase().includes(query))
                            );
                            if (candidates.length === 0) {
                              return (
                                <p className="text-xs text-text-secondary px-3 py-3">
                                  {allServices.some((s) => s.id !== serviceId && s.is_addon)
                                    ? 'No add-on services match your search.'
                                    : 'No services are flagged "Can be booked as a service add-on" yet.'}
                                </p>
                              );
                            }
                            return candidates.map((s) => {
                              const checked = serviceAddonIds.includes(s.id);
                              return (
                                <label key={s.id} className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer hover:bg-primary/5 border-b border-border/60 last:border-b-0 ${checked ? 'bg-primary/5' : ''}`}>
                                  <span className="flex items-center gap-2.5 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setServiceAddonIds((prev) => [...prev, s.id]);
                                        } else {
                                          setServiceAddonIds((prev) => prev.filter((id) => id !== s.id));
                                        }
                                      }}
                                      className="text-primary focus:ring-primary w-3.5 h-3.5 rounded flex-shrink-0"
                                    />
                                    <span className="font-body text-sm text-text-primary truncate">{s.name}</span>
                                  </span>
                                  <span className="font-data text-xs text-text-tertiary flex-shrink-0">{formatNPR(s.price_npr)}</span>
                                </label>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                </SettingsRow>

                {formData.isCombo && (
                  <SettingsRow title="Combo Components" description={`Which services make up this combo, how long each one takes, and whether each one needs its own staff member${enableRooms ? `, ${locationLabel.toLowerCase()},` : ''} and time slot.`}>
                    <div className="space-y-3">
                      {comboComponents.length > 0 && (() => {
                        // Walk components in the order they were added, computing each one's
                        // start offset: "concurrent" starts alongside the previous component
                        // (parallel — needs its own staff to actually happen at once);
                        // "sequential" starts once everything so far has finished. The
                        // running total is the furthest end point reached.
                        let cursor = 0;
                        let previousStart = 0;
                        const schedule = comboComponents.map((c) => {
                          const svc = allServices.find((s) => s.id === c.serviceId);
                          const duration = svc?.duration_minutes || 0;
                          const start = c.defaultTiming === 'concurrent' ? previousStart : cursor;
                          const end = start + duration;
                          cursor = Math.max(cursor, end);
                          previousStart = start;
                          return { ...c, name: svc?.name || 'Service', duration, start, end };
                        });
                        const totalDuration = cursor;
                        const durationMismatch = Number(formData.durationMinutes) !== totalDuration;

                        return (
                          <div className="border border-border rounded-spa bg-surface overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-background border-b border-border">
                                  <th className="text-left px-3 py-1.5 font-caption text-[11px] uppercase tracking-wide text-text-tertiary font-caption-medium">Service</th>
                                  <th className="text-right px-3 py-1.5 font-caption text-[11px] uppercase tracking-wide text-text-tertiary font-caption-medium">Duration</th>
                                  <th className="text-right px-3 py-1.5 font-caption text-[11px] uppercase tracking-wide text-text-tertiary font-caption-medium">Starts at</th>
                                </tr>
                              </thead>
                              <tbody>
                                {schedule.map((c) => (
                                  <tr key={c.serviceId} className="border-b border-border/60 last:border-b-0">
                                    <td className="px-3 py-1.5 font-body text-text-primary truncate">{c.name}</td>
                                    <td className="px-3 py-1.5 font-data text-right text-text-secondary">{c.duration}min</td>
                                    <td className="px-3 py-1.5 font-data text-right text-text-secondary">+{c.start}min</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-background border-t border-border">
                              <span className="font-body font-body-medium text-sm text-text-primary">
                                Total combo duration: <span className="font-data">{totalDuration}min</span>
                              </span>
                              {durationMismatch && (
                                <button
                                  type="button"
                                  onClick={() => setFormData((f) => ({ ...f, durationMinutes: String(totalDuration) }))}
                                  className="text-xs font-body font-body-medium text-primary hover:underline flex-shrink-0"
                                >
                                  Use as service duration ({formData.durationMinutes || 0}min → {totalDuration}min)
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      <Input
                        value={comboSearchQuery}
                        onChange={(e) => setComboSearchQuery(e.target.value)}
                        placeholder="Search services..."
                      />
                      <div className="border border-border rounded-spa bg-background max-h-[320px] overflow-y-auto">
                        {(() => {
                          const query = comboSearchQuery.toLowerCase();
                          const candidates = allServices.filter((s) => s.id !== serviceId && (!query || s.name.toLowerCase().includes(query)));
                          if (candidates.length === 0) {
                            return <p className="text-xs text-text-secondary px-3 py-2">No services found.</p>;
                          }
                          return candidates.map((s) => {
                            const component = comboComponents.find((c) => c.serviceId === s.id);
                            const checked = !!component;
                            return (
                              <div key={s.id} className={`border-b border-border/60 last:border-b-0 ${checked ? 'bg-primary/5' : ''}`}>
                                <label className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer hover:bg-primary/5">
                                  <span className="flex items-center gap-2.5 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setComboComponents((prev) => [...prev, { serviceId: s.id, defaultTiming: 'sequential', defaultSameStaff: true, defaultSameRoom: true }]);
                                        } else {
                                          setComboComponents((prev) => prev.filter((c) => c.serviceId !== s.id));
                                        }
                                      }}
                                      className="text-primary focus:ring-primary w-3.5 h-3.5 rounded flex-shrink-0"
                                    />
                                    <span className="font-body text-sm text-text-primary truncate">{s.name}</span>
                                    <span className="font-caption text-xs text-text-tertiary flex-shrink-0">{s.duration_minutes}min</span>
                                  </span>
                                </label>
                                {checked && (
                                  <div className="px-3 pb-2.5 pl-9 flex flex-wrap items-center gap-4">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-caption text-[11px] text-text-tertiary">Timing:</span>
                                      <div className="inline-flex rounded-spa border border-border p-0.5 bg-surface">
                                        {[['sequential', 'After previous'], ['concurrent', 'Same time']].map(([val, label]) => (
                                          <button
                                            key={val}
                                            type="button"
                                            onClick={() => setComboComponents((prev) => prev.map((c) => c.serviceId === s.id ? { ...c, defaultTiming: val } : c))}
                                            className={`px-2 py-1 rounded text-[11px] font-body font-body-medium transition-colors ${
                                              component.defaultTiming === val ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                                            }`}
                                          >
                                            {label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-caption text-[11px] text-text-tertiary">Staff:</span>
                                      <div className="inline-flex rounded-spa border border-border p-0.5 bg-surface">
                                        {[[true, 'Same staff'], [false, 'Different staff']].map(([val, label]) => (
                                          <button
                                            key={String(val)}
                                            type="button"
                                            onClick={() => setComboComponents((prev) => prev.map((c) => c.serviceId === s.id ? { ...c, defaultSameStaff: val } : c))}
                                            className={`px-2 py-1 rounded text-[11px] font-body font-body-medium transition-colors ${
                                              component.defaultSameStaff === val ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                                            }`}
                                          >
                                            {label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    {enableRooms && (
                                      <div className="flex items-center gap-1.5">
                                      <span className="font-caption text-[11px] text-text-tertiary">Room:</span>
                                      <div className="inline-flex rounded-spa border border-border p-0.5 bg-surface">
                                        {[[true, 'Same room'], [false, 'Different room']].map(([val, label]) => (
                                          <button
                                            key={String(val)}
                                            type="button"
                                            onClick={() => setComboComponents((prev) => prev.map((c) => c.serviceId === s.id ? { ...c, defaultSameRoom: val } : c))}
                                            className={`px-2 py-1 rounded text-[11px] font-body font-body-medium transition-colors ${
                                              component.defaultSameRoom !== false === val ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                                            }`}
                                          >
                                            {label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                      )}
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                      <p className="font-caption text-[11px] text-text-tertiary">
                        "Same time" components run alongside the one before them (needs a different staff member to
                        actually happen in parallel). "After previous" starts once the prior component ends.
                        "Different room" lets a component happen in its own physical space (e.g. a treatment room
                        + a styling chair) instead of the combo booking's single room. These are defaults — staff
                        can still adjust per booking.
                      </p>
                    </div>
                  </SettingsRow>
                )}

                <SettingsRow title="Padding & Processing Time" description="Block extra time before or after this service for setup, cleanup, or processing (e.g. color developing) — on top of its core duration above.">
                  {!formData.paddingEnabled ? (
                    <button
                      type="button"
                      onClick={() => setFormData((f) => ({ ...f, paddingEnabled: true }))}
                      className="inline-flex items-center gap-1.5 font-body font-body-medium text-sm text-primary hover:underline"
                    >
                      <Icon name="Plus" size={14} />
                      Add padding and processing times
                    </button>
                  ) : (
                    <div className="max-w-xl rounded-spa-lg border border-border bg-surface shadow-spa-resting overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-primary/5 border-b border-border">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Icon name="Timer" size={13} className="text-primary" />
                          </div>
                          <span className="font-body font-body-medium text-sm text-text-primary">Padding & processing time</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFormData((f) => ({ ...f, paddingEnabled: false, paddingBeforeMinutes: '0', paddingAfterMinutes: '0', paddingAfterType: 'padding' }))}
                          className="font-caption font-caption-medium text-xs text-error hover:underline flex-shrink-0"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="px-3.5 py-3.5 space-y-3.5">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="block font-body font-body-medium text-sm text-text-primary">Padding before</label>
                            <div className="relative">
                              <Icon name="Clock" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                              <Input
                                type="number"
                                min="0"
                                value={formData.paddingBeforeMinutes}
                                onChange={(e) => setFormData({ ...formData, paddingBeforeMinutes: e.target.value })}
                                onFocus={(e) => e.target.select()}
                                placeholder="0"
                                className="pl-9"
                              />
                            </div>
                            <p className="font-caption text-[11px] text-text-tertiary">minutes, setup before staff starts</p>
                          </div>
                          <div className="space-y-1">
                            <label className="block font-body font-body-medium text-sm text-text-primary">
                              {formData.paddingAfterType === 'processing' ? 'Processing time' : 'Padding after'}
                            </label>
                            <div className="relative">
                              <Icon name="Clock" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                              <Input
                                type="number"
                                min="0"
                                value={formData.paddingAfterMinutes}
                                onChange={(e) => setFormData({ ...formData, paddingAfterMinutes: e.target.value })}
                                onFocus={(e) => e.target.select()}
                                placeholder="0"
                                className="pl-9"
                              />
                            </div>
                            <p className="font-caption text-[11px] text-text-tertiary">minutes, after the service itself</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-caption font-caption-medium text-[11px] text-text-tertiary uppercase tracking-wide">Type</span>
                          <div className="inline-flex rounded-spa border border-border p-0.5 bg-background">
                            {[['padding', 'Padding after'], ['processing', 'Processing time']].map(([val, label]) => (
                              <button
                                key={val}
                                type="button"
                                onClick={() => setFormData((f) => ({ ...f, paddingAfterType: val }))}
                                className={`px-2.5 py-1 rounded text-xs font-body font-body-medium spa-transition-fast ${
                                  formData.paddingAfterType === val ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <p className="font-caption text-[11px] text-text-tertiary leading-relaxed">
                          <span className="font-caption-medium text-text-secondary">Padding</span> blocks staff's calendar for
                          setup/cleanup. <span className="font-caption-medium text-text-secondary">Processing time</span> is the
                          client's own wait (e.g. color developing) — it extends the appointment slot without requiring the
                          assigned staff to stay occupied the whole time.
                        </p>

                        <div className="flex items-center justify-between pt-3 border-t border-border">
                          <span className="font-caption font-caption-normal text-xs text-text-secondary">Total appointment block</span>
                          <span className="font-data font-data-medium text-sm text-text-primary">
                            {(Number(formData.paddingBeforeMinutes) || 0) + (Number(formData.durationMinutes) || 0) + (Number(formData.paddingAfterMinutes) || 0)}min
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </SettingsRow>

                <SettingsRow title="Service Image" description="Shown on the customer booking portal.">
                  <div className="space-y-2">
                    {imagePreview ? (
                      <div className="flex items-start gap-3">
                        <div className="relative w-32 h-32 rounded-spa overflow-hidden border border-border flex-shrink-0">
                          <img
                            src={imagePreview}
                            alt="Preview"
                            className="w-full h-full object-cover"
                            onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=200&h=200&fit=crop'; }}
                          />
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
                      <label className="cursor-pointer flex flex-col items-center justify-center w-full max-w-sm h-32 border-2 border-dashed border-border rounded-spa hover:border-primary/50 hover:bg-primary/5 spa-transition-fast">
                        <Icon name="Upload" size={24} className="text-text-tertiary mb-2" />
                        <span className="font-body text-sm text-text-secondary">Click to upload image</span>
                        <span className="font-caption text-xs text-text-tertiary mt-1">JPEG, PNG, WebP, GIF (max 5MB)</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleImageChange} className="hidden" />
                      </label>
                    )}
                    {uploadingImage && (
                      <div className="flex items-center gap-2 text-sm text-text-secondary">
                        <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                        Uploading image...
                      </div>
                    )}
                  </div>
                </SettingsRow>

              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default ServiceDetailPage;
