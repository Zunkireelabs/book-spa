import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Icon from '../../../../components/AppIcon';
import MiniMonthCalendar from './MiniMonthCalendar';
import SidePanel from '../../../../components/ui/SidePanel';
import BlockOverlapWarning from '../../../../components/ui/BlockOverlapWarning';
import CustomSelect from '../../../../components/ui/CustomSelect';
import CountryCodeSelect, { parsePhone } from '../../../../components/ui/CountryCodeSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import { useDayBlocks } from '../../../../hooks/useBlockOverlap';
import { findBlockOverlap, describeBlockOverlap } from '../../../../utils/blockOverlap';
import { getCustomerOutstandingBalance } from '../../../../services/api';
import { CUSTOMER_REFERRALS_ENABLED } from '../../../../lib/featureFlags';
import { todayStr } from './calendarDates';


// ── Quick Create Panel ────────────────────────────────────────

const QuickCreatePanel = ({ slotInfo, services, servicesLoading, therapists, rooms, bookings = [], onClose, onSubmit, branchId, branchHours, retarget, onDraftChange, columnMode = 'therapist', allTherapists = [], guardRef }) => {
  const [serviceId, setServiceId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCountryCode, setCustomerCountryCode] = useState('+977');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerGender, setCustomerGender] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [dragMinutes, setDragMinutes] = useState(0); // length of the range dragged on the grid; used until a service is picked
  const [selectedTherapistIds, setSelectedTherapistIds] = useState([]);
  const [roomId, setRoomId] = useState('');
  // Couple (is_couple service + 2 therapists, Individual mode): per-companion (non-primary therapist) room override and
  // the companion's name/phone. Not used by the Group flow.
  const [therapistRoomOverrides, setTherapistRoomOverrides] = useState({});
  const [companionName, setCompanionName] = useState('');
  const [companionPhone, setCompanionPhone] = useState('');
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
  const [timeText, setTimeText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);
  const [error, setError] = useState(null);
  const [therapistSearch, setTherapistSearch] = useState('');
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false);
  const nameRef = useRef(null);
  const initialDraftRef = useRef({ date: '', time: '', therapist: '', room: '' });
  // Inline confirm in the footer: { type: 'discard' } or { type: 'move', slot }. Replaces window.confirm.
  const [confirm, setConfirm] = useState(null);
  const timeDropdownRef = useRef(null);
  const timeListRef = useRef(null);

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

  // Reset form when slot changes + pre-select therapist/room from column
  useEffect(() => {
    setServiceId(slotInfo?.defaultServiceId || '');
    setCustomerName(slotInfo?.defaultCustomerName || '');
    setCustomerPhone('');
    setCustomerCountryCode('+977');
    setCustomerEmail('');
    setCustomerGender('');
    setSpecialRequests('');
    setIsExistingCustomer(false);
    setReferringCustomerId('');
    setReferringCustomerPhone('');
    setReferringCustomerCountryCode('+977');
    setReferringCustomerName('');
    setReferringRewardAmount('');
    setSelectedTherapistIds(slotInfo?.colType === 'therapist' && slotInfo.colId ? [slotInfo.colId] : []);
    setTherapistSearch('');
    setRoomId(slotInfo?.colType === 'room' ? slotInfo.colId : '');
    setTherapistRoomOverrides({});
    setCompanionName('');
    setCompanionPhone('');
    setBookingDate(slotInfo?.day || '');
    const slotTime = slotInfo && Number.isFinite(slotInfo.hour) && Number.isFinite(slotInfo.minute)
      ? `${String(slotInfo.hour).padStart(2, '0')}:${String(slotInfo.minute).padStart(2, '0')}`
      : '';
    setBookingTime(slotTime);
    setTimeText(slotTime ? format12h(slotTime) : '');
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
    setConfirm(null);
    initialDraftRef.current = {
      date: slotInfo?.day || '',
      time: slotTime,
      therapist: slotInfo?.colType === 'therapist' && slotInfo.colId ? slotInfo.colId : '',
      room: slotInfo?.colType === 'room' ? slotInfo.colId : '',
    };
  }, [slotInfo]);

  // Compute which therapists & rooms are busy during the selected time slot
  const selectedService = (services || []).find((s) => s.id === serviceId);
  // Gate the section AND the submitted payload on the same condition, so switching away from a couple service never
  // ships hidden companion data.
  const isCoupleBooking = bookingMode === 'individual' && selectedTherapistIds.length > 1 && !!selectedService?.is_couple;
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

  // Parse room capacity from amenities (e.g., "3 Room" → 3, "1 Bed" → 1)
  const getRoomCapacity = (room) => {
    if (!room.amenities || room.amenities.length === 0) return 1;
    const match = room.amenities[0].match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  };

  const busyResources = useMemo(() => {
    if (!bookingDate || !bookingTime) return { therapistIds: new Set(), roomBookingCounts: new Map() };
    const durationMin = selectedService?.duration_minutes || 60;
    const [sh, sm] = bookingTime.split(':').map(Number);
    const slotStart = sh * 60 + sm;
    const slotEnd = slotStart + durationMin;

    const busyTherapists = new Set();
    const roomBookingCounts = new Map();

    for (const b of bookings) {
      // calendarData.bookings uses raw DB format (snake_case)
      const status = (b.status || '').toLowerCase();
      if (['cancelled', 'no show', 'completed'].includes(status)) continue;
      if (b.date !== bookingDate) continue;

      // Raw DB: start_time = "HH:MM:SS", end_time = "HH:MM:SS"
      const startStr = b.start_time || '00:00:00';
      const endStr = b.end_time;
      const [bh, bm] = startStr.split(':').map(Number);
      const bStart = bh * 60 + bm;

      let bEnd;
      if (endStr) {
        const [eh, em] = endStr.split(':').map(Number);
        bEnd = eh * 60 + em;
      } else {
        // Fallback: use service duration
        const svc = (services || []).find((s) => s.id === b.service_id);
        bEnd = bStart + (svc?.duration_minutes || 60);
      }

      // Check time overlap: new booking [slotStart, slotEnd) overlaps [bStart, bEnd)
      if (slotStart < bEnd && slotEnd > bStart) {
        // Mark all therapists (from junction table or primary) as busy
        if (b.booking_therapists?.length > 0) {
          b.booking_therapists.forEach(bt => busyTherapists.add(bt.therapist_id));
        } else if (b.therapist_id) {
          busyTherapists.add(b.therapist_id);
        }
        if (b.room_id) roomBookingCounts.set(b.room_id, (roomBookingCounts.get(b.room_id) || 0) + 1);
      }
    }

    return { therapistIds: busyTherapists, roomBookingCounts };
  }, [bookings, bookingDate, bookingTime, selectedService, services]);

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
        next.push({ name: '', phone: '', countryCode: '+977', email: '', gender: '', therapistId: '', serviceId: '', roomId: '' });
      }
      return next;
    });
  }, [bookingMode, peopleCount]);

  const setPerson = (idx, patch) =>
    setPeople((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const timeOptions = useMemo(() => {
    const [openH] = (branchHours?.openTime || '09:00:00').split(':').map(Number);
    const [closeH, closeM] = (branchHours?.closeTime || '21:00:00').split(':').map(Number);
    const opts = [];
    for (let h = openH; h <= closeH; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === closeH && m > closeM) break;
        const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        opts.push(val);
      }
    }
    // Include current bookingTime if it doesn't match a 15-min slot
    if (bookingTime && !opts.includes(bookingTime)) {
      opts.push(bookingTime);
      opts.sort();
    }
    return opts;
  }, [branchHours, bookingTime]);

  const format12h = (time24) => {
    const [h, m] = time24.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')}${suffix}`;
  };

  // Parse free-typed time (e.g. "9", "9:30", "9:30am", "21:15") into "HH:MM".
  // Returns null while the text is incomplete/invalid so the field can keep it.
  const parseTimeInput = (raw) => {
    const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    const m = match[2] ? parseInt(match[2], 10) : 0;
    const ampm = match[3]?.toLowerCase();
    if (ampm) {
      if (h < 1 || h > 12) return null;
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
    }
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Close time dropdown on outside click
  useEffect(() => {
    if (!timeDropdownOpen) return;
    const handleClick = (e) => {
      if (timeDropdownRef.current && !timeDropdownRef.current.contains(e.target)) {
        setTimeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [timeDropdownOpen]);

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

  // Auto-scroll to selected time when dropdown opens
  useEffect(() => {
    if (timeDropdownOpen && timeListRef.current) {
      const selected = timeListRef.current.querySelector('[data-selected="true"]');
      if (selected) selected.scrollIntoView({ block: 'center' });
    }
  }, [timeDropdownOpen]);

  // Same mode → one shared service; Different mode → every person must pick one.
  const groupServiceValid = serviceMode === 'same'
    ? !!groupServiceId
    : (people.length > 0 && people.every((p) => !!p.serviceId));
  const groupValid = bookingMode !== 'group'
    || (people[0]?.name?.trim() && people[0]?.phone?.replace(/\D/g, '') && groupServiceValid);

  const buildGroupPeople = () => {
    // Blank "other" persons inherit the booking contact's credentials.
    const lead = people[0] || {};
    const leadName = lead.name?.trim();
    const leadPhone = lead.phone?.replace(/\D/g, '')
      ? (lead.countryCode || '+977') + lead.phone.replace(/\D/g, '')
      : null;
    const leadEmail = lead.email?.trim();
    return people.map((p, idx) => ({
      customerName: p.name?.trim() || (idx === 0 ? null : leadName) || null,
      customerPhone: p.phone?.replace(/\D/g, '')
        ? (p.countryCode || '+977') + p.phone.replace(/\D/g, '')
        : (idx === 0 ? null : leadPhone) || null,
      customerEmail: p.email?.trim() || (idx === 0 ? null : leadEmail) || null,
      customerGender: p.gender || (idx === 0 ? null : lead.gender) || null,
      serviceId: serviceMode === 'same' ? groupServiceId : p.serviceId,
      therapistIds: p.therapistId ? [p.therapistId] : null,
      roomId: groupType === 'couple' ? (groupRoomId || null) : (p.roomId || null),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (bookingMode === 'group' ? !groupValid : (!serviceId || !customerName.trim() || !customerPhone.replace(/\D/g, ''))) return;
    if (blockOverlapMsg) return;
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
          customerName: customerName.trim(),
          customerPhone: customerPhone.replace(/\D/g, '')
            ? customerCountryCode + customerPhone.replace(/\D/g, '')
            : null,
          customerEmail: customerEmail.trim() || null,
          customerGender: customerGender || null,
          specialRequests: specialRequests.trim() || null,
          therapistIds: selectedTherapistIds.length > 0 ? selectedTherapistIds : null,
          roomId: roomId || null,
          therapistRoomOverrides: isCoupleBooking
            ? Object.fromEntries(selectedTherapistIds.slice(1).map((tid) => [tid, therapistRoomOverrides[tid] || roomId || null]))
            : undefined,
          companionName: isCoupleBooking ? (companionName.trim() || null) : undefined,
          companionPhone: isCoupleBooking ? (companionPhone.trim() || null) : undefined,
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
      setError(err);
      setSubmitting(false);
      submitInFlightRef.current = false;
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
  const peopleEdited = people.some((p) => p.name || p.phone || p.email || p.gender || p.therapistId || p.serviceId || p.roomId);
  // "Dirty" = the user edited something that is NOT the slot itself. Date, time and column come from the slot (and are
  // moved silently by retargeting); service, customer, contact, notes, group members, referral, and a therapist/room
  // choice that differs from what the slot set all count as an edit.
  const isDirty = isOpen && (
    !!(serviceId || customerName.trim() || customerPhone.trim() || customerEmail.trim() || customerGender || specialRequests.trim()
      || groupServiceId || peopleEdited || referringCustomerName)
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
    setTimeText(format12h(t));
    setDragMinutes(s.dragMinutes || 0);
    if (s.colType === 'therapist' && s.colId) setSelectedTherapistIds([s.colId]);
    if (s.colType === 'room' && s.colId) { setRoomId(s.colId); setGroupRoomId(s.colId); }
    // The retargeted slot is the new baseline for "did the user change the therapist/room?"
    initialDraftRef.current = {
      date: s.day,
      time: t,
      therapist: s.colType === 'therapist' && s.colId ? s.colId : initialDraftRef.current.therapist,
      room: s.colType === 'room' && s.colId ? s.colId : initialDraftRef.current.room,
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
  const disabledReason = submitting ? '' : blockOverlapMsg
    ? (/^Overlaps '(Transferred|Visiting)/.test(blockOverlapMsg) ? 'Therapist unavailable' : 'Overlaps a block')
    : bookingMode === 'group'
      ? (groupValid ? '' : 'Complete the group details')
      : !serviceId ? 'Pick a service' : !customerName.trim() ? 'Enter the customer name' : !customerPhone.replace(/\D/g, '') ? 'Enter the customer phone' : '';
  const createDisabled = submitting || !!blockOverlapMsg || (bookingMode === 'group' ? !groupValid : (!serviceId || !customerName.trim() || !customerPhone.replace(/\D/g, '')));
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
    <div key="actions" className="flex items-center gap-3">
      <p className="flex-1 min-w-0 text-xs text-text-secondary" aria-live="polite">{createDisabled ? disabledReason : ''}</p>
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
        {submitting ? 'Creating...' : bookingMode === 'group' ? `Create ${peopleCount} bookings` : 'Create booking'}
      </button>
    </div>
  );

  // Neutral summary row: date + time (the therapist is chosen in the checklist below).
  const [dateOpen, setDateOpen] = useState(false);
  const dateRef = useRef(null);
  useEffect(() => {
    if (!dateOpen) return undefined;
    const onDown = (e) => { if (dateRef.current && !dateRef.current.contains(e.target)) setDateOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setDateOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [dateOpen]);
  const dateLabel = bookingDate
    ? new Date(`${bookingDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
    : 'Pick a date';
  const summaryRow = (
    <div className="grid grid-cols-2 gap-2">
      <div className="relative" ref={dateRef}>
        <button
          type="button"
          onClick={() => setDateOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={dateOpen}
          className="w-full h-9 pl-8 pr-2 flex items-center text-[13px] font-body text-text-primary bg-surface border border-border rounded-spa hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-left"
        >
          <Icon name="Calendar" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <span className="truncate">{dateLabel}</span>
        </button>
        {dateOpen && (
          <div className="absolute left-0 top-full mt-1 bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown p-3">
            <MiniMonthCalendar
              selectedDate={bookingDate || todayStr()}
              onDateSelect={(d) => { setBookingDate(d); setDateOpen(false); }}
            />
          </div>
        )}
      </div>
      <div className="relative" ref={timeDropdownRef}>
        <Icon name="Clock" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          aria-label="Time"
          value={timeText}
          onChange={(e) => {
            // Let the field reflect whatever is typed; commit to bookingTime only once it parses to a valid time.
            const raw = e.target.value;
            setTimeText(raw);
            setBookingTime(parseTimeInput(raw) ?? '');
          }}
          onFocus={(e) => { e.target.select(); setTimeDropdownOpen(true); }}
          onBlur={() => { setTimeText(bookingTime ? format12h(bookingTime) : ''); }}
          placeholder="--:--"
          autoComplete="off"
          className="w-full h-9 pl-8 pr-2 text-[13px] font-body text-text-primary bg-surface border border-border rounded-spa focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        {timeDropdownOpen && (
          <div
            ref={timeListRef}
            className="absolute top-full left-0 mt-1 w-28 max-h-48 overflow-y-auto bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown"
          >
            {timeOptions.map((t) => (
              <button
                key={t}
                type="button"
                data-selected={t === bookingTime}
                onClick={() => { setBookingTime(t); setTimeText(format12h(t)); setTimeDropdownOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-[13px] font-body cursor-pointer hover:bg-background ${t === bookingTime ? 'bg-background font-body-medium text-text-primary' : 'text-text-primary'}`}
              >
                {format12h(t)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <SidePanel isOpen={isOpen} title="New booking" onClose={requestClose} footer={footerNode}>
      <form id="quick-create-form" onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
        {summaryRow}

        <BlockOverlapWarning message={blockOverlapMsg} />

            {/* Booking mode: Individual | Group */}
            <div className="grid grid-cols-2 gap-0.5 p-0.5 h-9 bg-background border border-border rounded-spa">
              {[['individual', 'Individual'], ['group', 'Group']].map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setBookingMode(val)}
                  className={`px-3 text-[13px] font-body font-body-medium rounded-[4px] transition-colors ${
                    bookingMode === val
                      ? 'bg-primary text-white'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {bookingMode === 'individual' && (
            <>
            {/* Service */}
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Service <span className="text-error">*</span>
              </label>
              {servicesLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                  <span className="text-sm text-text-secondary">Loading services...</span>
                </div>
              ) : (
                <CustomSelect
                  value={serviceId}
                  onChange={(val) => setServiceId(val)}
                  options={[
                    { value: '', label: 'Select a service' },
                    ...(services || []).map((s) => ({
                      value: s.id,
                      label: `${s.name} — ${s.duration_minutes}min — Rs.${s.effective_price_npr ?? s.price_npr}`,
                    })),
                  ]}
                  placeholder="Select a service"
                  size="md"
                  searchable
                />
              )}
            </div>

            {/* Room */}
            {rooms && rooms.length > 0 && (
              <div>
                <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                  Room
                </label>
                <CustomSelect
                  value={roomId}
                  onChange={(val) => {
                    const room = (rooms || []).find(r => r.id === val);
                    if (room) {
                      const capacity = getRoomCapacity(room);
                      const used = busyResources.roomBookingCounts.get(val) || 0;
                      if (used >= capacity) return; // fully packed, block selection
                    }
                    setRoomId(val);
                  }}
                  options={[
                    { value: '', label: 'No room' },
                    ...(rooms || []).map((r) => {
                      const capacity = getRoomCapacity(r);
                      const used = busyResources.roomBookingCounts.get(r.id) || 0;
                      const remaining = capacity - used;
                      const amenityStr = r.amenities?.join(', ') || '';
                      const isFull = used >= capacity;

                      let statusLabel;
                      if (isFull) {
                        statusLabel = <span className="text-error font-bold">— Unavailable</span>;
                      } else if (used > 0 && capacity > 1) {
                        statusLabel = <span className="text-warning font-bold">— {remaining} left</span>;
                      } else if (used > 0) {
                        statusLabel = <span className="text-warning font-bold">— Allocated</span>;
                      }

                      return {
                        value: r.id,
                        label: (
                          <>
                            {r.name}
                            {amenityStr && <span className="text-text-secondary"> ({amenityStr})</span>}
                            {statusLabel && <> {statusLabel}</>}
                          </>
                        ),
                        searchLabel: r.name,
                        disabled: isFull,
                      };
                    }),
                  ]}
                  placeholder="No room"
                  size="md"
                  searchable
                />
              </div>
            )}

            {/* Therapist(s) */}
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Therapist{selectedTherapistIds.length > 1 ? 's' : ''}
                {selectedTherapistIds.length > 0 && (
                  <span className="ml-2 text-xs text-text-secondary font-normal">({selectedTherapistIds.length} selected)</span>
                )}
              </label>
              <div className="border border-border rounded-spa bg-background overflow-hidden">
                <div className="relative px-2 pt-2">
                  <Icon name="Search" size={14} className="absolute left-4 top-1/2 mt-1 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="text"
                    value={therapistSearch}
                    onChange={(e) => setTherapistSearch(e.target.value)}
                    placeholder="Search therapists..."
                    className="w-full pl-7 pr-3 py-1.5 bg-surface border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="space-y-1 max-h-[140px] overflow-y-auto p-2">
                  {(() => {
                    // Selected therapists are pinned to the top and always listed (even when the list filter, e.g.
                    // "service staff only", would otherwise hide the therapist whose column was clicked).
                    const pool = [...(therapists || [])];
                    selectedTherapistIds.forEach((id) => {
                      if (!pool.some((d) => d.id === id)) {
                        const extra = (allTherapists || []).find((d) => d.id === id);
                        if (extra) pool.push(extra);
                      }
                    });
                    const sel = (id) => (selectedTherapistIds.includes(id) ? 0 : 1);
                    return pool
                      .filter(t => sel(t.id) === 0 || !therapistSearch.trim() || (t.full_name || t.name).toLowerCase().includes(therapistSearch.toLowerCase()))
                      .sort((a, b) => sel(a.id) - sel(b.id));
                  })()
                    .map((t) => {
                      const isBusy = busyResources.therapistIds.has(t.id);
                      const isChecked = selectedTherapistIds.includes(t.id);
                      const name = t.full_name || t.name;
                      return (
                        <label key={t.id} className={`flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer hover:bg-primary/5 ${isChecked ? 'bg-primary/5' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedTherapistIds(prev => [...prev, t.id]);
                              } else {
                                setSelectedTherapistIds(prev => prev.filter(id => id !== t.id));
                              }
                            }}
                            className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                          />
                          <span className="font-body text-sm text-text-primary truncate">
                            {name}
                            {isBusy && <span className="text-warning font-bold"> — Assigned</span>}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>

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
                        <CustomSelect
                          value={therapistRoomOverrides[tid] || ''}
                          onChange={(val) => setTherapistRoomOverrides((prev) => ({ ...prev, [tid]: val }))}
                          options={[{ value: '', label: 'Same room as above' }, ...(rooms || []).map((r) => ({ value: r.id, label: r.name }))]}
                          placeholder="Same room as above"
                          size="sm"
                          className="flex-1"
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="text" value={companionName} onChange={(e) => setCompanionName(e.target.value)} placeholder="Companion's name (optional)"
                    className="w-full h-10 px-3 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                  <input type="tel" value={companionPhone} onChange={(e) => setCompanionPhone(e.target.value)} placeholder="Companion's phone (optional)"
                    className="w-full h-10 px-3 text-[13px] border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                </div>
              </div>
            )}

            {/* Customer name */}
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Customer Name <span className="text-error">*</span>
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
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Phone <span className="text-error">*</span>
              </label>
              <div className="flex">
                <CountryCodeSelect value={customerCountryCode} onChange={setCustomerCountryCode} />
                <CustomerAutocomplete
                  value={customerPhone}
                  onChange={handleCustomerPhoneChange}
                  onSelect={handleCustomerSelect}
                  onBlur={() => checkPreviousDue(`${customerCountryCode}${customerPhone.replace(/\D/g, '')}`)}
                  branchId={branchId}
                  searchBy="phone"
                  required
                  inputClassName="flex-1 px-3 py-2 text-sm border border-border rounded-r-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            {previousDue && (
              <div className="flex items-start gap-2 p-3 bg-warning/5 border border-warning/20 rounded-spa">
                <Icon name="AlertTriangle" size={14} className="text-warning flex-shrink-0 mt-0.5" />
                <p className="font-body font-body-normal text-sm text-warning">
                  <span className="font-body-medium">{customerName.trim() || 'This customer'}</span> has an outstanding
                  balance — NPR {previousDue.totalDue.toLocaleString('en-IN')} across {previousDue.bookingCount} earlier
                  visit{previousDue.bookingCount > 1 ? 's' : ''}.
                  {previousDue.collectableDue > 0 && <> You'll be able to collect NPR {previousDue.collectableDue.toLocaleString('en-IN')} together with this
                  booking's payment.</>}
                  {previousDue.lockedDue > 0 && <> NPR {previousDue.lockedDue.toLocaleString('en-IN')} on closed days can’t be collected here.</>}
                </p>
              </div>
            )}

            {/* Email */}
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

            {/* Gender */}
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
            </>
            )}

            {bookingMode === 'group' && (
            <>
            {/* Couple | Separate */}
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Group type
              </label>
              <div className="flex gap-2">
                {[['couple', 'Couple'], ['separate', 'Separate']].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setGroupType(val)}
                    className={`px-4 py-2 text-sm border rounded-spa transition-colors ${
                      groupType === val
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border bg-surface text-text-secondary hover:bg-background'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {groupType === 'separate' && (
                <div className="flex items-center gap-3 mt-2.5">
                  <span className="text-sm text-text-secondary whitespace-nowrap">How many people?</span>
                  <div className="relative w-24" ref={countDropdownRef}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={countText}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '');
                        setCountText(raw);
                        const n = parseInt(raw, 10);
                        if (!Number.isNaN(n) && n >= 2 && n <= 20) setSeparateCount(n);
                      }}
                      onFocus={(e) => { e.target.select(); setCountDropdownOpen(true); }}
                      onBlur={() => commitCount(countText)}
                      className="w-full h-10 pl-3 pr-8 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setCountDropdownOpen((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-primary transition-colors"
                    >
                      <Icon name="ChevronDown" size={14} />
                    </button>
                    {countDropdownOpen && (
                      <div className="absolute top-full left-0 mt-1 w-full max-h-48 overflow-y-auto bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown">
                        {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => { commitCount(String(n)); setCountDropdownOpen(false); }}
                            className={`w-full text-left px-3 py-1.5 text-sm font-body cursor-pointer hover:bg-primary/10 ${n === separateCount ? 'bg-primary/10 font-body-medium text-primary' : 'text-text-primary'}`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Same | Different service */}
            <div>
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Service for the group
                <span className="text-error"> *</span>
              </label>
              <div className="flex gap-2">
                {[['same', 'Same service'], ['different', 'Different services']].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setServiceMode(val)}
                    className={`px-4 py-2 text-sm border rounded-spa transition-colors ${
                      serviceMode === val
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border bg-surface text-text-secondary hover:bg-background'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {serviceMode === 'same' && (
                <div className="mt-2">
                  <CustomSelect
                    value={groupServiceId}
                    onChange={(val) => setGroupServiceId(val)}
                    options={[
                      { value: '', label: <>Select a service <span className="text-error">*</span></>, searchLabel: 'Select a service' },
                      ...groupServices.map((s) => ({
                        value: s.id,
                        label: `${s.name} — ${s.duration_minutes}min — Rs.${s.effective_price_npr ?? s.price_npr}`,
                      })),
                    ]}
                    placeholder={<>Select a service <span className="text-error">*</span></>}
                    size="md"
                    searchable
                  />
                </div>
              )}
            </div>

            {/* Shared room for couple */}
            {groupType === 'couple' && rooms && rooms.length > 0 && (
              <div>
                <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                  Room <span className="text-xs text-text-secondary font-normal">(shared — needs capacity 2)</span>
                </label>
                <CustomSelect
                  value={groupRoomId}
                  onChange={(val) => setGroupRoomId(val)}
                  options={[
                    { value: '', label: 'No room' },
                    ...(rooms || [])
                      .filter((r) => getRoomCapacity(r) >= 2)
                      .map((r) => {
                        const amenityStr = r.amenities?.join(', ') || '';
                        return {
                          value: r.id,
                          label: (
                            <>
                              {r.name}
                              {amenityStr && <span className="text-text-secondary"> ({amenityStr})</span>}
                            </>
                          ),
                          searchLabel: r.name,
                        };
                      }),
                  ]}
                  placeholder="No room"
                  size="md"
                  searchable
                />
              </div>
            )}

            {/* Per-person rows */}
            <div className="space-y-3">
              {people.map((p, idx) => (
                <div key={idx} className="border border-border rounded-spa p-3 space-y-2.5 bg-background/40">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-body-medium">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-body font-body-medium text-text-primary">
                      {idx === 0 ? 'Booking contact' : `Person ${idx + 1}`}
                      {idx === 0 && <span className="text-error"> *</span>}
                    </span>
                  </div>

                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => setPerson(idx, { name: e.target.value })}
                    placeholder={idx === 0 ? 'Name (required)' : 'Name (optional — uses booking contact if blank)'}
                    className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />

                  <div className="flex">
                    <CountryCodeSelect
                      value={p.countryCode || '+977'}
                      onChange={(code) => setPerson(idx, { countryCode: code })}
                    />
                    <input
                      type="tel"
                      value={p.phone}
                      onChange={(e) => setPerson(idx, { phone: e.target.value })}
                      placeholder={idx === 0 ? 'Phone (required)' : 'Phone (optional — uses booking contact if blank)'}
                      className="flex-1 px-3 py-2 text-sm border border-border rounded-r-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>

                  <input
                    type="email"
                    value={p.email}
                    onChange={(e) => setPerson(idx, { email: e.target.value })}
                    placeholder="Email (optional)"
                    className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />

                  <div className="flex gap-2">
                    {['Male', 'Female'].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setPerson(idx, { gender: p.gender === g.toLowerCase() ? '' : g.toLowerCase() })}
                        className={`px-4 py-1.5 text-sm border rounded-spa transition-colors ${
                          p.gender === g.toLowerCase()
                            ? 'border-primary bg-primary/10 text-primary font-medium'
                            : 'border-border bg-surface text-text-secondary hover:bg-background'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>

                  {serviceMode === 'different' && (
                    <div>
                      <label className="block text-xs font-body-medium text-text-secondary mb-1">
                        Service <span className="text-error">*</span>
                      </label>
                      <CustomSelect
                        value={p.serviceId}
                        onChange={(val) => setPerson(idx, { serviceId: val })}
                        options={[
                          { value: '', label: <>Select a service <span className="text-error">*</span></>, searchLabel: 'Select a service' },
                          ...groupServices.map((s) => ({
                            value: s.id,
                            label: `${s.name} — ${s.duration_minutes}min — Rs.${s.effective_price_npr ?? s.price_npr}`,
                          })),
                        ]}
                        placeholder={<>Select a service <span className="text-error">*</span></>}
                        size="md"
                        searchable
                      />
                    </div>
                  )}

                  <CustomSelect
                    value={p.therapistId}
                    onChange={(val) => setPerson(idx, { therapistId: val })}
                    options={[
                      { value: '', label: 'No therapist' },
                      ...(therapists || []).map((t) => ({
                        value: t.id,
                        label: t.full_name || t.name,
                      })),
                    ]}
                    placeholder="Therapist (optional)"
                    size="md"
                    searchable
                  />

                  {groupType === 'separate' && rooms && rooms.length > 0 && (
                    <CustomSelect
                      value={p.roomId}
                      onChange={(val) => setPerson(idx, { roomId: val })}
                      options={[
                        { value: '', label: 'No room' },
                        ...(rooms || []).map((r) => ({
                          value: r.id,
                          label: r.name,
                        })),
                      ]}
                      placeholder="No room"
                      size="md"
                      searchable
                    />
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
                <div>
                  <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                    Phone
                  </label>
                  <div className="flex">
                    <CountryCodeSelect value={referringCustomerCountryCode} onChange={setReferringCustomerCountryCode} />
                    <CustomerAutocomplete
                      value={referringCustomerPhone}
                      onChange={handleReferringPhoneChange}
                      onSelect={handleReferringCustomerSelect}
                      branchId={branchId}
                      searchBy="phone"
                      inputClassName="flex-1 px-3 py-2 text-sm border border-border rounded-r-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>
                </div>

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
              <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
                Special Requests
              </label>
              <textarea
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                placeholder="Any special requests or notes..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
            </div>

            {/* Error display */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-error/10 border border-error/20 rounded-spa">
                <Icon name="AlertCircle" size={16} className="text-error mt-0.5 flex-shrink-0" />
                <span className="font-body text-sm text-error">{error}</span>
              </div>
            )}
      </form>
    </SidePanel>
  );
};


export default QuickCreatePanel;
