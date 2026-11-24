import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { viewerAccess } from '../../../../services/dataMasking';
import Icon from '../../../../components/AppIcon';
import DateTimeRow from '../../../../components/ui/DateTimeRow';
import { format12h } from '../../../../utils/timeInput';
import SidePanel, { PANEL_WIDTH_BOOKING } from '../../../../components/ui/SidePanel';
import BlockOverlapWarning from '../../../../components/ui/BlockOverlapWarning';
import AvailabilityNotice from '../../../../components/ui/AvailabilityNotice';
import { useAvailabilityPrecheck } from '../../../../hooks/useAvailabilityPrecheck';
import { useIndustry } from '../../../../hooks/useIndustry';
import ServicePickRow from '../../../../components/ui/ServicePickRow';
import CustomerPickRow from '../../../../components/ui/CustomerPickRow';
import { phoneProblem } from '../../../../utils/phone';
import { customerSavePayload, customerMissing, seedFromSearch, PICK_REASON } from '../../../../utils/customerPick';
import RoomPickRow from '../../../../components/ui/RoomPickRow';
import ErrorGuide from '../../../../components/ui/GuideCard';
import { describeError, makeRef } from '../../../../utils/errorGuide';
import { roomStates } from '../../../../utils/roomPick';
import { parsePhone } from '../../../../components/ui/CountryCodeSelect'
import PhoneField, { usePhoneState } from '../../../../components/ui/PhoneField';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import { useDayBlocks } from '../../../../hooks/useBlockOverlap';
import { findBlockOverlap, describeBlockOverlap } from '../../../../utils/blockOverlap';
import { getCustomerOutstandingBalance, fetchCustomerName, fetchServiceComboComponents, fetchServices, fetchServiceEligibility } from '../../../../services/api';
import { homeServiceNameSet, servicesBookableHere } from '../../../../utils/visitorServices';
import { CUSTOMER_REFERRALS_ENABLED } from '../../../../lib/featureFlags';
import StaffPicker, { useServiceEligibility } from '../../../../components/ui/StaffPicker';
import { Segmented } from '../../../../components/ui/PanelFormKit';
import { ExistingCustomerTag, EarlierBalanceNotice } from '../../../../components/ui/ExistingCustomerNotes';
import { nepalNow } from '../../../../utils/customerDirectory';
import { useDayAvailability } from '../../../../hooks/useDayAvailability';
import StaffPickRow from '../../../../components/ui/StaffPickRow';
import { staffPickIncomplete, staffDayRanges, arrangeByTime, staffHeldByOthers, pickProblems, fillFreeStaff, undoFill, rangeLabel, rangeClock, pillRange, clockShort, pickedRowStatus, pickedRowStatusMulti, clockToMin } from '../../../../utils/staffFit';
import { friendlyError } from '../../../../utils/friendlyError';
import { shouldShowFillFree } from '../../../../utils/serviceCatalog';
import { fieldForErrorCode } from '../../../../utils/quickCreateErrorField';
import { useOrg } from '../../../../contexts/OrgContext';
import ExtraServiceRows from './ExtraServiceRows';
import { rowTimes, rowsIncompleteReason, toGroupServices, ownOverlaps } from './multiServiceRows';


// ZNLY-365: the client row when the panel was opened from a booking ("+ Service" / Rebook). Not editable: same client as that booking.
const LockedClientCard = ({ client, name }) => {
  const label = client.kind === 'walkin' ? `Walk-in${client.walkInLabel ? ` · ${client.walkInLabel}` : ''}` : (name || client.name || 'Client');
  const initials = client.kind === 'walkin' ? 'WI' : label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div data-locked-client className="flex items-center gap-2.5 rounded-spa bg-[#F4F4F6] px-3 py-2">
      <span className="grid h-[30px] w-[30px] flex-shrink-0 place-items-center rounded-full bg-[#fde7c7] text-[11px] font-semibold text-secondary">{initials}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{label}</span>
        <span className="block truncate text-xs text-text-secondary">
          {client.bookingNumber ? `Same client as ${client.bookingNumber}` : 'Same client'}
          {client.kind === 'walkin' && <span className="ml-1.5 rounded-full bg-[#FDF1DC] px-2 py-px text-[11px] font-medium text-secondary">Walk-in</span>}
        </span>
      </span>
      <span className="flex flex-shrink-0 items-center gap-1 text-[11px] text-[#8A8A90]"><Icon name="Lock" size={12} />same client</span>
    </div>
  );
};

// ── Quick Create Panel ────────────────────────────────────────

const QuickCreatePanel = ({ slotInfo, services, servicesLoading, therapists, rooms, bookings = [], onClose, onSubmit, branchId, branchHours, retarget, onDraftChange, columnMode = 'therapist', allTherapists = [], guardRef, offStaff = {}, offDate = null, onRefreshCalendar }) => {
  const { profile: viewerProfile } = useAuth();
  const { allowStaffOverlap, requireCustomerPhone, multiServiceBookings } = useOrg();   // ZNLY-389 / ZNLY-390: per-org booking rules
  // ZNLY-278: an own-only login books only itself; the data layer hands it a single team member, so that one is the default.
  const defaultTherapistId = viewerAccess(viewerProfile).ownOnly && therapists?.length === 1 ? therapists[0].id : null;
  const canViewPrices = viewerAccess(viewerProfile).canViewPrices; // ZNLY-235: no prices for this login
  const [serviceId, setServiceId] = useState('');
  // ZNLY-402 piece 3b: extra services of the same booking (only when the org setting is ON; [] otherwise and the panel is exactly as before).
  const [extraRows, setExtraRows] = useState([]);
  const [errorRow, setErrorRow] = useState(null);   // which service (1 = the second) the refused save was about
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCountryCode, setCustomerCountryCode] = useState('+977');
  // Set only when opened from a waitlist entry with a linked customer: createBooking resolves the real customer by id
  // server-side, so a restricted account's masked name/phone copies are never written.
  const [knownCustomerId, setKnownCustomerId] = useState(null);
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerGender, setCustomerGender] = useState('');
  // ZNLY-327: how the customer was chosen: 'new' (typed details) | 'existing' (picked) | 'walkin' (no profile) | null (nothing picked yet).
  const [customerKind, setCustomerKind] = useState(null);
  const [profileMissing, setProfileMissing] = useState({ email: false, gender: false }); // an existing customer's profile lacks these: show the fields to fill them
  const [walkInLabel, setWalkInLabel] = useState(''); // optional first name for a walk-in
  const [specialRequests, setSpecialRequests] = useState('');
  const [dragMinutes, setDragMinutes] = useState(0); // length of the range dragged on the grid; used until a service is picked
  const [selectedTherapistIds, setSelectedTherapistIds] = useState([]);
  const [roomId, setRoomId] = useState('');
  const [openServiceSignal, setOpenServiceSignal] = useState(0);
  // Couple (is_couple service + 2 therapists, Individual mode): per-companion (non-primary therapist) room override and
  // the companion's name/phone. Not used by the Group flow.
  const [therapistRoomOverrides, setTherapistRoomOverrides] = useState({});
  const [companionName, setCompanionName] = useState('');
  // Combo service: each component carries default_same_staff / default_same_room — true auto-uses the therapist/room picked
  // below, false means staff pick a separate one for that component here.
  const [comboComponents, setComboComponents] = useState([]);
  const [comboComponentsLoading, setComboComponentsLoading] = useState(false);
  const [comboTherapistOverrides, setComboTherapistOverrides] = useState({}); // serviceId -> therapistId
  const [comboRoomOverrides, setComboRoomOverrides] = useState({}); // serviceId -> roomId
  const companionPhone = usePhoneState('');
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  // Group booking state (Individual = default, behaves exactly as before)
  const [bookingMode, setBookingMode] = useState('individual'); // 'individual' | 'group'
  const [groupType, setGroupType] = useState('couple');         // 'couple' | 'separate'
  const [separateCount, setSeparateCount] = useState(3);        // people when 'separate'
  const [countText, setCountText] = useState('3');              // editable text for the count combo
  const [countDropdownOpen, setCountDropdownOpen] = useState(false);
  const countDropdownRef = useRef(null);
  const [serviceMode, setServiceMode] = useState('same');       // 'same' | 'different'
  const [groupServiceId, setGroupServiceId] = useState('');     // shared service when 'same'
  const [groupRoomId, setGroupRoomId] = useState('');           // shared room (couple)
  const [people, setPeople] = useState([]);                     // per-person rows
  const [submitting, setSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [errorCard, setErrorCard] = useState(null);   // the ✦ / system card for the refused save, built once so a system error keeps one reference id
  const [roomSignal, setRoomSignal] = useState(0);
  const [errorKey, setErrorKey] = useState(null); // snapshot of the form when the rejection came back: the reason stands until something relevant changes
  const nameRef = useRef(null);
  const initialDraftRef = useRef({ date: '', time: '', therapist: '', room: '', service: '' });
  // Inline confirm in the footer: { type: 'discard' } or { type: 'move', slot }. Replaces window.confirm.
  const [confirm, setConfirm] = useState(null);

  // Previous-due reminder — set when the selected/typed phone matches an existing
  // outstanding balance from an earlier visit. Non-blocking: booking creation isn't
  // gated on this; the due gets bundled into payment collection later.
  const [previousDue, setPreviousDue] = useState(null);

  // Customer referral (migration-078) — individual mode only. isExistingCustomer
  // flips true only when staff picks a suggestion from CustomerAutocomplete; the
  // authoritative new-vs-existing check happens server-side in createBooking().
  const [isExistingCustomer, setIsExistingCustomer] = useState(false);
  const [referringCustomerId, setReferringCustomerId] = useState('');
  const [referringCustomerPhone, setReferringCustomerPhone] = useState('');
  const [referringCustomerCountryCode, setReferringCustomerCountryCode] = useState('+977');
  const [referringCustomerName, setReferringCustomerName] = useState('');
  const [referringRewardAmount, setReferringRewardAmount] = useState('');

  const checkPreviousDue = useCallback(async (phone) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 7) {
      setPreviousDue(null);
      return;
    }
    const { data } = await getCustomerOutstandingBalance({ customerPhone: phone, branchId });
    setPreviousDue(data && data.totalDue > 0 ? data : null);
  }, [branchId]);

  const handleCustomerSelect = useCallback((customer) => {
    // Clicking a specific suggestion is a disambiguated choice — the row already
    // showed this exact phone (and membership badge, when duplicate names exist)
    // for staff to verify before clicking — so it's safe to fill from here.
    setCustomerName(customer.full_name);
    const { dial, national } = parsePhone(customer.phone);
    setCustomerPhone(national);
    setCustomerCountryCode(dial);
    setCustomerEmail(customer.email || '');
    setCustomerGender(customer.gender || '');
    setIsExistingCustomer(true);
    setReferringCustomerId('');
    setReferringCustomerPhone('');
    setReferringCustomerCountryCode('+977');
    setReferringCustomerName('');
    setReferringRewardAmount('');
    checkPreviousDue(customer.phone);
  }, [checkPreviousDue]);

  const handleCustomerPick = (choice) => {
    if (choice.kind === 'walkin') {
      setCustomerKind('walkin');
      setCustomerName(''); setCustomerPhone(''); setCustomerEmail(''); setCustomerGender('');
      setKnownCustomerId(null); setIsExistingCustomer(false); setPreviousDue(null);
      setReferringCustomerId(''); setReferringCustomerPhone(''); setReferringCustomerName(''); setReferringRewardAmount('');
    } else if (choice.kind === 'existing') {
      handleCustomerSelect(choice.customer);
      setKnownCustomerId(null); // saved by phone as before, so an email / gender typed below reaches the profile
      setProfileMissing({ email: !choice.customer.email, gender: !choice.customer.gender });
      setCustomerKind('existing');
    } else {
      const seed = seedFromSearch(choice.seed);
      if (customerKind === 'new' && !choice.seed) return;
      setCustomerKind('new');
      setKnownCustomerId(null); setIsExistingCustomer(false); setPreviousDue(null);
      setCustomerName(seed.name); setCustomerPhone(seed.phone); setCustomerEmail(''); setCustomerGender('');
    }
  };

  const handleCustomerNameChange = useCallback((v) => {
    setCustomerName(v);
    setIsExistingCustomer(false);
  }, []);

  const handleCustomerPhoneChange = useCallback((v) => {
    setCustomerPhone(v);
    setIsExistingCustomer(false);
  }, []);

  const handleReferringPhoneChange = useCallback((v) => {
    setReferringCustomerPhone(v.replace(/\D/g, '').slice(0, 15));
    setReferringCustomerId('');
  }, []);

  const handleReferringNameChange = useCallback((v) => {
    setReferringCustomerName(v);
    setReferringCustomerId('');
  }, []);

  const handleReferringCustomerSelect = useCallback((customer) => {
    setReferringCustomerName(customer.full_name);
    const { dial, national } = parsePhone(customer.phone);
    setReferringCustomerPhone(national);
    setReferringCustomerCountryCode(dial);
    setReferringCustomerId(customer.id);
  }, []);

  // A locked known client shows (and saves under) the client RECORD's name, e.g. a walk-in booking that got a client linked.
  useEffect(() => {
    const lc = slotInfo?.lockedClient;
    if (!lc || lc.kind !== 'existing' || !lc.customerId) return undefined;
    let live = true;
    fetchCustomerName(lc.customerId).then(({ data }) => { if (live && data) setCustomerName(data); }).catch(() => {});
    return () => { live = false; };
  }, [slotInfo]);

  // Reset form when slot changes + pre-select therapist/room from column
  useEffect(() => {
    setServiceId(slotInfo?.defaultServiceId || '');
    setCustomerName(slotInfo?.defaultCustomerName || '');
    setCustomerPhone(slotInfo?.defaultCustomerPhone || '');
    setCustomerCountryCode(slotInfo?.defaultCustomerCountryCode || '+977');
    setKnownCustomerId(slotInfo?.defaultCustomerId || null);
    setCustomerEmail(slotInfo?.defaultCustomerEmail || '');
    setCustomerGender(slotInfo?.defaultCustomerGender ? String(slotInfo.defaultCustomerGender).toLowerCase() : '');
    // The dashboard Walk-in button opens with Walk-in preselected; a known customer (Book from Customers / waitlist) starts as an existing pick.
    // ZNLY-365: "+ Service" / Rebook open this panel locked to the booking's client (a walk-in stays a walk-in; a known client is used by record).
    const lc = slotInfo?.lockedClient || null;
    setCustomerKind(lc ? lc.kind : slotInfo?.walkIn ? 'walkin'
      : slotInfo?.defaultCustomerId || (slotInfo?.defaultCustomerExisting && slotInfo?.defaultCustomerPhone) ? 'existing'
        : (slotInfo?.defaultCustomerName || slotInfo?.defaultCustomerPhone) ? 'new' : null);
    setWalkInLabel(lc?.kind === 'walkin' ? (lc.walkInLabel || '') : '');
    setProfileMissing(lc ? { email: false, gender: false } : { email: !slotInfo?.defaultCustomerEmail, gender: !slotInfo?.defaultCustomerGender });
    setSpecialRequests('');
    setIsExistingCustomer(false);
    setReferringCustomerId('');
    setReferringCustomerPhone('');
    setReferringCustomerCountryCode('+977');
    setReferringCustomerName('');
    setReferringRewardAmount('');
    setSelectedTherapistIds(slotInfo?.colType === 'therapist' && slotInfo.colId ? [slotInfo.colId] : slotInfo?.defaultTherapistIds?.length ? slotInfo.defaultTherapistIds : (defaultTherapistId ? [defaultTherapistId] : []));
    // The service list opens first when the panel is opened to add a service.
    setOpenServiceSignal(slotInfo?.openServiceFirst ? Date.now() : 0);
    setRoomId(slotInfo?.colType === 'room' ? slotInfo.colId : '');
    setTherapistRoomOverrides({});
    setCompanionName('');
    companionPhone.reset('');
    setComboComponents([]);
    setComboTherapistOverrides({});
    setComboRoomOverrides({});
    setBookingDate(slotInfo?.day || '');
    const slotTime = slotInfo && Number.isFinite(slotInfo.hour) && Number.isFinite(slotInfo.minute)
      ? `${String(slotInfo.hour).padStart(2, '0')}:${String(slotInfo.minute).padStart(2, '0')}`
      : '';
    setBookingTime(slotTime);
    setDragMinutes(slotInfo?.dragMinutes || 0);
    setBookingMode('individual');
    setGroupType('couple');
    setSeparateCount(3);
    setCountText('3');
    setServiceMode('same');
    setGroupServiceId('');
    setGroupRoomId(slotInfo?.colType === 'room' ? slotInfo.colId : '');
    setPeople([]);
    setError(null);
    setSubmitting(false);
    submitInFlightRef.current = false;
    setPreviousDue(null);
    // Opened for a known customer (Customers / Memberships / Packages 'Book'): treat as an existing customer and show any earlier balance.
    if (slotInfo?.defaultCustomerExisting && slotInfo.defaultCustomerPhone) {
      setIsExistingCustomer(true);
      checkPreviousDue(`${slotInfo.defaultCustomerCountryCode || '+977'}${slotInfo.defaultCustomerPhone}`);
    }
    setConfirm(null);
    initialDraftRef.current = {
      date: slotInfo?.day || '',
      time: slotTime,
      therapist: slotInfo?.colType === 'therapist' && slotInfo.colId ? slotInfo.colId : (slotInfo?.defaultTherapistIds?.length ? slotInfo.defaultTherapistIds.join(',') : ''),
      room: slotInfo?.colType === 'room' ? slotInfo.colId : '',
      service: slotInfo?.defaultServiceId || '',   // a service the slot preset (Rebook, Book from Customers) is the baseline, not an edit
    };
  }, [slotInfo]);

  // Compute which therapists & rooms are busy during the selected time slot
  const selectedService = (services || []).find((s) => s.id === serviceId);
  // ZNLY-113: a visiting therapist can be booked here only for services they already do at their home branch (matched by name) that this
  // branch also offers. Anyone else: the branch's full list.
  const visitorTherapist = bookingMode === 'individual' ? (allTherapists.length ? allTherapists : therapists || []).find((t) => t.id === selectedTherapistIds[0] && t.transferredIn && t.branch_id && t.branch_id !== branchId) : null;
  const [visitorServiceNames, setVisitorServiceNames] = useState(null);
  useEffect(() => {
    if (!visitorTherapist) { setVisitorServiceNames(null); return undefined; }
    let live = true;
    Promise.all([fetchServices(visitorTherapist.branch_id), fetchServiceEligibility()]).then(([svc, elig]) => {
      if (!live) return;
      setVisitorServiceNames(homeServiceNameSet(svc?.data, elig?.data, visitorTherapist.id));
    }).catch(() => { if (live) setVisitorServiceNames(null); });
    return () => { live = false; };
  }, [visitorTherapist?.id, visitorTherapist?.branch_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickerServices = useMemo(
    () => (visitorTherapist && visitorServiceNames ? servicesBookableHere(services, visitorServiceNames) : (services || [])),
    [visitorTherapist, visitorServiceNames, services],
  );
  // Gate the section AND the submitted payload on the same condition, so switching away from a couple service never
  // ships hidden companion data.
  const isComboService = !!selectedService?.is_combo;
  // True once every component needs its own staff: the generic Therapist picker would go unused, so it is hidden.
  const comboAllDifferentStaff = isComboService && comboComponents.length > 0 && comboComponents.every((c) => !c.defaultSameStaff);
  // Self-service amenity (sauna/steam/locker): no therapist picker; staff just allocate a room if one applies.
  const serviceRequiresTherapist = selectedService ? selectedService.requires_therapist !== false : true;
  const isCoupleBooking = bookingMode === 'individual' && selectedTherapistIds.length > 1 && !!selectedService?.is_couple;
  // ZNLY-402 3b: "+ Add another service" needs the setting ON, Individual mode and a plain first service (a combo or couple service keeps its own flow).
  const canMulti = !!multiServiceBookings && bookingMode === 'individual' && !!selectedService && !selectedService.is_combo && !selectedService.is_couple;
  // ZNLY-402 U10: every business gets the same grey service card from the FIRST service (Individual mode). A combo / couple service keeps its own
  // layout (its staff and schedule rules differ). Only an ON org gets "Add another service" (canMulti).
  const useCard = bookingMode === 'individual' && !selectedService?.is_combo && !selectedService?.is_couple;
  const activeRows = canMulti ? extraRows : [];
  const extraServices = useMemo(() => pickerServices.filter((x) => !x.is_combo && !x.is_couple), [pickerServices]);
  const extraTimes = useMemo(() => rowTimes(activeRows, services, bookingTime, selectedService?.duration_minutes), [activeRows, services, bookingTime, selectedService]);
  const extraIncomplete = rowsIncompleteReason(activeRows);
  // Live checks per extra row, reported by the rows themselves (shift / break / leave / clash: the same rule as a single booking). Nothing is created until every row passes.
  const [rowProblems, setRowProblems] = useState({});
  const onRowProblem = useCallback((key, text, overridable = false) => setRowProblems((p) => ((p[key]?.text || '') === (text || '') && !!p[key]?.overridable === !!overridable ? p : { ...p, [key]: { text: text || '', overridable: !!overridable } })), []);
  const ownProblems = useMemo(() => {
    if (!activeRows.length || allowStaffOverlap) return {};
    const nm = (id) => (therapists || []).find((x) => x.id === id)?.name || 'This person';
    const f0 = clockToMin(bookingTime);
    const slots = [{ ids: selectedTherapistIds, startMin: f0 ?? 0, endMin: (f0 ?? 0) + (selectedService?.duration_minutes || 60) }, ...activeRows.map((r, i) => ({ ids: r.therapistId ? [r.therapistId] : [], startMin: extraTimes[i].startMin, endMin: extraTimes[i].endMin }))];
    return ownOverlaps(slots, nm);
  }, [activeRows, allowStaffOverlap, therapists, bookingTime, selectedTherapistIds, selectedService, extraTimes]);
  const firstRowProblem = (() => {
    for (let i = 0; i < activeRows.length; i += 1) { const p = rowProblems[activeRows[i].key]; if (p?.text && !p.overridable) return `Service ${i + 2}: ${p.text}`; }
    return '';
  })();
  // Rows whose only problem is an overridable availability verdict: a manager / admin may book anyway with a reason (asked once, before anything is created).
  const rowOverrides = activeRows.map((r) => !!rowProblems[r.key]?.overridable);
  const anyRowOverride = rowOverrides.some(Boolean);
  // Group booking creates one independent booking per person, so a couple service would bill the combined price to each.
  const groupServices = (services || []).filter((s) => !s.is_couple);
  // Warn (and disable Create) when the booking interval overlaps a manual block. Client-side only.
  const dayBlocks = useDayBlocks(branchId, bookingDate);
  const blockOverlapMsg = useMemo(() => {
    if (!bookingDate || !bookingTime) return '';
    const durOf = (tid) => (services || []).find((t) => t.id === tid)?.duration_minutes || 60;
    const participants = bookingMode === 'group'
      ? people.map((p) => ({
          therapistIds: p.therapistId ? [p.therapistId] : [],
          roomId: groupType === 'couple' ? groupRoomId : p.roomId,
          dur: durOf(serviceMode === 'same' ? groupServiceId : p.serviceId),
        }))
      : [{ therapistIds: selectedTherapistIds, roomId, dur: selectedService?.duration_minutes || dragMinutes || 60 }];
    for (const p of participants) {
      const occ = findBlockOverlap(dayBlocks, {
        date: bookingDate, startTime: bookingTime, durationMinutes: p.dur, therapistIds: p.therapistIds, roomId: p.roomId,
      });
      if (occ) return describeBlockOverlap(occ);
    }
    return '';
  }, [dayBlocks, bookingDate, bookingTime, bookingMode, people, groupType, groupRoomId, serviceMode, groupServiceId, selectedTherapistIds, roomId, selectedService, services, dragMinutes]);

  // Everything a rejection could depend on. A saved rejection stays (and Create stays off) only while this is unchanged.
  const formKey = JSON.stringify([bookingMode, bookingDate, bookingTime, serviceId, selectedTherapistIds, roomId, customerName, customerPhone, knownCustomerId, customerKind, walkInLabel,
    people, groupServiceId, groupRoomId, serviceMode, groupType, therapistRoomOverrides, comboTherapistOverrides, comboRoomOverrides, extraRows]);

  const svcDur = (sid) => (services || []).find((t) => t.id === sid)?.duration_minutes || 60;

  // Shared Staff picker input: service staff (plus any selected person the list filter hides), without people who are off on another day.
  const pickerPeople = useMemo(() => {
    const pool = [...(therapists || [])];
    [...selectedTherapistIds, ...people.map((p) => p.therapistId).filter(Boolean)].forEach((id) => {
      if (!pool.some((d) => d.id === id)) { const extra = (allTherapists || []).find((d) => d.id === id); if (extra) pool.push(extra); }
    });
    return pool
      .filter((t) => bookingDate === offDate || !offStaff[t.id])
      .map((t) => ({ id: t.id, name: t.full_name || t.name, gender: t.gender, specialties: t.specialties || [] }));
  }, [therapists, allTherapists, selectedTherapistIds, people, bookingDate, offDate, offStaff]);
  const pickerSlotEnd = useMemo(() => {
    if (!bookingTime) return null;
    const [h, m] = bookingTime.split(':').map(Number);
    const e = h * 60 + m + (selectedService?.duration_minutes || dragMinutes || 60);
    return `${String(Math.floor(e / 60) % 24).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
  }, [bookingTime, selectedService, dragMinutes]);

  // Autofocus the name field once the panel is in place. preventScroll: focusing must never scroll an
  // ancestor (a horizontal page shift was reported when focus fired while the panel was still sliding in).
  useEffect(() => {
    if (!slotInfo) return undefined;
    const timer = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(timer);
  }, [slotInfo]);

  // How many people the group has (Couple is always 2)
  const peopleCount = bookingMode === 'group'
    ? (groupType === 'couple' ? 2 : separateCount)
    : 0;

  // Keep the per-person rows array sized to peopleCount, preserving entries
  useEffect(() => {
    if (bookingMode !== 'group') return;
    setPeople((prev) => {
      const next = prev.slice(0, peopleCount);
      while (next.length < peopleCount) {
        next.push({ name: '', phone: '', countryCode: '+977', email: '', gender: '', therapistId: '', serviceId: '', roomId: '', kind: next.length === 0 && slotInfo?.walkIn ? 'walkin' : null, label: '' });
      }
      return next;
    });
  }, [bookingMode, peopleCount]);

  const setPerson = (idx, patch) =>
    setPeople((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));


  // ── Group: staff per guest (ZNLY-303) ─────────────────────────────────────────────────────────────────────────────────────
  const [fillUndo, setFillUndo] = useState(null); // { picks } of the last "Fill free staff", for Undo
  const groupEligibility = useServiceEligibility(bookingMode === 'group');
  const guestServiceId = (p) => (serviceMode === 'same' ? groupServiceId : p.serviceId);
  const guestSlots = useMemo(() => {
    if (bookingMode !== 'group' || !bookingTime) return [];
    const [h, m] = bookingTime.split(':').map(Number);
    const start = h * 60 + m;
    return people.map((p, idx) => {
      const sid = guestServiceId(p);
      const dur = (services || []).find((t) => t.id === sid)?.duration_minutes || 60;
      return { idx, staffId: p.therapistId || '', start, end: start + dur, serviceId: sid || null };
    });
  }, [bookingMode, bookingTime, people, serviceMode, groupServiceId, services]); // eslint-disable-line react-hooks/exhaustive-deps
  // ZNLY-310: Free / Busy / Off for the picked DATE. The calendar's day data (bookings + offStaff) is only right for offDate; for any other date
  // (Bookings, Dashboard, another day) the panel fetches that day itself. Not ready / own-only login => null = plain staff list.
  const reuseCalDay = bookingDate === offDate;
  const ownDayData = useDayAvailability({ branchId, date: bookingDate, enabled: !!bookingDate && !reuseCalDay && !viewerAccess(viewerProfile).ownOnly });
  // dayChecking: the fetch is in flight (show "Checking who's free…"); dayKnown false and not checking = failed / own-only: plain list, no Fill.
  const dayKnown = reuseCalDay || ownDayData.ready;
  const dayChecking = !!bookingDate && !dayKnown && !ownDayData.failed && !viewerAccess(viewerProfile).ownOnly;
  const dayBookings = reuseCalDay ? bookings : (ownDayData.ready ? ownDayData.bookings : null);
  const dayOff = reuseCalDay ? offStaff : (ownDayData.ready ? ownDayData.offById : {});
  const groupRanges = useMemo(() => (bookingMode === 'group' && bookingDate && dayBookings ? staffDayRanges(dayBookings, { date: bookingDate }) : {}), [bookingMode, bookingDate, dayBookings]);
  const groupOff = dayOff;
  const groupHeld = useMemo(() => staffHeldByOthers(guestSlots, { allowOverlap: allowStaffOverlap }), [guestSlots, allowStaffOverlap]);
  const groupProblems = useMemo(() => pickProblems(guestSlots, { rangesById: groupRanges, offById: groupOff, allowOverlap: allowStaffOverlap }), [guestSlots, groupRanges, groupOff, allowStaffOverlap]); // eslint-disable-line react-hooks/exhaustive-deps
  const guestSub = (idx) => {
    const g = guestSlots[idx]; if (!g) return '';
    const svc = (services || []).find((t) => t.id === g.serviceId);
    return [svc?.name, rangeClock(g.start, g.end)].filter(Boolean).join(' · ');
  };
  const contactFirst = (people[0]?.name || '').trim().split(/\s+/)[0] || 'the contact';
  const staffNameOf = (id) => pickerPeople.find((t) => t.id === id)?.name || '';
  // ZNLY-310: combo steps. Each step has its own window (same offset rule as createComboBookingItems), its own staff pick, and the
  // shared staff list/row. A person picked on an overlapping step is held ("With step N") by the same rule as group guests.
  const comboSchedule = useMemo(() => {
    let cursor = 0; let previousStart = 0;
    const [bh, bm] = (bookingTime || '00:00').split(':').map(Number);
    const base = (Number.isFinite(bh) ? bh : 0) * 60 + (Number.isFinite(bm) ? bm : 0);
    return comboComponents.map((c) => {
      const duration = c.service?.durationMinutes || 0;
      const start = c.defaultTiming === 'concurrent' ? previousStart : cursor;
      const end = start + duration;
      cursor = Math.max(cursor, end);
      previousStart = start;
      return { ...c, duration, start, end, base };
    });
  }, [comboComponents, bookingTime]);
  const comboSlots = useMemo(() => comboSchedule.map((c, i) => ({
    idx: i, serviceId: c.serviceId, start: c.base + c.start, end: c.base + c.end,
    staffId: c.defaultSameStaff ? (selectedTherapistIds[0] || '') : (comboTherapistOverrides[c.serviceId] || ''),
  })), [comboSchedule, selectedTherapistIds, comboTherapistOverrides]);
  const comboHeld = useMemo(() => staffHeldByOthers(comboSlots, { allowOverlap: allowStaffOverlap }), [comboSlots, allowStaffOverlap]);
  const comboRanges = useMemo(() => (comboComponents.length && bookingDate && dayBookings ? staffDayRanges(dayBookings, { date: bookingDate }) : {}), [comboComponents, bookingDate, dayBookings]);
  const comboOff = dayOff;
  const comboProblems = useMemo(() => pickProblems(comboSlots, { rangesById: comboRanges, offById: comboOff, allowOverlap: allowStaffOverlap }), [comboSlots, comboRanges, comboOff, allowStaffOverlap]);
  const minToHHMM = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const comboPick = (i) => {
    const g = comboSlots[i];
    if (!g?.staffId) return { name: '', statusLine: '', pill: null, problem: '' };
    return pickedRowStatus(pickerPeople.find((t) => t.id === g.staffId) || { id: g.staffId, name: staffNameOf(g.staffId) }, {
      slot: dayBookings ? { start: g.start, end: g.end } : null, rangesById: comboRanges, offById: comboOff, date: bookingDate, today: nepalNow().today, busyOk: allowStaffOverlap,
    });
  };
  const comboProblemText = (i) => {
    const own = comboPick(i).problem; if (own) return own;
    const pr = comboProblems[i];
    return pr?.kind === 'clash' ? `${staffNameOf(pr.staffId)} is already on step ${pr.withIdx + 1} at this time` : '';
  };
  const guestLabel = (idx) => (people[idx]?.name?.trim() || (idx === 0 ? 'the booking contact' : `Person ${idx + 1}`));
  const problemText = (idx) => {
    const pr = groupProblems[idx]; if (!pr) return '';
    const g = guestSlots[idx];
    if (pr.kind === 'off') return `${staffNameOf(pr.staffId)} is off today`;
    if (pr.kind === 'busy') return `${staffNameOf(pr.staffId)} is busy ${pillRange(pr.range.start, pr.range.end)}`;
    return `${staffNameOf(pr.staffId)} is with ${guestLabel(pr.withIdx)}`;
  };
  const groupProblemFooter = useMemo(() => {
    const idx = Object.keys(groupProblems)[0];
    if (idx == null) return '';
    const pr = groupProblems[idx]; const g = guestSlots[Number(idx)];
    const who = people[Number(idx)]?.name?.trim() || (Number(idx) === 0 ? 'the booking contact' : `Person ${Number(idx) + 1}`);
    const n = staffNameOf(pr.staffId);
    if (pr.kind === 'off') return `${n} is off today for ${who}`;
    if (pr.kind === 'busy') return `${n} is busy at ${clockShort(g.start)} for ${who}`;
    return `${n} is already with ${people[pr.withIdx]?.name?.trim() || (pr.withIdx === 0 ? 'the booking contact' : `Person ${pr.withIdx + 1}`)} at that time`;
  }, [groupProblems, guestSlots, people, pickerPeople]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupStaffIncomplete = bookingMode === 'group' && groupType === 'couple'
    && staffPickIncomplete({ isCouple: true, count: people.filter((p) => p.therapistId).length, zeroOk: true });
  const emptyGuests = guestSlots.filter((g) => !g.staffId).length;
  const hasAnyService = shouldShowFillFree({ serviceMode, groupServiceId, people });
  const fillFree = () => {
    const { picks } = fillFreeStaff(guestSlots, { people: pickerPeople, rangesById: groupRanges, offById: groupOff, eligibleByService: groupEligibility });
    if (!Object.keys(picks).length) return;
    setPeople((prev) => prev.map((p, i) => (picks[i] ? { ...p, therapistId: picks[i] } : p)));
    setFillUndo({ picks, count: Object.keys(picks).length });
  };
  const undoFillFree = () => {
    const next = undoFill(Object.fromEntries(people.map((p, i) => [i, p.therapistId])), fillUndo?.picks);
    setPeople((prev) => prev.map((p, i) => ({ ...p, therapistId: next[i] })));
    setFillUndo(null);
  };
  const guestPick = (idx) => {
    const p = people[idx]; const g = guestSlots[idx];
    if (!p?.therapistId || !g) return { name: '', statusLine: '', pill: null };
    const { busy } = arrangeByTime(pickerPeople.filter((t) => t.id === p.therapistId), { slotStart: g.start, slotEnd: g.end, rangesById: groupRanges, offById: groupOff });
    return { name: staffNameOf(p.therapistId), statusLine: busy.length ? `Busy ${pillRange(busy[0].busyRange.start, busy[0].busyRange.end)}` : `Free ${rangeLabel(g.start, g.end)}`, pill: busy.length ? 'busy' : 'free' };
  };
  const setGuestStaff = (idx, id) => { setFillUndo(null); setPerson(idx, { therapistId: id }); };
  const handleGuestCustomerSelect = async (idx, customer) => {
    const { dial, national } = parsePhone(customer.phone);
    setPerson(idx, { name: customer.full_name, phone: national, countryCode: dial, email: customer.email || '', gender: customer.gender || '', customerId: customer.id, previousDue: null });
    if (canViewPrices) {
      const { data } = await getCustomerOutstandingBalance({ customerPhone: customer.phone, branchId });
      setPeople((prev) => prev.map((q, i) => (i === idx && q.customerId === customer.id ? { ...q, previousDue: data && data.totalDue > 0 ? data : null } : q)));
    }
  };

  // ZNLY-327: the booking contact's customer row (same three choices as the single booking).
  const handleContactPick = (choice) => {
    const blank = { name: '', phone: '', email: '', gender: '', customerId: null, previousDue: null };
    if (choice.kind === 'walkin') setPerson(0, { ...blank, kind: 'walkin', label: '' });
    else if (choice.kind === 'existing') { handleGuestCustomerSelect(0, choice.customer); setPerson(0, { kind: 'existing', label: '' }); }
    else {
      if (people[0]?.kind === 'new' && !choice.seed) return;
      const seed = seedFromSearch(choice.seed);
      setPerson(0, { ...blank, kind: 'new', label: '', name: seed.name, phone: seed.phone });
    }
  };

  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  // Load the selected combo's component list (Individual mode only: group/couple services can't be combos).
  useEffect(() => {
    if (!isComboService || !serviceId || bookingMode !== 'individual') { setComboComponents([]); return undefined; }
    let cancelled = false;
    setComboComponentsLoading(true);
    (async () => {
      const { data } = await fetchServiceComboComponents(serviceId);
      if (cancelled) return;
      setComboComponents(data || []);
      setComboComponentsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isComboService, serviceId, bookingMode]);

  const svcSubLine = [bookingDate ? new Date(`${bookingDate}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '', bookingTime ? format12h(bookingTime) : ''].filter(Boolean).join(' · ');

  // Close the people-count dropdown on outside click
  useEffect(() => {
    if (!countDropdownOpen) return;
    const handleClick = (e) => {
      if (countDropdownRef.current && !countDropdownRef.current.contains(e.target)) {
        setCountDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [countDropdownOpen]);

  const commitCount = (raw) => {
    const n = parseInt(raw, 10);
    const clamped = Number.isNaN(n) ? 2 : Math.min(Math.max(n, 2), 20);
    setSeparateCount(clamped);
    setCountText(String(clamped));
  };

  // Same mode → one shared service; Different mode → every person must pick one.
  const contactPhoneProblem = phoneProblem(people[0]?.countryCode || '+977', people[0]?.phone);
  // A typed guest number must be real too (a picked customer's stored number is not re-checked; blank = the contact's).
  const guestPhoneProblem = people.slice(1).map((q) => (q.customerId ? '' : phoneProblem(q.countryCode || '+977', q.phone))).find(Boolean) || '';
  const groupServiceValid = serviceMode === 'same'
    ? !!groupServiceId
    : (people.length > 0 && people.every((p) => !!p.serviceId));
  const groupValid = bookingMode !== 'group'
    || (!guestPhoneProblem && (people[0]?.kind === 'walkin' ? groupServiceValid : (people[0]?.kind && people[0]?.name?.trim() && (people[0]?.phone?.replace(/\D/g, '') || !requireCustomerPhone) && !(people[0].kind === 'new' && contactPhoneProblem) && groupServiceValid)));

  const buildGroupPeople = () => {
    // Blank "other" persons inherit the booking contact's credentials.
    const lead = people[0] || {};
    const leadName = lead.name?.trim();
    const leadPhone = lead.phone?.replace(/\D/g, '')
      ? (lead.countryCode || '+977') + lead.phone.replace(/\D/g, '')
      : null;
    const leadEmail = lead.email?.trim();
    const leadWalkIn = lead.kind === 'walkin';
    return people.map((p, idx) => {
      const blankGuest = idx > 0 && !p.name?.trim() && !p.phone?.replace(/\D/g, '') && !p.email?.trim();
      // ZNLY-327: a walk-in contact is a walk-in with no profile; a guest left fully blank shares that, never a made-up customer.
      const walkIn = leadWalkIn && (idx === 0 || blankGuest) ? customerSavePayload({ kind: 'walkin', walkInLabel: lead.label }) : null;
      return {
      customerName: p.name?.trim() || (idx === 0 ? null : leadName) || null,
      customerPhone: p.phone?.replace(/\D/g, '')
        ? (p.countryCode || '+977') + p.phone.replace(/\D/g, '')
        : (idx === 0 ? null : leadPhone) || null,
      customerEmail: p.email?.trim() || (idx === 0 ? null : leadEmail) || null,
      customerGender: p.gender || (idx === 0 ? null : lead.gender) || null,
      serviceId: serviceMode === 'same' ? groupServiceId : p.serviceId,
      therapistIds: p.therapistId ? [p.therapistId] : null,
      roomId: groupType === 'couple' ? (groupRoomId || null) : (p.roomId || null),
      // ZNLY-303: a picked customer links the booking; a guest left fully blank is the contact, so shares their link.
      knownCustomerId: p.customerId || (idx > 0 && !p.name?.trim() && !p.phone?.replace(/\D/g, '') && !p.email?.trim() ? lead.customerId : null) || null,
      ...(walkIn || {}),
      };
    });
  };

  // Which field a rejection is about (null = the whole booking, e.g. a network failure).
  const errorField = (text) => {
    if (/phone|customer|name/i.test(text) && !/slot|time/i.test(text)) return 'customer';
    if (/room|bed|capacity/i.test(text)) return 'room';
    if (/therapist|staff|person|provider|absent|leave|already has a booking|unavailable/i.test(text)) return 'staff';
    if (/slot|time|booked|closed|date|day|hours|window|advance|past/i.test(text)) return 'time';
    return null;
  };
  const customerFields = { phoneRequired: requireCustomerPhone, kind: customerKind, name: customerName, phone: customerPhone, countryCode: customerCountryCode, email: customerEmail, gender: customerGender, knownCustomerId, walkInLabel };
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (bookingMode === 'group' ? !groupValid : (!serviceId || customerMissing(customerFields))) return;
    if (blockOverlapMsg) return;
    if (bookingMode === 'individual' && (extraIncomplete || firstRowProblem)) return;
    // Synchronous re-entry guard: the `submitting` state disables the button
    // only after a re-render, so a fast double-click can fire two submits and
    // create duplicate bookings. The ref blocks the second call immediately.
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    const payload = bookingMode === 'group'
      ? {
          mode: 'group',
          specialRequests: specialRequests.trim() || null,
          people: buildGroupPeople(),
          bookingDate,
          bookingTime,
        }
      : {
          serviceId,
          ...customerSavePayload(customerFields),
          specialRequests: specialRequests.trim() || null,
          therapistIds: selectedTherapistIds.length > 0 ? selectedTherapistIds : null,
          roomId: roomId || null,
          therapistRoomOverrides: isCoupleBooking
            ? Object.fromEntries(selectedTherapistIds.slice(1).map((tid) => [tid, therapistRoomOverrides[tid] || roomId || null]))
            : undefined,
          companionName: isCoupleBooking ? (companionName.trim() || null) : undefined,
          companionPhone: isCoupleBooking ? (companionPhone.value || null) : undefined,
          // Combo bundle: each component's own service/timing/staff, so the caller can insert booking_combo_items.
          comboAssignments: isComboService && comboComponents.length > 0
            ? comboComponents.map((c) => ({
                serviceId: c.serviceId,
                componentId: c.componentId,
                defaultTiming: c.defaultTiming,
                therapistId: c.defaultSameStaff ? (selectedTherapistIds[0] || null) : (comboTherapistOverrides[c.serviceId] || null),
                roomId: c.defaultSameRoom !== false ? (roomId && roomId !== 'none' ? roomId : null) : (comboRoomOverrides[c.serviceId] || null),
              }))
            : undefined,
          // ZNLY-402 3b: several services for one person: the first service plus each extra row, each with its own start and staff.
          multiServices: activeRows.length > 0
            ? toGroupServices({ first: selectedService, firstStart: bookingTime, firstTherapistIds: selectedTherapistIds, rows: activeRows, services, overrides: [!!precheck.warn, ...rowOverrides], overrideNotes: [precheck.verdict?.message, ...activeRows.map((r) => rowProblems[r.key]?.text)] })
            : undefined,
          bookingDate,
          bookingTime,
          referringCustomerId: (!isExistingCustomer && referringCustomerId) || undefined,
          referringRewardType: (!isExistingCustomer && referringCustomerId) ? 'wallet' : undefined,
          referringRewardAmount: (!isExistingCustomer && referringCustomerId && referringRewardAmount.trim())
            ? Number(referringRewardAmount)
            : undefined,
        };
    const err = await onSubmit(payload);
    if (err) {
      const text = friendlyError(err, 'Couldn\'t create the booking. Please try again.');
      setError(text);
      setErrorCode(err?.code || null);
      setErrorCard(describeError(err?.raw || { code: err?.code, message: err?.message }, { ...guideCtx, partial: err?.partial }));
      setErrorKey(formKey);
      setErrorRow(Number.isInteger(err?.row) && err.row > 0 ? err.row : null);
      setSubmitting(false);
      submitInFlightRef.current = false;
      // Bring the field the reason is about into view (the footer already shows the reason itself).
      const field = fieldForErrorCode(err?.code) || errorField(text);
      if (field) requestAnimationFrame(() => document.querySelector(`[data-qc-field="${field}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
  };

  const isOpen = !!slotInfo;

  // While the quick-booking panel is open on mobile, hide the floating pill nav
  // and FAB so they don't cover the Cancel / Create Booking buttons. The CSS rule
  // lives in src/styles/tailwind.css (`.mobile-panel-open .js-mobile-floating-ui`).
  useEffect(() => {
    if (!isOpen) return;
    document.body.classList.add('mobile-panel-open');
    return () => document.body.classList.remove('mobile-panel-open');
  }, [isOpen]);

  // ── Dirty-draft guard ─────────────────────────────────────────────────────────────────
  const peopleEdited = people.some((p, i) => p.name || p.phone || p.email || p.gender || p.therapistId || p.serviceId || p.roomId || p.label || (i === 0 && p.kind && p.kind !== (slotInfo?.walkIn ? 'walkin' : null)));
  // "Dirty" = the user edited something that is NOT the slot itself. Date, time and column come from the slot (and are
  // moved silently by retargeting); service, customer, contact, notes, group members, referral, and a therapist/room
  // choice that differs from what the slot set all count as an edit.
  const isDirty = isOpen && (
    !!((serviceId && serviceId !== initialDraftRef.current.service) || activeRows.length > 0 || (!slotInfo?.lockedClient && (customerName.trim() || customerPhone.trim() || customerEmail.trim() || customerGender)) || specialRequests.trim()
      || (customerKind === 'walkin' && !slotInfo?.walkIn && !slotInfo?.lockedClient) || (!slotInfo?.lockedClient && walkInLabel.trim()) || groupServiceId || peopleEdited || referringCustomerName)
    || selectedTherapistIds.join(',') !== (initialDraftRef.current.therapist ? initialDraftRef.current.therapist : '')
    || (roomId || '') !== initialDraftRef.current.room
  );
  // Lets the calendar run another panel action (open a booking, …) through this panel's dirty guard.
  useEffect(() => {
    if (!guardRef) return undefined;
    guardRef.current = (action) => { if (isDirty) setConfirm({ type: 'switch', action }); else action(); };
    return () => { guardRef.current = null; };
  });
  const requestClose = useCallback(() => {
    if (isDirty) setConfirm({ type: 'discard' });
    else onClose();
  }, [isDirty, onClose]);

  // ── Ghost block on the grid: report the draft (date, time, length, column) to the calendar ──
  const draftDuration = (services || []).find((t) => t.id === (bookingMode === 'group' ? groupServiceId : serviceId))?.duration_minutes || dragMinutes || 30;
  // Staff-availability pre-check (ZNLY-100): the guard's verdict for the first selected therapist, before Save.
  const { staffLabel, staffLabelPlural, locationLabel } = useIndustry();
  const precheck = useAvailabilityPrecheck({
    branchId, date: bookingDate, startTime: bookingTime, durationMin: draftDuration,
    therapistId: bookingMode === 'individual' ? selectedTherapistIds[0] : null, enabled: !!slotInfo,
  });
  useEffect(() => {
    if (!isOpen) { onDraftChange?.(null); return; }
    onDraftChange?.({
      date: bookingDate,
      startTime: bookingTime,
      durationMinutes: draftDuration,
      therapistId: selectedTherapistIds[0] || null,
      roomId: roomId || null,
      overlap: !!blockOverlapMsg,
      // Opened from the toolbar (no column): don't draw the ghost until a therapist/room is chosen.
      hidden: !slotInfo?.colType && !selectedTherapistIds[0] && !roomId,
    });
  }, [isOpen, bookingDate, bookingTime, draftDuration, selectedTherapistIds, roomId, blockOverlapMsg, onDraftChange, slotInfo?.colType]);

  // ── Retarget: clicking another empty slot while the panel is open moves the draft there ──
  const lastRetargetRef = useRef(null);
  const applyRetarget = (s) => {
    setBookingDate(s.day);
    const t = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
    setBookingTime(t);
    setDragMinutes(s.dragMinutes || 0);
    if (s.colType === 'therapist' && s.colId) setSelectedTherapistIds([s.colId]);
    if (s.colType === 'room' && s.colId) { setRoomId(s.colId); setGroupRoomId(s.colId); }
    // The retargeted slot is the new baseline for "did the user change the therapist/room?"
    initialDraftRef.current = {
      date: s.day,
      time: t,
      therapist: s.colType === 'therapist' && s.colId ? s.colId : initialDraftRef.current.therapist,
      room: s.colType === 'room' && s.colId ? s.colId : initialDraftRef.current.room,
      service: initialDraftRef.current.service,
    };
  };
  useEffect(() => {
    if (!retarget || retarget.nonce === lastRetargetRef.current || !isOpen) return;
    lastRetargetRef.current = retarget.nonce;
    const s = retarget.slot;
    const curCol = s.colType === 'room' ? (roomId || '') : s.colType === 'therapist' ? (selectedTherapistIds[0] || '') : '';
    const changesColumnOrDate = s.day !== bookingDate || ((s.colType === 'room' || s.colType === 'therapist') && (s.colId || '') !== curCol);
    if (isDirty && changesColumnOrDate) setConfirm({ type: 'move', slot: s });
    else applyRetarget(s);
  }, [retarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Footer: why Create is disabled, or the inline confirm ──────────────────────────────
  // Couple rule (same helper as the booking panel): 0 picks saves unassigned, 2 is fine, 1 is not.
  // Reasons follow form order (ZNLY-322): the service row sits above the contact card, so a missing service is named first.
  const groupServiceMissing = serviceMode === 'same' ? !groupServiceId : people.some((q) => !q.serviceId);
  const groupInvalidReason = !people[0]?.kind ? PICK_REASON : (people[0].kind === 'new' && people[0].name?.trim() && contactPhoneProblem) ? contactPhoneProblem
    : groupServiceMissing
      ? (serviceMode === 'same' ? 'Pick a service' : `Pick a service for ${people.findIndex((q) => !q.serviceId) === 0 ? 'the booking contact' : `Person ${people.findIndex((q) => !q.serviceId) + 1}`}`)
      : guestPhoneProblem ? guestPhoneProblem : 'Add the booking contact';
  // ZNLY-322: tapping the "Pick a service" footer reason scrolls to the first empty service row and rings it for 3 s.
  const [flashSvc, setFlashSvc] = useState(null);
  const firstEmptySvcField = bookingMode === 'individual' ? (serviceId ? (extraIncomplete ? `service-x${activeRows.findIndex((r) => !r.serviceId)}` : null) : 'service')
    : serviceMode === 'same' ? (groupServiceId ? null : 'service')
      : (() => { const k = people.findIndex((q) => !q.serviceId); return k < 0 ? null : `service-${k}`; })();
  useEffect(() => { if (!flashSvc) return undefined; const t = setTimeout(() => setFlashSvc(null), 3000); return () => clearTimeout(t); }, [flashSvc]);
  // ZNLY-327: the customer reason works the same way, after the service (form order).
  const customerUnpicked = bookingMode === 'individual' ? !customerKind : !people[0]?.kind;
  const phoneBad = bookingMode === 'individual' ? customerKind === 'new' && !!customerName.trim() && !!phoneProblem(customerCountryCode, customerPhone) : people[0]?.kind === 'new' && !!contactPhoneProblem;
  const firstEmptyField = (customerUnpicked ? 'customer' : phoneBad ? 'phone' : null) || firstEmptySvcField;   // customer first, then services (the form's order)
  const tapPickService = () => {
    if (!firstEmptyField) return;
    setFlashSvc(firstEmptyField);
    requestAnimationFrame(() => document.querySelector(`[data-qc-field="${firstEmptyField}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  // Neutral note while Create is enabled (mockup step 3-7): what happens on tap.
  const groupReadyNote = bookingMode === 'group' && groupValid && !groupProblemFooter && !groupStaffIncomplete && bookingTime
    ? (people.some((q) => !q.therapistId) ? `${staffLabel} is optional`
      : groupType === 'couple' ? `Couple · 2 ${staffLabelPlural.toLowerCase()} picked`
        : `${peopleCount} bookings · ${clockShort(guestSlots[0]?.start ?? 0)}`.replace(/(\d+):(\d\d)$/, (m0, h, mm) => `${h}:${mm}${(guestSlots[0]?.start ?? 0) >= 720 ? 'pm' : 'am'}`))
    : '';
  const couplePickIncomplete = bookingMode === 'individual' && !comboAllDifferentStaff && staffPickIncomplete({ isCouple: !!selectedService?.is_couple, optional: !serviceRequiresTherapist, count: selectedTherapistIds.length, zeroOk: true });
  const activeError = error && errorKey === formKey ? error : null; // cleared the moment the user changes anything relevant
  // Guidance (ZNLY-365): the refused save's card, or a live card when the calendar already knows the clash (staff off / busy, room full).
  const activeCard = errorCard && errorKey === formKey && activeError ? errorCard : null;
  const roomSts = useMemo(() => (rooms && rooms.length && bookingMode === 'individual' ? roomStates({ rooms, bookings, date: bookingDate, startTime: bookingTime, durationMin: draftDuration }) : []), [rooms, bookings, bookingDate, bookingTime, draftDuration, bookingMode]);
  const addMin = (t, m) => { const x = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!x) return ''; const v = Number(x[1]) * 60 + Number(x[2]) + m; return `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
  const roomFreeTimes = [...new Set(roomSts.filter((x) => x.state === 'full' && x.freeFrom).map((x) => x.freeFrom))].sort();
  // Who is free for the whole slot (the Staff list's own free set, calendar day data), best-ranked first, minus the people already picked.
  const freeAtSlot = (() => {
    const s0 = clockToMin(bookingTime); const e0 = clockToMin(pickerSlotEnd);
    if (bookingMode !== 'individual' || s0 == null || !dayBookings || !bookingDate) return [];
    const { free } = arrangeByTime(pickerPeople.filter((t) => !selectedTherapistIds.includes(t.id)), {
      slotStart: s0, slotEnd: e0 > s0 ? e0 : s0 + 60, rangesById: staffDayRanges(dayBookings, { date: bookingDate }), offById: dayOff,
    });
    return free.map((x) => ({ id: x.person.id, name: x.person.name }));
  })();
  const guideCtx = {
    staffLabel, staffLabelPlural, hasRooms: !!(rooms && rooms.length), creating: true,
    startTime: bookingTime, endTime: addMin(bookingTime, draftDuration), serviceName: selectedService?.name,
    staffName: (therapists || []).find((t) => t.id === selectedTherapistIds[0])?.name,
    roomName: (rooms || []).find((r) => r.id === roomId)?.name,
    nextFreeTimes: precheck.nextFree?.length ? precheck.nextFree : roomFreeTimes,
    freeStaff: freeAtSlot.length ? freeAtSlot : (precheck.otherFree ? [{ id: precheck.otherFree.id, name: precheck.otherFree.name }] : []),
    otherFreeRooms: roomSts.filter((x) => x.state !== 'full' && x.room.id !== roomId).length,
    customerName,
  };
  // Live cards (no Create press needed). `blocking` = Create must wait: a hard stop. A manager's overridable verdict explains itself
  // but leaves Create enabled (the save still asks "Book anyway").
  // The first picked person whose own bookings clash with the slot (from the same day data the Staff row uses).
  const busyPick = (() => {
    const s0 = clockToMin(bookingTime); const e0 = clockToMin(pickerSlotEnd);
    if (allowStaffOverlap || bookingMode !== 'individual' || s0 == null || !dayBookings || !bookingDate || !selectedTherapistIds.length) return null;
    const { busy } = arrangeByTime(pickerPeople.filter((t) => selectedTherapistIds.includes(t.id)), {
      slotStart: s0, slotEnd: e0 > s0 ? e0 : s0 + 60, rangesById: staffDayRanges(dayBookings, { date: bookingDate }), offById: dayOff,
    });
    return busy[0] || null;
  })();
  // A live system card (only possible for a code missing from the catalog) keeps ONE reference id per code + slot, so it is reported once.
  const liveRefs = useRef({});
  const liveOpts = (code) => ({ makeRef: () => (liveRefs.current[`${code}|${bookingDate}|${bookingTime}`] ||= makeRef()) });
  const liveCard = (() => {
    if (activeCard || bookingMode !== 'individual') return null;
    if (precheck.verdict) return { ...describeError({ code: precheck.verdict.code, message: precheck.verdict.message }, guideCtx, liveOpts(precheck.verdict.code)), blocking: !!precheck.blocked };
    // No precheck verdict (the org's staff-availability rule is off): an overlap the Staff row already shows is still a hard stop, because the
    // database refuses a double booking (excl_therapist_overlap) and nobody can override it.
    if (busyPick) {
      const ctx = { ...guideCtx, staffName: busyPick.person.name, startTime: addMin('00:00', busyPick.busyRange.start), endTime: addMin('00:00', busyPick.busyRange.end), nextFreeTimes: [addMin('00:00', busyPick.busyRange.end)] };
      return { ...describeError({ code: 'THERAPIST_CONFLICT' }, ctx), blocking: true };
    }
    if (!serviceId) return null;
    if (!roomSts.length || roomSts[0].state == null) return null;
    const chosen = roomId ? roomSts.find((x) => x.room.id === roomId) : null;
    if (chosen && chosen.state === 'full') return { ...describeError({ code: 'ROOM_FULL' }, guideCtx), blocking: true };
    if (!roomId && roomSts.every((x) => x.state === 'full')) return { ...describeError({ code: 'ROOMS_FULL' }, guideCtx), blocking: true };
    return null;
  })();
  // ZNLY-402 3b: a refusal about an extra service: its fix buttons would act on the FIRST service's staff / time, so they are not offered; the row carries the reason.
  const rowRefused = errorRow != null && errorKey === formKey && !!activeError;
  const card = rowRefused && activeCard ? { ...activeCard, actions: [] } : (activeCard || liveCard);
  // Bring the card into view the moment it appears (it sits under date/time and can start partly off-screen).
  const cardRef = useRef(null);
  const cardKey = card ? `${card.code}${card.ref || ''}` : '';
  useEffect(() => { if (cardKey) cardRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [cardKey]);
  const errField = activeCard ? (activeCard.field || fieldForErrorCode(errorCode) || errorField(activeError)) : activeError ? (fieldForErrorCode(errorCode) || errorField(activeError)) : (liveCard?.field || null);
  const fieldRing = (name) => (errField === name && !rowRefused ? 'rounded-spa ring-2 ring-error' : '');
  // Fix buttons only fill or open something. Nothing here saves.
  const scrollToField = (f) => requestAnimationFrame(() => document.querySelector(`[data-qc-field="${f}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  const onGuideAction = (a) => {
    switch (a.intent) {
      case 'set-time': setBookingTime(a.value); break;
      case 'set-staff': setSelectedTherapistIds([a.value]); break;
      case 'set-room-any': setRoomId(''); break;
      case 'open-room': scrollToField('room'); setRoomSignal(Date.now()); break;
      case 'open-staff': scrollToField('staff'); break;
      case 'open-time': scrollToField('time'); break;
      case 'open-service': scrollToField('service'); break;
      case 'open-customer': case 'open-customer-pick': scrollToField('customer'); break;
      case 'set-date': setBookingDate(a.value); break;
      case 'set-date-tomorrow': { const d = new Date(`${bookingDate}T00:00:00`); d.setDate(d.getDate() + 1); setBookingDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); break; }
      case 'set-walk-in': setCustomerKind('walkin'); setCustomerName(''); setCustomerPhone(''); setKnownCustomerId(null); scrollToField('customer'); break;
      // Close without the discard prompt (the form is finished: the booking, or part of the group, already exists) and show the real calendar.
      case 'show-calendar': onRefreshCalendar?.(); onClose(); break;
      case 'retry': handleSubmit({ preventDefault() {} }); break;
      default: break;
    }
  };
  const disabledReason = submitting ? '' : (activeCard?.kind === 'fix' || liveCard?.blocking) ? 'Fix the note above to continue' : activeCard?.networkLost ? 'Check the calendar before trying again' : activeError ? activeError : precheck.blocked ? `${staffLabel} unavailable at this time` : blockOverlapMsg
    ? (/^Overlaps '(Transferred|Visiting)/.test(blockOverlapMsg) ? `${staffLabel} unavailable` : 'Overlaps a block')
    : bookingMode === 'group'
      ? (!groupValid ? groupInvalidReason : groupProblemFooter || (groupStaffIncomplete ? `1 of 2 ${staffLabelPlural.toLowerCase()} picked. Pick one more, or clear to leave it unassigned.` : ''))
      : customerMissing(customerFields) ? customerMissing(customerFields) : !serviceId ? 'Pick a service' : extraIncomplete ? extraIncomplete : firstRowProblem ? firstRowProblem : (isCoupleBooking && companionPhone.problem) ? `Companion's phone: ${companionPhone.problem}` : couplePickIncomplete ? `1 of 2 ${staffLabelPlural.toLowerCase()} picked. Pick one more, or clear to leave it unassigned.` : '';
  const createDisabled = submitting || (!!activeError && !(activeCard?.kind === 'system' && activeCard.canRetry)) || !!liveCard?.blocking || !!blockOverlapMsg || precheck.blocked || couplePickIncomplete || (isCoupleBooking && !!companionPhone.problem) || (bookingMode === 'group' && (!!groupProblemFooter || groupStaffIncomplete)) || (bookingMode === 'individual' && (!!extraIncomplete || !!firstRowProblem)) || (bookingMode === 'group' ? !groupValid : (!serviceId || !!customerMissing(customerFields)));
  const confirmSlotLabel = confirm?.type === 'move'
    ? [therapists.find((d) => d.id === confirm.slot.colId)?.name || rooms.find((c) => c.id === confirm.slot.colId)?.name || confirm.slot.colName,
       confirm.slot.day,
       format12h(`${String(confirm.slot.hour).padStart(2, '0')}:${String(confirm.slot.minute).padStart(2, '0')}`)].filter(Boolean).join(' · ')
    : '';

  const footerNode = confirm ? (
    // Distinct keys: without them React reuses the same <button> DOM nodes between the confirm and the normal footer,
    // flipping a `type="button"` into the `type="submit"` Create button mid-click — which then submits the form.
    <div key="confirm" role="alertdialog" aria-label={confirm.type === 'move' ? 'Move draft' : 'Discard draft'} className="flex items-center gap-3">
      <p className="flex-1 min-w-0 text-[13px] text-text-primary">
        {confirm.type === 'move' ? `Move this draft to ${confirmSlotLabel}?` : 'Discard this draft?'}
      </p>
      <button
        type="button"
        onClick={() => setConfirm(null)}
        className="h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast whitespace-nowrap"
      >
        {confirm.type === 'move' ? 'Keep here' : 'Keep editing'}
      </button>
      <button
        type="button"
        onClick={() => {
          const c = confirm;
          setConfirm(null);
          if (c.type === 'move') applyRetarget(c.slot); else if (c.type === 'switch') c.action?.(); else onClose();
        }}
        className="h-9 px-3 text-[13px] font-body font-body-medium bg-text-primary text-white rounded-spa hover:opacity-90 spa-transition-fast whitespace-nowrap"
      >
        {confirm.type === 'move' ? 'Move' : 'Discard'}
      </button>
    </div>
  ) : (
    <div key="actions" className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-x-3 gap-y-2">
      {/* Phone: the reason gets its own full-width line (max 2 lines) above the buttons; from sm it sits beside them as before. */}
      <p className={`min-w-0 text-xs ${activeError || precheck.blocked || blockOverlapMsg ? 'text-error font-medium' : 'text-text-secondary'} basis-full line-clamp-2 sm:basis-auto sm:flex-1 sm:line-clamp-3 ${(createDisabled && disabledReason) || groupReadyNote ? '' : 'hidden sm:block'}`} role={activeError ? 'alert' : undefined} aria-live="polite">{createDisabled && firstEmptyField && /^(Pick a (service|customer)|This number)/.test(disabledReason || '') && !activeError
        ? <button type="button" onClick={tapPickService} className="text-left text-error font-medium underline underline-offset-2">{disabledReason}</button>
        : (createDisabled ? disabledReason : groupReadyNote)}</p>
      <button
        type="button"
        onClick={requestClose}
        className="h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="quick-create-form"
        disabled={createDisabled}
        className="h-9 px-4 text-[13px] font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
      >
        {submitting && <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />}
        {submitting ? 'Creating...' : bookingMode === 'group' ? `Create ${peopleCount} bookings` : (precheck.warn || anyRowOverride) ? 'Book anyway…' : 'Create booking'}
      </button>
    </div>
  );

  // Neutral summary row: date + time (the therapist is chosen in the checklist below).
  const summaryRow = (
    <DateTimeRow
      date={bookingDate}
      time={bookingTime}
      onDateChange={setBookingDate}
      onTimeChange={setBookingTime}
      branchHours={branchHours}
      timeRingClass={fieldRing('time')}
      timeFieldAttr="time"
    />
  );

  // Name / Phone / Email / Gender of one person. Guests use it in their card; the lead's (a NEW customer) lives in the Customer block, not a second "contact" card.
  const personFields = (p, idx) => (
  <>
                  <div>
                    <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                      Name {idx === 0 && <span className="text-error">*</span>}
                      {p.customerId && <span className="ml-2 align-middle"><ExistingCustomerTag /></span>}
                    </label>
                    <CustomerAutocomplete
                      value={p.name}
                      onChange={(v) => setPerson(idx, { name: v, customerId: null, previousDue: null })}
                      onSelect={(c) => handleGuestCustomerSelect(idx, c)}
                      branchId={branchId}
                      searchBy="any"
                      placeholder={idx === 0 ? 'Search or type a name' : `Name (blank = ${contactFirst}'s)`}
                    />
                  </div>

                  <div {...(idx === 0 ? { 'data-qc-field': 'phone' } : {})} className={idx === 0 && flashSvc === 'phone' ? 'rounded-spa ring-2 ring-error' : ''}>
                    <PhoneField
                      label="Phone" required={idx === 0 && requireCustomerPhone} id={`qc-person-${idx}-phone`} walkInHint
                      dial={p.countryCode || '+977'} national={p.phone || ''}
                      placeholder={idx === 0 ? '98XXXXXXXX' : `Blank = ${contactFirst}'s`}
                      showProblem={idx === 0 ? p.kind === 'new' : !p.customerId}
                      onChange={({ dial, national }) => (dial !== (p.countryCode || '+977') ? setPerson(idx, { countryCode: dial }) : setPerson(idx, { phone: national, customerId: null, previousDue: null }))}
                    />
                  </div>

                  {canViewPrices && <EarlierBalanceNotice name={p.name} due={p.previousDue} />}

                  <div>
                    <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">Email</label>
                    <input
                      type="email"
                      value={p.email}
                      onChange={(e) => setPerson(idx, { email: e.target.value })}
                      placeholder={idx === 0 ? 'customer@email.com' : `Blank = ${contactFirst}'s`}
                      className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">Gender</label>
                    <div className="flex gap-2">
                      {['Male', 'Female'].map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setPerson(idx, { gender: p.gender === g.toLowerCase() ? '' : g.toLowerCase() })}
                          className={`px-4 py-2 text-sm border rounded-spa transition-colors ${
                            p.gender === g.toLowerCase()
                              ? 'border-primary bg-primary/10 text-primary font-medium'
                              : 'border-border bg-surface text-text-secondary hover:bg-background'
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
  </>
  );

  return (
    <SidePanel isOpen={isOpen} width={PANEL_WIDTH_BOOKING} title={slotInfo?.title || 'New booking'} onClose={requestClose} footer={footerNode}>
      <form id="quick-create-form" onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
        {summaryRow}

        <BlockOverlapWarning message={blockOverlapMsg} />
        {card && (
          <div ref={cardRef}>
            <ErrorGuide card={card} onAction={onGuideAction} area="create-booking" />
            {liveCard && !liveCard.blocking && <p className="mt-1.5 px-0.5 text-xs text-text-secondary">You can still book it; you'll be asked why.</p>}
          </div>
        )}
        <AvailabilityNotice
          precheck={{ ...precheck, verdict: null }}
          staffLabel={staffLabel?.toLowerCase()}
          onPickTime={(t) => setBookingTime(t)}
          onPickTherapist={(id) => setSelectedTherapistIds([id])}
        />

            {/* Booking mode: Individual | Group */}
            {!slotInfo?.lockedClient && <Segmented options={[['individual', 'Individual'], ['group', 'Group']]} value={bookingMode} onChange={setBookingMode} />}

            {bookingMode === 'individual' && (
            <>
            {/* Customer: one closed row (ZNLY-327), like Service and Staff */}
            <div data-qc-field="customer" className={fieldRing('customer')}>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Customer <span className="text-error">*</span>
                {customerKind === 'existing' && <span className="ml-2 align-middle"><ExistingCustomerTag /></span>}
              </label>
              {slotInfo?.lockedClient ? <LockedClientCard client={slotInfo.lockedClient} name={customerName} /> : <CustomerPickRow invalid={flashSvc === 'customer' && !customerKind} kind={customerKind} name={customerName} phone={customerPhone ? `${customerCountryCode}${customerPhone}` : ''} sub={svcSubLine} branchId={branchId} onPick={handleCustomerPick} />}
            </div>

            {customerKind === 'walkin' && !slotInfo?.lockedClient && (
              <div>
                <label className="flex items-baseline justify-between font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                  <span>Name</span><span className="text-xs font-normal text-text-secondary">optional</span>
                </label>
                <input type="text" value={walkInLabel} onChange={(e) => setWalkInLabel(e.target.value)} placeholder="First name, e.g. Ram" maxLength={40}
                  className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                <p className="mt-1.5 text-xs text-text-secondary">No customer profile is created. You can add the client later from the booking.</p>
              </div>
            )}

            {customerKind === 'existing' && canViewPrices && <EarlierBalanceNotice name={customerName} due={previousDue} />}

            {customerKind === 'new' && (
            <>
            {/* Customer name */}
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Name <span className="text-error">*</span>
              </label>
              <CustomerAutocomplete
                value={customerName}
                onChange={handleCustomerNameChange}
                onSelect={handleCustomerSelect}
                branchId={branchId}
                inputRef={nameRef}
                required
              />
            </div>

            {/* Phone */}
            <div data-qc-field="phone" className={flashSvc === 'phone' ? 'rounded-spa ring-2 ring-error' : ''}>
              <PhoneField
                label="Phone" required={requireCustomerPhone} id="qc-phone" walkInHint
                dial={customerCountryCode} national={customerPhone}
                onChange={({ dial, national }) => { if (dial !== customerCountryCode) setCustomerCountryCode(dial); if (national !== customerPhone) handleCustomerPhoneChange(national); }}
                renderInput={(r) => (
                  <CustomerAutocomplete
                    id={r.id}
                    value={r.value}
                    onChange={r.onValueChange}
                    onSelect={handleCustomerSelect}
                    onBlur={() => checkPreviousDue(`${customerCountryCode}${customerPhone.replace(/\D/g, '')}`)}
                    branchId={branchId}
                    searchBy="phone"
                    required={requireCustomerPhone}
                    inputMode={r.inputMode}
                    inputClassName={r.className}
                  />
                )}
              />
            </div>

            {canViewPrices && <EarlierBalanceNotice name={customerName} due={previousDue} />}

            </>
            )}

            {/* Email (an existing customer's profile that has none) */}
            {(customerKind === 'new' || (customerKind === 'existing' && profileMissing.email)) && (
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="customer@email.com"
                className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            )}

            {/* Gender */}
            {(customerKind === 'new' || (customerKind === 'existing' && profileMissing.gender)) && (
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Gender
              </label>
              <div className="flex gap-2">
                {['Male', 'Female'].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setCustomerGender(customerGender === g.toLowerCase() ? '' : g.toLowerCase())}
                    className={`px-4 py-2 text-sm border rounded-spa transition-colors ${
                      customerGender === g.toLowerCase()
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border bg-surface text-text-secondary hover:bg-background'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* Service (with 2+ services, Service 1 is drawn as the same card as the others, below) */}
            {!useCard && (
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Service <span className="text-error">*</span>
              </label>
              <div data-qc-field="service"><ServicePickRow required invalid={flashSvc === 'service' && !serviceId} services={pickerServices} value={serviceId} onChange={setServiceId} branchId={branchId} canViewPrices={canViewPrices} loading={servicesLoading} openSignal={openServiceSignal} onSignalConsumed={() => setOpenServiceSignal(0)} title="Service for the booking" sub={svcSubLine} ariaLabel="Service" /></div>
              {visitorTherapist && visitorServiceNames && (
                <p className="mt-1.5 text-xs text-text-secondary" data-visitor-services-help>
                  Showing the {pickerServices.length} service{pickerServices.length === 1 ? '' : 's'} {visitorTherapist.name} does at the home {(locationLabel || 'branch').toLowerCase()} that this one also offers.
                </p>
              )}
            </div>
            )}

            {/* Room */}
            {rooms && rooms.length > 0 && (
              <div data-qc-field="room" className={fieldRing('room')}>
                <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                  Room
                </label>
                <RoomPickRow rooms={rooms} bookings={bookings} date={bookingDate} startTime={bookingTime}
                  durationMin={selectedService?.duration_minutes || dragMinutes || 60} value={roomId} onChange={setRoomId} openSignal={roomSignal} onSignalConsumed={() => setRoomSignal(0)} serviceName={selectedService?.name} title={`Room for ${customerKind === 'walkin' ? `Walk-in${walkInLabel.trim() ? ` · ${walkInLabel.trim()}` : ''}` : (customerName.trim() || 'the booking')}`} />
              </div>
            )}

            {/* Therapist(s): hidden for a combo whose every component needs its own staff, and for self-service amenities */}
            {!comboAllDifferentStaff && serviceRequiresTherapist && !useCard && (
            <div data-qc-field="staff" className={fieldRing('staff')}>
            {(() => {
              const s0 = clockToMin(bookingTime); const e0 = clockToMin(pickerSlotEnd);
              const maxPick = selectedService?.is_couple ? 2 : (selectedTherapistIds.length > 1 ? Infinity : 1);
              const picked = selectedTherapistIds.map((tid) => pickerPeople.find((t) => t.id === tid) || { id: tid, name: staffNameOf(tid) });
              const info = pickedRowStatusMulti(picked, {
                slot: dayBookings && s0 != null ? { start: s0, end: e0 > s0 ? e0 : s0 + 60 } : null,
                rangesById: dayBookings && bookingDate ? staffDayRanges(dayBookings, { date: bookingDate }) : {},
                offById: dayOff, date: bookingDate, today: nepalNow().today, busyOk: allowStaffOverlap,
              });
              const lbl = selectedTherapistIds.length > 1 ? staffLabelPlural : staffLabel;
              return (
                <div>
                  <p className="flex items-baseline justify-between mb-1.5 font-body font-body-medium text-[13px] text-text-primary">{lbl} <span className="text-xs font-normal text-text-secondary">optional</span></p>
                  <StaffPickRow
                    people={picked}
                    max={maxPick}
                    statusLine={info.statusLine}
                    pill={info.pill}
                    problem={info.problem}
                    emptyLabel={`Pick ${staffLabel.toLowerCase()}`}
                    title={`${lbl} for the booking`}
                    renderPicker={(close) => (
                      <StaffPicker
                        people={pickerPeople}
                        selectedIds={selectedTherapistIds}
                        onChange={(ids) => { setSelectedTherapistIds(ids); if (maxPick === 1) close(); }}
                        max={maxPick}
                        header={{ title: `${lbl} for the booking${maxPick === 2 ? ' · pick 2' : ''}`, sub: [selectedService?.name, s0 != null && e0 != null ? rangeLabel(s0, e0) : ''].filter(Boolean).join(' · ') }}
                        onNone={() => { setSelectedTherapistIds([]); close(); }}
                        noneLabel={`No ${staffLabel.toLowerCase()} · assign later`}
                        staffLabel={staffLabel}
                        staffLabelPlural={staffLabelPlural}
                        slot={bookingDate && bookingTime ? { date: bookingDate, start: bookingTime, end: pickerSlotEnd } : null}
                        serviceId={selectedService?.id || null}
                        bookings={dayBookings}
                        offById={dayOff}
                      />
                    )}
                  />
                </div>
              );
            })()}
            </div>
            )}

            {/* ZNLY-402 3b: more services for the same person in one booking (org setting ON; nothing is drawn otherwise) */}
            {useCard && (
              <ExtraServiceRows
                rows={activeRows} setRows={setExtraRows} times={extraTimes} services={extraServices} first={selectedService} canAdd={canMulti}
                firstCard={{
                  serviceId, therapistId: selectedTherapistIds[0] || '', start: bookingTime, flash: flashSvc === 'service' && !serviceId,
                  firstServices: pickerServices, loading: servicesLoading, openSignal: openServiceSignal, onSignalConsumed: () => setOpenServiceSignal(0),
                  onService: setServiceId, onStaff: (v) => setSelectedTherapistIds(v ? [v] : []), onStart: setBookingTime,
                  // Removing Service 1 promotes Service 2 into the panel's own service (its start only if it was set by hand).
                  onRemove: (next) => { if (!next) return; setServiceId(next.serviceId); setSelectedTherapistIds(next.therapistId ? [next.therapistId] : []); if (next.start) setBookingTime(next.start); setExtraRows((rs) => rs.slice(1)); },
                }}
                staffRing={fieldRing('staff')}
                branchId={branchId} canViewPrices={canViewPrices} pickerPeople={pickerPeople} dayBookings={dayBookings} dayOff={dayOff}
                branchHours={branchHours} bookingDate={bookingDate} allowStaffOverlap={allowStaffOverlap} staffLabel={staffLabel} staffLabelPlural={staffLabelPlural}
                problems={rowProblems} ownProblems={ownProblems} onProblem={onRowProblem} errorRow={errorKey === formKey ? errorRow : null} errorText={activeError || ''} flashRow={flashSvc && /^service-x\d+$/.test(flashSvc) ? Number(flashSvc.slice(9)) : null}
              />
            )}
            {useCard && visitorTherapist && visitorServiceNames && (
              <p className="-mt-1 text-xs text-text-secondary" data-visitor-services-help>
                Showing the {pickerServices.length} service{pickerServices.length === 1 ? '' : 's'} {visitorTherapist.name} does at the home {(locationLabel || 'branch').toLowerCase()} that this one also offers.
              </p>
            )}

            {/* Couple — separate rooms & companion; only for a couple service with 2+ therapists */}
            {isCoupleBooking && (
              <div className="space-y-2 p-3 border border-border rounded-spa-lg bg-background">
                <p className="font-body font-body-medium text-[13px] text-text-primary">Couple · separate rooms &amp; companion (optional)</p>
                <p className="text-xs text-text-secondary">Leave a companion's room unset to keep them in the room selected above.</p>
                <div className="space-y-1.5">
                  {selectedTherapistIds.slice(1).map((tid) => {
                    const t = (therapists || []).find((th) => th.id === tid);
                    return (
                      <div key={tid} className="flex items-center gap-2">
                        <span className="font-body font-body-medium text-[13px] text-text-primary w-24 truncate flex-shrink-0">{t?.name || 'Companion'}</span>
                        <div className="flex-1 min-w-0"><RoomPickRow rooms={rooms} bookings={bookings} date={bookingDate} startTime={bookingTime}
                          durationMin={selectedService?.duration_minutes || dragMinutes || 60} value={therapistRoomOverrides[tid] || ''}
                          onChange={(val) => setTherapistRoomOverrides((prev) => ({ ...prev, [tid]: val }))}
                          anyLabel="Same room as above" anyHint="Keeps them in the room above" title={`Room for ${t?.name || 'companion'}`} /></div>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="text" value={companionName} onChange={(e) => setCompanionName(e.target.value)} placeholder="Companion's name (optional)"
                    className="w-full h-10 px-3 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                  <PhoneField {...companionPhone.field} id="qc-companion-phone" placeholder="Companion's phone (optional)" />
                </div>
              </div>
            )}

            {/* Combo schedule & staff: when each component runs (same offset algorithm as createComboBookingItems) and who does it */}
            {isComboService && (
              <div className="rounded-spa-lg border border-border bg-surface shadow-spa-resting">
                <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-primary/5 border-b border-border rounded-t-spa-lg">
                  <div className="flex items-center gap-2">
                    <Icon name="Layers" size={14} className="text-primary" />
                    <span className="font-body font-body-medium text-[13px] text-text-primary">Combo schedule &amp; staff</span>
                  </div>
                  {comboComponents.length > 0 && (
                    <span className="text-[11px] text-text-secondary bg-surface border border-border rounded-full px-2 py-0.5">{comboComponents.length} services</span>
                  )}
                </div>
                <div className="px-3.5 py-3">
                  {comboComponentsLoading ? (
                    <p className="text-xs text-text-secondary py-1">Loading combo services...</p>
                  ) : comboComponents.length === 0 ? (
                    <p className="text-xs text-text-secondary py-1">No components configured for this combo.</p>
                  ) : (
                    <div className="relative space-y-3.5">
                      {comboSchedule.map((c, index) => {
                        const toClock = (min) => format12h(minToHHMM(c.base + min));
                        const heldFor = comboHeld[index] || {};
                        return (
                          <div key={c.componentId} className="flex items-start gap-3">
                            <div className="flex flex-col items-center flex-shrink-0">
                              <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center font-data text-[11px]">{index + 1}</div>
                              {index < comboSchedule.length - 1 && <div className="w-px flex-1 min-h-[22px] bg-border mt-1" />}
                            </div>
                            <div className="flex-1 min-w-0 pb-0.5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-body font-body-medium text-[13px] text-text-primary leading-tight">{c.service?.name || 'Service'}</p>
                                  <p className="font-data text-xs text-text-secondary mt-0.5">{toClock(c.start)} – {toClock(c.end)} <span className="text-text-tertiary">· {c.duration}min</span></p>
                                </div>
                                {c.defaultSameStaff && (
                                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-text-secondary bg-background border border-border rounded-full px-2 py-0.5">
                                    <Icon name="Link" size={10} />
                                    Same staff
                                  </span>
                                )}
                              </div>
                              {!c.defaultSameStaff && (
                                <div className="mt-2">
                                  <StaffPickRow
                                    id={comboTherapistOverrides[c.serviceId] || null}
                                    {...comboPick(index)}
                                    problem={comboProblemText(index)}
                                    emptyLabel={`Pick ${staffLabel.toLowerCase()}`}
                                    title={`${staffLabel} for step ${index + 1}`}
                                    renderPicker={(close) => (
                                      <StaffPicker
                                        people={pickerPeople}
                                        selectedIds={comboTherapistOverrides[c.serviceId] ? [comboTherapistOverrides[c.serviceId]] : []}
                                        onChange={(ids) => { setComboTherapistOverrides((prev) => ({ ...prev, [c.serviceId]: ids[0] || '' })); close(); }}
                                        max={1}
                                        header={{ title: `${staffLabel} for step ${index + 1} · ${c.service?.name || 'Service'}`, sub: `${c.service?.name || 'Service'} · ${toClock(c.start)}–${toClock(c.end)}` }}
                                        onNone={() => { setComboTherapistOverrides((prev) => ({ ...prev, [c.serviceId]: '' })); close(); }}
                                        noneLabel={`No ${staffLabel.toLowerCase()} · assign later`}
                                        staffLabel={staffLabel}
                                        staffLabelPlural={staffLabelPlural}
                                        slot={bookingDate ? { date: bookingDate, start: minToHHMM(c.base + c.start), end: minToHHMM(c.base + c.end) } : null}
                                        serviceId={c.serviceId || null}
                                        bookings={dayBookings}
                                        offById={comboOff}
                                        lockedById={Object.fromEntries(Object.entries(heldFor).map(([sid, oi]) => [sid, { pill: `With step ${oi + 1}`, line: `With step ${oi + 1} at this time` }]))}
                                      />
                                    )}
                                  />
                                </div>
                              )}
                              {c.defaultSameRoom === false && (
                                <div className="mt-2">
                                  <RoomPickRow rooms={rooms} bookings={bookings} date={bookingDate} startTime=""
                                    value={comboRoomOverrides[c.serviceId] || ''}
                                    onChange={(val) => setComboRoomOverrides(prev => ({ ...prev, [c.serviceId]: val }))}
                                    anyLabel="Select room" anyHint="Pick the room for this part" title="Room for this part" />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            </>
            )}

            {bookingMode === 'group' && (
            <>
            {(() => { const p = people[0] || {}; return (
            <>
            {(
              <div data-qc-field="customer" className={fieldRing('customer')}>
                <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                  Customer <span className="text-error">*</span>
                  {p.kind === 'existing' && <span className="ml-2 align-middle"><ExistingCustomerTag /></span>}
                </label>
                <CustomerPickRow invalid={flashSvc === 'customer' && !p.kind} kind={p.kind} name={p.name} phone={p.phone ? `${p.countryCode || '+977'}${p.phone}` : ''} sub={svcSubLine} branchId={branchId} onPick={handleContactPick} />
              </div>
            )}
            {p.kind === 'walkin' && (
              <div>
                <label className="flex items-baseline justify-between font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                  <span>Name</span><span className="text-xs font-normal text-text-secondary">optional</span>
                </label>
                <input type="text" value={p.label || ''} onChange={(e) => setPerson(0, { label: e.target.value })} placeholder="First name, e.g. Ram" maxLength={40}
                  className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                <p className="mt-1.5 text-xs text-text-secondary">No customer profile is created. Guests left blank are walk-ins too.</p>
              </div>
            )}
            {p.kind === 'existing' && canViewPrices && <EarlierBalanceNotice name={p.name} due={p.previousDue} />}
            {p.kind === 'new' && personFields(p, 0)}
            </>
            ); })()}

            {/* Couple | Separate (+ How many? on the same row) */}
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">Group type</label>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0"><Segmented options={[['couple', 'Couple (2)'], ['separate', 'Separate']]} value={groupType} onChange={setGroupType} /></div>
                {groupType === 'separate' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[13px] font-body-medium text-text-primary whitespace-nowrap">How many?</span>
                    <div className="relative w-20" ref={countDropdownRef}>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label="How many people"
                        value={countText}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/\D/g, '');
                          setCountText(raw);
                          const n = parseInt(raw, 10);
                          if (!Number.isNaN(n) && n >= 2 && n <= 20) setSeparateCount(n);
                        }}
                        onFocus={(e) => { e.target.select(); setCountDropdownOpen(true); }}
                        onBlur={() => commitCount(countText)}
                        className="w-full h-10 max-md:h-11 pl-3 pr-7 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button type="button" aria-label="Show counts" onClick={() => setCountDropdownOpen((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-primary transition-colors">
                        <Icon name="ChevronDown" size={14} />
                      </button>
                      {countDropdownOpen && (
                        <div className="absolute top-full right-0 mt-1 w-full max-h-48 overflow-y-auto bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown">
                          {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                            <button key={n} type="button" onClick={() => { commitCount(String(n)); setCountDropdownOpen(false); }}
                              className={`w-full text-left px-3 py-1.5 text-sm font-body cursor-pointer hover:bg-primary/10 ${n === separateCount ? 'bg-primary/10 font-body-medium text-primary' : 'text-text-primary'}`}>
                              {n}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Same | Different service */}
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Group service
              </label>
              <Segmented options={[['same', 'Same for everyone'], ['different', 'Different per guest']]} value={serviceMode} onChange={setServiceMode} />
              {serviceMode === 'same' && (
                <div className="mt-2" data-qc-field="service">
                  <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                    Service <span className="text-error">*</span>
                  </label>
                  <ServicePickRow required invalid={flashSvc === 'service' && !groupServiceId} services={groupServices} value={groupServiceId} onChange={setGroupServiceId} branchId={branchId} canViewPrices={canViewPrices} title="Service for the group" sub={svcSubLine} ariaLabel="Service" />
                </div>
              )}
            </div>

            {/* Shared room for couple */}
            {groupType === 'couple' && rooms && rooms.length > 0 && (
              <div>
                <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                  Room <span className="text-xs text-text-secondary font-normal">(shared — needs capacity 2)</span>
                </label>
                <RoomPickRow rooms={rooms} bookings={bookings} date={bookingDate} startTime={bookingTime} minCapacity={2}
                  durationMin={svcDur(groupServiceId)} value={groupRoomId} onChange={setGroupRoomId} title="Shared room" />
              </div>
            )}

            {/* Fill free staff (ZNLY-303): only while some guest has no staff; afterwards a one-line result with Undo */}
            {bookingDate && bookingTime && dayChecking && emptyGuests > 0 && hasAnyService && (
              <div className="flex items-center gap-3 px-3.5 py-2.5 border border-primary/20 rounded-[11px] bg-primary/5">
                <p className="flex-1 min-w-0 text-[13px] text-text-secondary">{emptyGuests} of {people.length} guests have no {staffLabel.toLowerCase()}</p>
                <button type="button" disabled className="min-h-[36px] text-[13px] font-body font-bold text-text-secondary whitespace-nowrap cursor-wait">Checking who&apos;s free…</button>
              </div>
            )}
            {bookingDate && bookingTime && dayKnown && ((emptyGuests > 0 && hasAnyService) || fillUndo) && (
              <div className="flex items-center gap-3 px-3.5 py-2.5 border border-primary/20 rounded-[11px] bg-primary/5">
                {emptyGuests > 0 ? (
                  <>
                    <p className="flex-1 min-w-0 text-[13px] text-text-primary">{emptyGuests} of {people.length} guests have no {staffLabel.toLowerCase()}</p>
                    <button type="button" onClick={fillFree} className="min-h-[36px] text-[13px] font-body font-bold text-primary hover:underline whitespace-nowrap">Fill free {staffLabelPlural.toLowerCase()}</button>
                  </>
                ) : (
                  <>
                    <p className="flex-1 min-w-0 text-[13px] text-text-primary">All {people.length} guests have {staffLabelPlural.toLowerCase()} · {fillUndo.count} filled</p>
                    <button type="button" onClick={undoFillFree} className="min-h-[36px] text-[13px] font-body font-bold text-primary hover:underline">Undo</button>
                  </>
                )}
              </div>
            )}

            {/* Per-person rows */}
            <div className="space-y-3">
              {people.map((p, idx) => (
                <div key={idx} className="border border-border rounded-[14px] p-3.5 space-y-3 bg-surface">
                  <div className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:justify-between md:gap-2">
                    <span className="whitespace-nowrap text-sm font-body font-body-semibold text-text-primary">
                      {`Person ${idx + 1}`}
                    </span>
                    <span className="text-xs text-text-secondary md:text-right">{idx > 0 ? "optional · blank uses the contact's details" : 'the customer above'}</span>
                  </div>


                  {idx > 0 && personFields(p, idx)}

                  {serviceMode === 'different' && (
                    <div data-qc-field={`service-${idx}`}>
                      <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                        Service <span className="text-error">*</span>
                      </label>
                      <ServicePickRow required invalid={flashSvc === `service-${idx}` && !p.serviceId} services={groupServices} value={p.serviceId} onChange={(val) => setPerson(idx, { serviceId: val })} branchId={branchId} canViewPrices={canViewPrices} title={`Service for ${idx === 0 ? 'the booking contact' : `Person ${idx + 1}`}`} sub={svcSubLine} ariaLabel="Service" />
                    </div>
                  )}

                  <div>
                    <label className="flex items-baseline justify-between font-body font-body-medium text-[13px] text-text-primary mb-1.5">{staffLabel} <span className="text-xs font-normal text-text-secondary">optional</span></label>
                    <StaffPickRow
                      id={p.therapistId}
                      {...guestPick(idx)}
                      problem={problemText(idx)}
                      emptyLabel={`Pick ${staffLabel.toLowerCase()}`}
                      title={`${staffLabel} for ${guestLabel(idx)}`}
                      renderPicker={(close) => (
                        <>
                          <StaffPicker
                            people={pickerPeople}
                            selectedIds={p.therapistId ? [p.therapistId] : []}
                            onChange={(ids) => { setGuestStaff(idx, ids[0] || ''); close(); }}
                            max={1}
                            header={{ title: `${staffLabel} for ${idx === 0 ? 'Booking contact' : `Person ${idx + 1}`}${p.name?.trim() ? ` · ${p.name.trim()}` : ''}`, sub: guestSub(idx) }}
                            onNone={() => { setGuestStaff(idx, ''); close(); }}
                            noneLabel={`No ${staffLabel.toLowerCase()} · assign later`}
                            staffLabel={staffLabel}
                            staffLabelPlural={staffLabelPlural}
                            slot={guestSlots[idx] && bookingDate ? { date: bookingDate, start: bookingTime, end: `${String(Math.floor(guestSlots[idx].end / 60) % 24).padStart(2, '0')}:${String(guestSlots[idx].end % 60).padStart(2, '0')}` } : null}
                            serviceId={guestServiceId(p) || null}
                            bookings={dayBookings}
                            offById={groupOff}
                            lockedById={Object.fromEntries(Object.entries(groupHeld[idx] || {}).map(([sid, oi]) => [sid, oi === 0 ? { pill: 'With contact', line: `With the booking contact${people[0]?.name?.trim() ? ` (${people[0].name.trim()})` : ''} at this time` } : { pill: `With Person ${oi + 1}`, line: `With ${guestLabel(oi)} at this time` }]))}
                          />
                        </>
                      )}
                    />
                  </div>

                  {groupType === 'separate' && rooms && rooms.length > 0 && (
                    <div>
                    <label className="flex items-baseline justify-between font-body font-body-medium text-[13px] text-text-primary mb-1.5">Room <span className="text-xs font-normal text-text-secondary">optional</span></label>
                    <RoomPickRow rooms={rooms} bookings={bookings} date={bookingDate} startTime={bookingTime}
                      durationMin={svcDur(p.serviceId)} value={p.roomId} onChange={(val) => setPerson(idx, { roomId: val })} title={`Room for ${guestLabel(idx)}`} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            </>
            )}

            {CUSTOMER_REFERRALS_ENABLED && customerName.trim() && customerPhone.replace(/\D/g, '').length >= 7 && !isExistingCustomer && (
              <div className="space-y-3">
                <label className="block font-body font-body-medium text-sm text-text-primary -mb-2">
                  Referred by (customer)
                </label>
                <div>
                  <CustomerAutocomplete
                    value={referringCustomerName}
                    onChange={handleReferringNameChange}
                    onSelect={handleReferringCustomerSelect}
                    branchId={branchId}
                    placeholder="Referrer's name"
                  />
                </div>
                <PhoneField
                  label="Phone" id="qc-referrer-phone" showProblem={false}
                  dial={referringCustomerCountryCode} national={referringCustomerPhone}
                  onChange={({ dial, national }) => { if (dial !== referringCustomerCountryCode) setReferringCustomerCountryCode(dial); if (national !== referringCustomerPhone) handleReferringPhoneChange(national); }}
                  renderInput={(r) => (
                    <CustomerAutocomplete
                      id={r.id}
                      value={r.value}
                      onChange={r.onValueChange}
                      onSelect={handleReferringCustomerSelect}
                      branchId={branchId}
                      searchBy="phone"
                      inputMode={r.inputMode}
                      inputClassName={r.className}
                    />
                  )}
                />

                {referringCustomerId && (
                  <div>
                    <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                      Reward (wallet credit)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={referringRewardAmount}
                      onChange={(e) => setReferringRewardAmount(e.target.value)}
                      placeholder="e.g. 500 (leave blank for the org default)"
                      className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>
                )}

                <p className="font-body text-xs text-text-secondary">
                  This looks like a new customer. If an existing customer referred them, enter their
                  phone number or name and pick them from the suggestions, then choose their reward —
                  it'll be credited once this booking is completed and paid.
                </p>
              </div>
            )}

            {/* Special requests */}
            <div>
              <label className="flex items-baseline justify-between font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Special requests
                {bookingMode === 'group' && <span className="text-xs font-normal text-text-secondary">for every booking in this group</span>}
              </label>
              <textarea
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                placeholder="Any special requests or notes..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
            </div>

      </form>
    </SidePanel>
  );
};


export default QuickCreatePanel;
