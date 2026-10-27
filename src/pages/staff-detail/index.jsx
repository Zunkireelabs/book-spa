import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useDirtyGuard, useGuardedNavigate } from '../../contexts/DirtyGuardContext';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import AppShell from '../../components/ui/AppShell';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
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
  fetchStaffCompensation,
  setStaffCompensation,
  fetchRosterOverrides,
} from '../../services/api';
import * as profileApi from '../../services/therapistProfileApi';
import { parsePhone } from '../../components/ui/CountryCodeSelect';
import { nepalNow } from '../../utils/customerDirectory';
import { hoursFromShiftRow, timeToMinutes, DB_DOW_LABELS } from '../../utils/staffDay';
import { todayStatusLine, STATUS_DOT_COLOR } from '../../utils/todayStatusLine';
import { useAvailabilityConflictGuard } from '../../hooks/useAvailabilityConflictGuard';
import { hoursChange } from '../../services/availabilityConflicts';
import { nepalClock } from '../../services/therapistsOverview';
import {
  changedKeys, hoursChanged, changedHourDays, payChanged, diffServiceIds, monthOf, attendanceSummary,
} from './profileModel';
import OverviewSection from './sections/OverviewSection';
import ProfileSection from './sections/ProfileSection';
import ServicesSection from './sections/ServicesSection';
import HoursSection from './sections/HoursSection';
import PaySection from './sections/PaySection';
import HistorySection from './sections/HistorySection';
import TodayBookingPanel from './sections/TodayBookingPanel';
import TransferManagementModal from '../../components/ui/TransferManagementModal';
import TransferPill from '../../components/ui/TransferPill';
import { describeTransfer, transferState } from '../../utils/transferText';
import { toKathmanduParts } from '../branch-manager-dashboard/components/calendar/calendarDates';
import { formatClockTime } from '../branch-manager-dashboard/components/calendar/timeFormat';
import { Problem, Loading, Section, EditBar } from './sections/ui';

const EMPTY_FORM = { name: '', gender: 'Male', positions: [], specialties: '', isServiceStaff: true, photoUrl: '', bio: '', experienceYears: '', rating: '', phone: '', countryCode: '+977', address: '', city: '', email: '', pronouns: '' };
const FORM_KEYS = Object.keys(EMPTY_FORM);
const EMPTY_PAY = { monthlySalary: '', commissionRate: '', productCommissionRate: '' };

const DEFAULT_WORKING_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek, dayLabel: DB_DOW_LABELS[dayOfWeek], startTime: null, endTime: null, isDayOff: true, breaks: [],
}));

const SECTIONS = [
  { id: 'overview', label: 'Overview', slug: 'overview' },
  { id: 'profile', label: 'Profile', slug: 'profile' },
  { id: 'services', label: 'Services', slug: 'services' },
  { id: 'hours', label: 'Working hours', slug: 'working-hours' },
  { id: 'pay', label: 'Pay', slug: 'pay' },
  { id: 'history', label: 'History', slug: 'history' },
];
const idOfSlug = (slug) => SECTIONS.find((s) => s.slug === slug || s.id === slug)?.id;
const TITLES = { profile: 'Profile', services: 'Services', hours: 'Working hours', pay: 'Pay' };

const initialsOf = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
const sinceText = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' }) : null);

const StaffDetailPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgSlug, staffId } = useParams();
  const { profile } = useAuth();
  const { branchId, branches } = useBranch();
  const { enableStaffRatings } = useOrg();
  const { staffLabel, staffLabelPlural, locationLabel } = useIndustry();
  const { confirmConflicts, conflictModal } = useAvailabilityConflictGuard();
  const role = profile?.role || 'staff';
  const isEdit = !!staffId;
  const isAdmin = role === 'admin';
  const isViewer = role === 'admin_viewer';
  const canEdit = !isViewer;                          // manager + admin
  const canSeePay = role === 'admin' || role === 'admin_viewer'; // same rule as Payroll: admins edit, view-only admins read; managers and staff never see pay
  const canEditPay = isAdmin;

  const { today, hm: nowTime } = nepalNow();
  const periodMonth = monthOf(today);

  // ── core record ───────────────────────────────────────────────────────────
  const [pageLoading, setPageLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState(null);
  const [therapist, setTherapist] = useState(null);
  const [allPositionNames, setAllPositionNames] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saved, setSaved] = useState({ form: EMPTY_FORM, hours: DEFAULT_WORKING_HOURS, pay: EMPTY_PAY, serviceIds: [] });
  const [workingHours, setWorkingHours] = useState(DEFAULT_WORKING_HOURS);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(null);       // one section open at a time: profile | services | hours | pay
  const [ask, setAsk] = useState(null);               // { next, field } while the switch dialog is up
  const [current, setCurrent] = useState('overview'); // scroll-spy
  const [compact, setCompact] = useState(false);
  const [openBooking, setOpenBooking] = useState(null);
  const rootRef = useRef(null); // the shell's inner `.content-scroll` is found from here (AppShell's context is below this component)
  const headerRef = useRef(null);
  const therapistRef = useRef(null);

  // ── per-section data ──────────────────────────────────────────────────────
  const [pay, setPay] = useState(EMPTY_PAY);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState(null);
  const [ticked, setTicked] = useState(new Set());
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [overridesLoading, setOverridesLoading] = useState(false);
  const [overridesError, setOverridesError] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState(null);
  const [activity, setActivity] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(null);
  const [activityFilter, setActivityFilter] = useState('all');

  const effectiveBranchId = isEdit ? (therapist?.branch_id || null) : (role === 'manager' ? profile?.branch_id : branchId);
  const branchName = (branches || []).find((b) => b.id === effectiveBranchId)?.name || profile?.branches?.name || '';
  const firstName = (form.name || '').trim().split(/\s+/)[0] || '';

  const visibleSections = useMemo(() => SECTIONS.filter((s) => {
    if (!isEdit) return ['profile', 'services', 'hours'].includes(s.id);
    if (s.id === 'pay') return canSeePay;
    if (s.id === 'services') return form.isServiceStaff;
    return true;
  }), [isEdit, canSeePay, form.isServiceStaff]);

  // ── loading ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!effectiveBranchId) return;
    (async () => {
      const { data } = await fetchTherapistsForManagement(effectiveBranchId);
      const names = new Set();
      (data || []).forEach((t) => { if (t.position) t.position.split('/').forEach((p) => names.add(p.trim())); });
      setAllPositionNames(Array.from(names).sort());
    })();
  }, [effectiveBranchId]);

  const formFromRecord = (t) => {
    const { dial, national } = parsePhone(t.phone);
    return {
      name: t.name,
      gender: t.gender || 'Male',
      // Position is single-select: a legacy '/'-joined value collapses to its first token and is written back clean on save.
      positions: t.position ? [t.position.split('/')[0].trim()] : [],
      specialties: (t.specialties || []).join(', '),
      isServiceStaff: t.is_service_staff !== false,
      photoUrl: t.photo_url || '',
      bio: t.bio || '',
      experienceYears: t.experience_years != null ? String(t.experience_years) : '',
      rating: t.rating != null ? String(t.rating) : '',
      phone: national,
      countryCode: dial,
      address: t.address || '',
      city: t.city || '',
      email: t.email || '',
      pronouns: t.pronouns || '',
    };
  };

  const loadTherapist = useCallback(async () => {
    if (!isEdit) return;
    if (therapistRef.current?.id !== staffId) setPageLoading(true);
    setLoadError(null);
    const [therapistResult, hoursResult] = await Promise.all([fetchTherapistById(staffId), fetchTherapistWorkingHours(staffId)]);
    if (therapistResult.error) {
      setLoadError(therapistResult.error.message || 'Failed to load this team member.');
      setPageLoading(false);
      return;
    }
    const t = therapistResult.data;
    const f = formFromRecord(t);
    const hours = hoursResult.data || DEFAULT_WORKING_HOURS;
    therapistRef.current = t;
    setTherapist(t);
    setForm(f);
    setWorkingHours(hours);
    setPhotoFile(null);
    setPhotoPreview(t.photo_url || null);
    setSaved((s) => ({ ...s, form: f, hours }));
    setPageLoading(false);
  }, [isEdit, staffId]);

  useEffect(() => { loadTherapist(); }, [loadTherapist]);

  const loadOverview = useCallback(async () => {
    if (!isEdit || !effectiveBranchId) return;
    setOverviewLoading(true); setOverviewError(null);
    const r = await profileApi.fetchTherapistOverview({ therapistId: staffId, branchId: effectiveBranchId, today, role });
    if (r.error) setOverviewError(r.error.message || 'Could not load the overview.'); else setOverview(r.data);
    setOverviewLoading(false);
  }, [isEdit, staffId, effectiveBranchId, today, role]);

  const loadMatrix = useCallback(async () => {
    if (!isEdit || !effectiveBranchId) return;
    setMatrixLoading(true); setMatrixError(null);
    const r = await profileApi.fetchTherapistServiceMatrix({ therapistId: staffId, branchId: effectiveBranchId });
    if (r.error) setMatrixError(r.error.message || 'Could not load services.');
    else {
      setMatrix(r.data);
      const ids = r.data.categories.flatMap((c) => c.services.filter((s) => s.ticked && !s.openToAll).map((s) => s.id));
      setTicked(new Set(ids));
      setSaved((s) => ({ ...s, serviceIds: ids }));
    }
    setMatrixLoading(false);
  }, [isEdit, staffId, effectiveBranchId]);

  const loadPay = useCallback(async () => {
    if (!isEdit || !canSeePay || !effectiveBranchId) return;
    setPayLoading(true); setPayError(null);
    const r = await fetchStaffCompensation(effectiveBranchId);
    if (r.error) setPayError(r.error.message || 'Could not load pay.');
    else {
      const row = (r.data || []).find((x) => x.therapistId === staffId);
      const p = row ? { monthlySalary: String(row.monthlySalary), commissionRate: String(row.commissionRate), productCommissionRate: String(row.productCommissionRate) } : EMPTY_PAY;
      setPay(p);
      setSaved((s) => ({ ...s, pay: p }));
    }
    setPayLoading(false);
  }, [isEdit, canSeePay, effectiveBranchId, staffId]);

  const loadOverrides = useCallback(async () => {
    if (!isEdit || !effectiveBranchId) return;
    setOverridesLoading(true); setOverridesError(null);
    const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 90);
    const r = await fetchRosterOverrides({ branchId: effectiveBranchId, startDate: today, endDate: end.toISOString().slice(0, 10) });
    if (r.error) setOverridesError(r.error.message || 'Could not load date changes.');
    else setOverrides([...r.data.values()].filter((o) => o.therapistId === staffId).sort((a, b) => a.date.localeCompare(b.date)));
    setOverridesLoading(false);
  }, [isEdit, effectiveBranchId, staffId, today]);

  const loadEarnings = useCallback(async () => {
    if (!isEdit || !canSeePay || !effectiveBranchId) return;
    setEarningsLoading(true); setEarningsError(null);
    const r = await profileApi.fetchTherapistEarnings({ therapistId: staffId, branchId: effectiveBranchId, periodMonth, role });
    if (r.error) setEarningsError(r.error.message || 'Could not load earnings.'); else setEarnings(r.data);
    setEarningsLoading(false);
  }, [isEdit, canSeePay, effectiveBranchId, staffId, periodMonth]);

  const loadAttendance = useCallback(async () => {
    if (!isEdit) return;
    setAttendanceLoading(true); setAttendanceError(null);
    const r = await profileApi.fetchTherapistAttendanceMonth({ therapistId: staffId, month: periodMonth });
    if (r.error) setAttendanceError(r.error.message || 'Could not load attendance.'); else setAttendance(r.data);
    setAttendanceLoading(false);
  }, [isEdit, staffId, periodMonth]);

  // Transfers: the open one drives the banner and Today's slot; the panel is the same docked panel as the calendar's.
  const [transfers, setTransfers] = useState([]);
  const [transferPanel, setTransferPanel] = useState(false);
  const use24h = (() => { try { return localStorage.getItem(`bookspa_calendar_use24h_${profile?.org_id}_${profile?.id}`) === '1'; } catch { return false; } })();
  const loadTransfers = useCallback(async () => {
    if (!isEdit) return;
    const r = await profileApi.fetchTherapistTransfers({ therapistId: staffId });
    if (!r.error) setTransfers(r.data || []);
  }, [isEdit, staffId]);

  const loadActivity = useCallback(async () => {
    if (!isEdit) return;
    setActivityLoading(true); setActivityError(null);
    const r = await profileApi.fetchTherapistActivity({ therapistId: staffId, filter: activityFilter, limit: 50, role, labels: { branch: (locationLabel || 'branch').toLowerCase() }, use24h });
    if (r.error) setActivityError(r.error.message || 'Could not load activity.'); else setActivity(r.data);
    setActivityLoading(false);
  }, [isEdit, staffId, activityFilter, role, locationLabel, use24h]);

  // Everything the header / menu needs loads once the record is here; heavier sections load when opened.
  useEffect(() => {
    if (!therapist) return;
    loadOverview(); loadMatrix(); loadPay(); loadOverrides();
  }, [therapist, loadOverview, loadMatrix, loadPay, loadOverrides]);
  useEffect(() => { if (therapist) { loadEarnings(); loadAttendance(); } }, [therapist, loadEarnings, loadAttendance]);
  useEffect(() => { if (therapist) loadActivity(); }, [therapist, loadActivity]);
  useEffect(() => { if (therapist) loadTransfers(); }, [therapist, loadTransfers]);

  // A saved filter chip that the role may not see (Pay) falls back to All.
  useEffect(() => { if (!canSeePay && activityFilter === 'pay') setActivityFilter('all'); }, [canSeePay, activityFilter]);

  // ── dirty tracking ────────────────────────────────────────────────────────
  const changedFormKeys = useMemo(() => {
    const keys = changedKeys(saved.form, form, FORM_KEYS);
    return photoFile ? [...keys, 'photo'] : keys;
  }, [saved.form, form, photoFile]);
  const serviceDiff = useMemo(() => diffServiceIds(saved.serviceIds, [...ticked]), [saved.serviceIds, ticked]);
  const servicesDirty = isEdit && (serviceDiff.added.length + serviceDiff.removed.length) > 0;
  const hoursDirty = isEdit ? hoursChanged(saved.hours, workingHours) : hoursChanged(DEFAULT_WORKING_HOURS, workingHours);
  const payDirty = isEdit && canEditPay && payChanged(saved.pay, pay);

  // ── per-section dirty counts ──────────────────────────────────────────────
  const payCount = payDirty ? ['monthlySalary', 'commissionRate', 'productCommissionRate'].filter((k) => Number(pay[k] || 0) !== Number(saved.pay[k] || 0)).length : 0;
  const hoursCount = hoursDirty ? Math.max(1, changedHourDays(isEdit ? saved.hours : DEFAULT_WORKING_HOURS, workingHours).length) : 0;
  const countOf = {
    profile: isEdit ? changedFormKeys.length : (form.name.trim() ? 1 : 0),
    services: serviceDiff.added.length + serviceDiff.removed.length,
    hours: hoursCount,
    pay: payCount,
  };
  const dirtySection = (id) => (countOf[id] || 0) > 0;
  const sectionsEditable = { profile: canEdit, services: canEdit && form.isServiceStaff, hours: canEdit, pay: canEditPay };

  // ── save / cancel, one section at a time ──────────────────────────────────
  const [sectionError, setSectionError] = useState(null); // { section, message }
  const fail = (section, message) => setSectionError({ section, message });
  const setFormError = (message) => (message ? fail('profile', message) : setSectionError(null));

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { setFormError('Only JPEG, PNG, WebP, and GIF images are allowed.'); return; }
    if (file.size > 2 * 1024 * 1024) { setFormError('Image must be less than 2.0MB.'); return; }
    setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file)); setSectionError(null);
  };
  const handleRemovePhoto = () => { setPhotoFile(null); setPhotoPreview(null); setForm((f) => ({ ...f, photoUrl: '' })); };

  const cancelSection = (id) => {
    if (id === 'profile') { setForm(saved.form); setPhotoFile(null); setPhotoPreview(saved.form.photoUrl || null); }
    if (id === 'services') setTicked(new Set(saved.serviceIds));
    if (id === 'hours') setWorkingHours(saved.hours);
    if (id === 'pay') setPay(saved.pay);
    setSectionError(null);
    setEditing((e) => (e === id ? null : e));
  };

  const profilePayload = async () => {
    let photoUrl = form.photoUrl.trim();
    if (photoFile) {
      setUploadingPhoto(true);
      const up = await uploadStaffPhoto(photoFile);
      setUploadingPhoto(false);
      if (up.error) throw new Error(up.error.message || 'Failed to upload photo.');
      photoUrl = up.url;
    }
    return {
      name: form.name.trim(),
      gender: form.gender,
      position: form.positions.length > 0 ? form.positions[0] : null,
      specialties: form.isServiceStaff ? form.specialties.split(',').map((s) => s.trim()).filter(Boolean) : [],
      isServiceStaff: form.isServiceStaff,
      photoUrl,
      bio: form.bio.trim(),
      experienceYears: form.experienceYears === '' ? null : parseInt(form.experienceYears, 10),
      rating: enableStaffRatings && isAdmin ? (form.rating === '' ? null : parseFloat(form.rating)) : undefined, // only admins may change a rating
      phone: form.phone.trim() ? `${form.countryCode}${form.phone.trim().replace(/\D/g, '')}` : '',
      address: form.address.trim(),
      city: form.city.trim(),
      email: form.email.trim(),
      pronouns: form.pronouns,
    };
  };

  // Saves only the named section's data. Returns true when it went through.
  const saveSection = async (id) => {
    setSaving(true); setSectionError(null);
    try {
      if (id === 'profile') {
        if (!form.name.trim()) throw new Error(`${staffLabel} name is required.`);
        const updated = await updateTherapist({ therapistId: staffId, ...(await profilePayload()) });
        if (updated.error) throw new Error(updated.error.message || 'Operation failed.');
        await loadTherapist(); loadOverview(); loadMatrix(); loadActivity();
      } else if (id === 'services') {
        const s = await profileApi.saveTherapistServices({ therapistId: staffId, serviceIds: [...ticked] });
        if (s.error) throw new Error(s.error.message || 'Could not save services.');
        await loadMatrix(); loadActivity();
        if (s.data?.skipped?.length) throw new Error(`${s.data.skipped.length} service${s.data.skipped.length === 1 ? ' was' : 's were'} left ticked because ${firstName || 'this person'} is the only one assigned (unticking would open ${s.data.skipped.length === 1 ? 'it' : 'them'} to everyone)`);
      } else if (id === 'hours') {
        // Bookings that would fall outside the changed days (listed first; they are kept either way).
        const days = changedHourDays(saved.hours, workingHours);
        const changes = days.map((d) => workingHours.find((r) => r.dayOfWeek === d)).filter(Boolean).map((r) => hoursChange({
          dayOfWeek: r.dayOfWeek, isDayOff: r.isDayOff, start: r.startTime, end: r.endTime,
          breaks: (r.breaks || []).map((b) => ({ start: b.startTime, end: b.endTime })),
        }));
        const names = days.map((d) => DB_DOW_LABELS[d]).join(', ');
        const proceed = await confirmConflicts({ therapistId: staffId, changes, summary: `You're changing ${firstName || 'their'}${firstName ? "'s" : ''} ${names} hours.`, titleFor: (n) => `${n} upcoming booking${n === 1 ? '' : 's'} ${n === 1 ? 'falls' : 'fall'} outside the new schedule`, saveLabel: 'Save hours' });
        if (!proceed) { setSaving(false); return false; }
        const h = await upsertTherapistWorkingHours(staffId, workingHours);
        if (h.error) throw new Error(h.error.message || 'Could not save working hours.');
        await loadTherapist(); loadOverview(); loadActivity();
      } else if (id === 'pay') {
        const p = await setStaffCompensation({ therapistId: staffId, monthlySalary: pay.monthlySalary || 0, commissionRate: pay.commissionRate || 0, productCommissionRate: pay.productCommissionRate || 0 });
        if (p.error) throw new Error(p.error.message || 'Could not save pay.');
        await loadPay(); loadEarnings(); loadActivity();
      }
      setSaving(false);
      setEditing((e) => (e === id ? null : e));
      return true;
    } catch (err) {
      setSaving(false); setUploadingPhoto(false);
      fail(id, err.message || 'Operation failed.');
      return false;
    }
  };

  // Create: everything in one go, then land on the new profile.
  const handleCreate = async () => {
    if (!form.name.trim()) { fail('profile', `${staffLabel} name is required.`); return; }
    setSaving(true); setSectionError(null);
    try {
      const created = await createTherapist({ ...(await profilePayload()), branchId: effectiveBranchId });
      if (created.error) throw new Error(created.error.message || 'Operation failed.');
      const h = await upsertTherapistWorkingHours(created.data.id, workingHours);
      setSaving(false);
      if (h.error) { fail('hours', `Created, but working hours did not save: ${h.error.message || ''}`); }
      setForm(EMPTY_FORM); setWorkingHours(DEFAULT_WORKING_HOURS); // nothing left to guard once it exists
      navigate(`/${orgSlug}/staff/${created.data.id}`, { replace: true });
    } catch (err) {
      setSaving(false); setUploadingPhoto(false);
      fail('profile', err.message || 'Operation failed.');
    }
  };

  // ── edit state machine ────────────────────────────────────────────────────
  const focusField = (id, field) => setTimeout(() => {
    const root = document.getElementById(`sec-${id}`);
    const wrap = field ? root?.querySelector(`[data-field="${field}"]`) : null;
    (wrap?.querySelector('input,textarea,button,select') || root?.querySelector('input,textarea'))?.focus();
  }, 60);
  const openSection = (id, field) => { setSectionError(null); setEditing(id); focusField(id, field); };
  const requestEdit = (id, field) => {
    if (!sectionsEditable[id] || editing === id) { if (editing === id) focusField(id, field); return; }
    if (editing && dirtySection(editing)) { setAsk({ next: id, field }); return; }
    if (editing) cancelSection(editing);
    openSection(id, field);
  };

  useEffect(() => {
    if (!isEdit || !editing) return undefined;
    const onKey = (e) => {
      if (ask) return;
      if (e.key === 'Escape' && !saving) { e.preventDefault(); cancelSection(editing); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !saving) { e.preventDefault(); saveSection(editing); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // The leave guard covers whatever is unsaved in the open section (create mode: the whole form).
  const dirtyCount = isEdit ? (editing ? countOf[editing] || 0 : 0) : (form.name.trim() ? 1 : 0) + (hoursDirty ? 1 : 0);
  const dirty = dirtyCount > 0;
  useDirtyGuard(dirty, dirtyCount);
  const guardedNavigate = useGuardedNavigate();
  const go = (path) => guardedNavigate(path);
  const dash = (view) => `/${orgSlug}/dashboard?view=${view}`;
  const goList = () => go(dash('therapists'));

  // ── scroll spy, compact bar, click-to-scroll ──────────────────────────────
  // lg+: the shell's inner `.content-scroll` element scrolls (even while the content is still short); below lg the window does.
  const getScroller = () => {
    const el = rootRef.current?.closest('.content-scroll');
    return el && window.matchMedia('(min-width: 1024px)').matches ? el : null;
  };
  const spyLock = useRef(0); // a rail click scrolls smoothly; the spy stays quiet until it lands
  const sectionIds = visibleSections.map((s) => s.id);
  useEffect(() => {
    if (pageLoading || loadError) return undefined;
    const sc = getScroller();
    const target = sc || window;
    const spy = () => {
      if (Date.now() < spyLock.current) return;
      const top = sc ? sc.getBoundingClientRect().top : 0;
      const h = headerRef.current?.getBoundingClientRect();
      setCompact(!!h && h.bottom - top < 56);
      let cur = sectionIds[0];
      for (const id of sectionIds) {
        const el = document.getElementById(`sec-${id}`);
        if (el && el.getBoundingClientRect().top - top <= 140) cur = id;
      }
      const maxScroll = sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight;
      const atEnd = maxScroll > 8 && (sc ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4 : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4);
      if (atEnd) cur = sectionIds[sectionIds.length - 1];
      setCurrent(cur);
    };
    target.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', spy);
    spy();
    return () => { target.removeEventListener('scroll', spy); window.removeEventListener('resize', spy); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLoading, loadError, sectionIds.join(','), overview, matrix, activity]);

  const scrollToSection = (id, smooth = true) => {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    if (smooth) { setCurrent(id); spyLock.current = Date.now() + 900; setTimeout(() => window.dispatchEvent(new Event('resize')), 950); }
    const sc = getScroller();
    const behavior = smooth ? 'smooth' : 'auto';
    if (sc) sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 72, behavior });
    else window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 72, behavior });
  };
  const requestedSlug = idOfSlug(new URLSearchParams(location.search).get('section')) || idOfSlug(location.hash.replace('#', ''));
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || pageLoading || !therapist || !requestedSlug || requestedSlug === 'overview') return;
    jumped.current = true;
    setTimeout(() => scrollToSection(requestedSlug, false), 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLoading, therapist, requestedSlug]);

  // ── header status line ────────────────────────────────────────────────────
  const todayWeek = overview?.week?.find((d) => d.date === today);
  // The one "today" line (utils/todayStatusLine), the same wording as the Therapists list, the calendar header and Free now.
  const statusLine = todayWeek ? todayStatusLine({
    hours: todayWeek.hours || hoursFromShiftRow(null),
    attendance: todayWeek.attendanceStatus ? { status: todayWeek.attendanceStatus, checkInTime: nepalClock(todayWeek.checkInTime) || null, checkOutTime: nepalClock(todayWeek.checkOutTime) || null } : null,
    nowMin: timeToMinutes(nowTime) ?? 0,
    branchClosed: !!overview?.branchClosedToday,
    back: overview?.nextWork || null,
  }) : null;
  const statusText = statusLine ? statusLine.full : null;
  const th = todayWeek?.hours;
  const working = th && !th.isDayOff && th.startTime && th.endTime && th.source !== 'none' && !['closed', 'leave', 'off', 'absent'].includes(statusLine?.key);
  const shiftText = working && statusLine?.key === 'finished' && !/shift/i.test(statusText || '') ? `shift ${th.startTime.slice(0, 5)} – ${th.endTime.slice(0, 5)}` : null;
  const nextBreak = working ? (th.breaks || []).find((b) => String(b.endTime).slice(0, 5) > nowTime) : null;
  const breakText = nextBreak ? `${(nextBreak.name || 'break').toLowerCase()} ${String(nextBreak.startTime).slice(0, 5)} – ${String(nextBreak.endTime).slice(0, 5)}` : null;
  const checkedIn = !!todayWeek?.checkInTime && statusLine?.key !== 'finished';

  const positionText = form.positions[0] || (form.isServiceStaff ? staffLabel : `Support ${staffLabel.toLowerCase()}`);
  const savedPhoto = photoPreview || saved.form.photoUrl;
  const servicesCount = matrix ? matrix.categories.reduce((n, c) => n + c.services.filter((s) => s.openToAll || ticked.has(s.id)).length, 0) : null;
  const displayName = isEdit ? saved.form.name : `New ${staffLabel.toLowerCase()}`;
  const dotClass = !isEdit ? 'bg-[#C9C9CE]' : therapist?.is_active === false ? 'bg-[#C9C9CE]' : checkedIn ? 'bg-[#3E9A4E]' : 'bg-[#C9C9CE]';

  const Avatar = ({ size }) => (
    <div className={`relative flex-shrink-0 rounded-full bg-gradient-to-br from-[#E3ECE0] to-[#CFDDCB] text-primary font-heading font-heading-semibold flex items-center justify-center ${size === 'lg' ? 'w-16 h-16 text-xl' : 'w-[30px] h-[30px] text-xs'}`}>
      {savedPhoto ? <img src={savedPhoto} alt="" className="w-full h-full object-cover rounded-full" /> : initialsOf(form.name)}
      {isEdit && <i className={`absolute right-0 bottom-0 rounded-full ${dotClass} ${size === 'lg' ? 'w-3.5 h-3.5 right-0.5 bottom-0.5 ring-[3px] ring-white' : 'w-2 h-2 ring-2 ring-white'}`} />}
    </div>
  );
  const StatusPill = () => statusText ? (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${therapist?.is_active === false ? 'bg-background text-text-secondary border border-border' : 'bg-primary/10 text-primary'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} style={statusLine && therapist?.is_active !== false ? { background: STATUS_DOT_COLOR[statusLine.dot] } : undefined} />{therapist?.is_active === false ? 'Inactive' : statusText}
    </span>
  ) : null;
  const HeaderActions = ({ small }) => isEdit ? (
    <div className="flex items-center gap-2 relative">
      <Button variant="outline" size="sm" iconName="Calendar" onClick={() => go(dash('calendar') + `&therapist=${staffId}`)}>{small ? <span className="hidden sm:inline">Calendar</span> : 'Calendar'}</Button>
      <Button variant="outline" size="sm" iconName="Clock" onClick={() => go(dash('attendance') + `&therapist=${staffId}`)}>{small ? <span className="hidden sm:inline">Attendance</span> : 'Attendance'}</Button>
      <Button variant="outline" size="sm" aria-label="More" onClick={() => setMenuOpen((v) => !v)}><Icon name="MoreHorizontal" size={16} /></Button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-dropdown" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown py-1 text-sm">
            {canEdit && <button type="button" className="w-full text-left px-3 py-2 hover:bg-background" onClick={() => { setMenuOpen(false); go(dash('roster')); }}>Open roster</button>}
            <button type="button" className="w-full text-left px-3 py-2 hover:bg-background" onClick={() => { setMenuOpen(false); go(dash('therapists')); }}>Back to {staffLabel.toLowerCase()} list</button>
          </div>
        </>
      )}
    </div>
  ) : null;

  // ── sections ──────────────────────────────────────────────────────────────
  const msgFor = (id) => (dirtySection(id) ? <><b className="font-semibold text-text-primary">{countOf[id]} unsaved change{countOf[id] === 1 ? '' : 's'}</b> in {TITLES[id]}</> : <>Editing <b className="font-semibold text-text-primary">{TITLES[id]}</b> · no changes yet</>);
  const isOpen = (id) => !isEdit || editing === id;
  const sectionProps = (id) => ({
    id,
    title: TITLES[id],
    editing: isEdit && editing === id,
    dimmed: isEdit && !!editing && editing !== id,
    canEdit: isEdit && sectionsEditable[id],
    onEdit: () => requestEdit(id),
    editBar: isEdit && editing === id ? <EditBar message={msgFor(id)} onCancel={() => cancelSection(id)} onSave={() => saveSection(id)} saving={saving} /> : null,
  });
  const errorIn = (id) => sectionError?.section === id ? <div className="mt-3"><Problem message={sectionError.message} /></div> : null;
  const subs = {
    profile: 'What your team and customers see',
    services: matrix ? `${servicesCount} of ${matrix.categories.reduce((n, c) => n + c.services.length, 0)} services` : null,
    hours: 'The usual week',
    pay: canEditPay ? 'Admins only · the same numbers Payroll uses' : 'View only · the same numbers Payroll uses',
  };
  const transferLabels = { branch: (locationLabel || 'branch').toLowerCase() };
  const openTransfer = transfers.find((t) => !t.isReturnLeg && ['upcoming', 'now', 'permanent-upcoming'].includes(transferState(t.input)));
  const openTransferDesc = openTransfer ? describeTransfer(openTransfer.input, { viewpoint: 'home', use24h, labels: transferLabels }) : null;
  // The window as minutes of today (Nepal), for Today's timeline.
  const transferToday = (() => {
    const endOf = (i) => (i.reverted && i.revertedAt ? i.revertedAt : i.revertAt);
    const t = transfers.find((x) => {
      if (x.isReturnLeg || !x.input.revertAt) return false;   // upcoming (not yet applied) windows draw too
      const a = toKathmanduParts(x.input.startAt); const b = toKathmanduParts(endOf(x.input));
      return a && b && a.date <= today && b.date >= today;
    });
    if (!t) return null;
    const a = toKathmanduParts(t.input.startAt); const b = toKathmanduParts(endOf(t.input));
    const m = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
    const from = a.date < today ? '00:00' : a.time; const to = b.date > today ? '24:00' : b.time;
    return { startMin: m(from), endMin: m(to), label: `At ${t.input.toBranch || 'another branch'}`, title: describeTransfer(t.input, { viewpoint: 'home', use24h, labels: transferLabels }).sentence };
  })();
  const monthLabel = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const todayCount = (overview?.todayBookings || []).filter((b) => !['Cancelled', 'No Show'].includes(b.status)).length;
  const overviewSub = form.isServiceStaff ? `${monthLabel} · ${todayCount} booking${todayCount === 1 ? '' : 's'}` : new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }) + ' so far';

  const profileEl = (
    <ProfileSection editing={isOpen('profile')} form={form} setForm={setForm} changed={changedFormKeys} readOnly={!canEdit} isAdmin={isAdmin} enableStaffRatings={enableStaffRatings}
      allPositionNames={allPositionNames} staffLabel={staffLabel} photoPreview={photoPreview} uploadingPhoto={uploadingPhoto}
      onPhotoChange={handlePhotoChange} onRemovePhoto={handleRemovePhoto} isCreate={!isEdit} onAdd={(field) => requestEdit('profile', field)} />
  );
  const servicesEl = (
    <ServicesSection editing={isOpen('services')} matrix={matrix} loading={matrixLoading} error={matrixError} onRetry={loadMatrix} tickedSet={ticked} setTicked={setTicked}
      readOnly={!canEdit} form={form} isCreate={!isEdit} staffLabel={staffLabel} />
  );
  const hoursEl = (
    <HoursSection editing={isOpen('hours')} rows={workingHours} savedRows={isEdit ? saved.hours : DEFAULT_WORKING_HOURS} onChange={setWorkingHours} readOnly={!canEdit}
      overrides={overrides} overridesLoading={overridesLoading} overridesError={overridesError} canOpenRoster={canEdit} openRoster={() => go(dash('roster'))} isCreate={!isEdit} />
  );

  return (
    <AppShell variant="flush" sidebar={{ userRole: role }} header={{ realtimeStatus: 'connected' }}>
      <div ref={rootRef} className="bg-surface min-h-full pb-24">
        {isEdit && !pageLoading && !loadError && (
          <div aria-hidden={!compact} className={`sticky top-0 z-sticky-filter h-14 -mb-14 flex items-center gap-3 px-4 sm:px-6 lg:px-10 bg-white/85 backdrop-blur-md border-b transition-opacity duration-200 ${compact ? 'opacity-100 border-border' : 'opacity-0 pointer-events-none border-transparent'}`}>
            <Avatar size="sm" />
            <span className="font-heading font-heading-semibold text-[15px] text-text-primary truncate">{displayName}</span>
            <StatusPill />
            <div className="ml-auto"><HeaderActions small /></div>
          </div>
        )}

        <div className="px-4 sm:px-6 lg:px-10">
          <nav className="flex items-center gap-1.5 text-sm text-text-secondary pt-5" aria-label="Breadcrumb">
            <button type="button" onClick={goList} className="inline-flex items-center gap-1 hover:text-text-primary"><Icon name="ChevronLeft" size={14} />{staffLabelPlural}</button>
            <span>/</span>
            <span className="text-text-primary truncate">{isEdit ? (saved.form.name || '…') : `Add ${staffLabel.toLowerCase()}`}</span>
          </nav>

          {pageLoading ? <Loading /> : loadError ? <div className="mt-4"><Problem message={loadError} /></div> : (
            <>
              <header ref={headerRef} className="flex flex-wrap items-center gap-[18px] pt-5 pb-5">
                <Avatar size="lg" />
                <div className="flex-1 min-w-[220px]">
                  <h1 className="font-heading font-heading-semibold text-2xl text-text-primary">{displayName}</h1>
                  <p className="mt-1 text-sm text-text-secondary">
                    {[positionText, branchName, isEdit && sinceText(therapist?.created_at) ? `Since ${sinceText(therapist.created_at)}` : null].filter(Boolean).join(' · ')}
                  </p>
                  {isEdit && (statusText || shiftText) && (
                    <p className="mt-2 text-sm text-text-secondary flex flex-wrap items-center gap-x-2">
                      {statusText && <span className="inline-flex items-center gap-1.5 text-text-primary font-medium"><span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} style={statusLine ? { background: STATUS_DOT_COLOR[statusLine.dot] } : undefined} />{statusText}</span>}
                      {shiftText && <span>· {shiftText}</span>}
                      {breakText && <span>· next break {breakText}</span>}
                      {therapist?.is_active === false && <span className="font-medium text-text-primary">· Inactive</span>}
                    </p>
                  )}
                </div>
                <HeaderActions />
              </header>

              {isEdit && openTransferDesc && (
                <div data-transfer-banner className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-spa border border-border bg-surface px-4 py-3">
                  <TransferPill state={openTransferDesc.state}>{openTransferDesc.pill}</TransferPill>
                  <span className="flex-1 min-w-[200px] text-sm text-text-primary">{openTransferDesc.sentence}</span>
                  <button type="button" onClick={() => setTransferPanel(true)} className="text-sm font-medium text-primary hover:underline">View</button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)] gap-x-12 border-t border-border pt-7">
                <nav aria-label="Profile sections" className="hidden lg:block sticky top-20 self-start pl-3.5">
                  <span aria-hidden className="absolute left-0 top-1 bottom-1 w-px bg-border" />
                  <span aria-hidden className="absolute left-0 top-0 w-0.5 h-5 rounded bg-text-primary transition-transform duration-300" style={{ transform: `translateY(${Math.max(0, sectionIds.indexOf(current)) * 28 + 4}px)` }} />
                  {visibleSections.map((s) => {
                    const label = s.id === 'overview' ? (form.isServiceStaff ? 'Today' : 'Overview') : s.label;
                    return (
                      <button key={s.id} type="button" onClick={() => scrollToSection(s.id)} aria-current={current === s.id ? 'true' : undefined}
                        className={`flex items-center w-full h-7 text-sm font-medium text-left transition-colors ${current === s.id ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}>
                        {label}
                        {s.id === 'services' && servicesCount != null && <span className="ml-auto text-xs font-normal text-text-tertiary">{servicesCount}</span>}
                        {isEdit && dirtySection(s.id) && editing === s.id && <span className="ml-2 w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved changes" />}
                      </button>
                    );
                  })}
                </nav>

                <div className="min-w-0">
                  {isEdit && (
                    <Section id="overview" first title={form.isServiceStaff ? 'Today' : 'Overview'} sub={overviewSub} dimmed={!!editing}
                      right={form.isServiceStaff ? <button type="button" onClick={() => go(dash('calendar') + `&therapist=${staffId}`)} className="text-sm font-medium text-primary hover:underline">Open calendar</button> : null}>
                      <OverviewSection data={overview} loading={overviewLoading} error={overviewError} onRetry={loadOverview} today={today} nowTime={nowTime}
                        isServiceStaff={form.isServiceStaff} attendanceRows={(attendance || []).map((r) => ({ ...r, status: r.status }))}
                        onOpenBooking={setOpenBooking} openCalendar={() => go(dash('calendar') + `&therapist=${staffId}`)} showCommission={canSeePay} transferToday={transferToday} />
                      {!form.isServiceStaff && (
                        <p className="mt-4 flex items-start gap-2 text-sm text-text-secondary"><Icon name="AlertTriangle" size={14} className="mt-0.5 flex-shrink-0" />
                          <span>{firstName || 'This person'} is support staff, so bookings, revenue and commission don't apply.{canEdit && <> <button type="button" onClick={() => requestEdit('profile', 'type')} className="text-primary font-medium hover:underline">Make bookable</button></>}</span>
                        </p>
                      )}
                    </Section>
                  )}

                  <Section {...sectionProps('profile')} first={!isEdit} sub={isEdit ? subs.profile : `Who this ${staffLabel.toLowerCase()} is, and what customers see when they book online.`}>
                    {profileEl}{errorIn('profile')}
                  </Section>

                  {(form.isServiceStaff || !isEdit) && (
                    <Section {...sectionProps('services')} sub={isEdit ? subs.services : null}>{servicesEl}{errorIn('services')}</Section>
                  )}

                  <Section {...sectionProps('hours')} sub={subs.hours}>{hoursEl}{errorIn('hours')}</Section>

                  {isEdit && canSeePay && (
                    <Section {...sectionProps('pay')} sub={subs.pay}>
                      <PaySection editing={editing === 'pay'} pay={pay} setPay={setPay} savedPay={saved.pay} canEdit={canEditPay} loading={payLoading} error={payError} onRetry={loadPay}
                        earnings={earnings} earningsLoading={earningsLoading} earningsError={earningsError} periodMonth={periodMonth}
                        goPayroll={() => go(dash('payroll'))} canOpenPayroll={canSeePay} staffLabel={staffLabel} isServiceStaff={form.isServiceStaff} />
                      {errorIn('pay')}
                    </Section>
                  )}

                  {isEdit && (
                    <Section id="history" title="History" sub={attendance?.length ? attendanceSummary(attendance) || null : null} dimmed={!!editing}>
                      <div className="mt-4">
                        <HistorySection month={periodMonth} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError}
                          activity={activity} activityLoading={activityLoading} activityError={activityError} onRetry={loadActivity}
                          filter={activityFilter} setFilter={setActivityFilter} canSeePay={canSeePay} firstName={firstName || `this ${staffLabel.toLowerCase()}`} openAttendance={() => go(dash('attendance') + `&therapist=${staffId}`)} />
                      </div>
                    </Section>
                  )}

                  {!isEdit && canEdit && (
                    <EditBar message={form.name.trim() ? `New ${staffLabel.toLowerCase()}` : `Add a name to create this ${staffLabel.toLowerCase()}`} hint={false} onSave={handleCreate} saving={saving} canSave={!!form.name.trim()} saveLabel={`Create ${staffLabel.toLowerCase()}`} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {ask && (
          <ConfirmDialog
            title={`Save changes to ${TITLES[editing]}?`}
            message={`You have unsaved changes. Save them before editing ${TITLES[ask.next]}, or discard them.`}
            requireReason={false} confirmVariant="primary" confirmLabel="Save" cancelLabel="Keep editing" secondaryLabel="Discard" isSubmitting={saving}
            onClose={() => setAsk(null)}
            onSecondary={() => { const n = ask; cancelSection(editing); setAsk(null); openSection(n.next, n.field); }}
            onConfirm={async () => { const n = ask; const ok = await saveSection(editing); setAsk(null); if (ok) openSection(n.next, n.field); }}
          />
        )}

        {conflictModal}

        {transferPanel && openTransfer && (
          <TransferManagementModal
            variant="panel"
            therapistId={staffId}
            therapistName={displayName}
            currentBranchId={openTransfer.fromBranchId}
            use24h={use24h}
            onClose={() => setTransferPanel(false)}
            onSuccess={() => { setTransferPanel(false); loadTransfers(); loadActivity(); loadOverview(); }}
          />
        )}
        <TodayBookingPanel booking={openBooking} branchId={effectiveBranchId} onClose={() => setOpenBooking(null)} onChanged={loadOverview} />
      </div>
    </AppShell>
  );
};

export default StaffDetailPage;
