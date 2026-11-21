import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchServices,
  createBooking,
  rescheduleBookingAsNewBooking,
  fetchBookingById,
  deleteBlock,
  updateBlock,
  updateWaitlistEntry,
} from '../../../../../services/api';
import { transformBooking } from '../../../../../services/bookingTransformers';
import { isOverallBranch } from '../../../../../services/api';
import { findBlockOverlap, describeBlockOverlap } from '../../../../../utils/blockOverlap';
import { toKathmanduParts, formatTimeFromSlot } from '../calendarDates';
import { useBranch } from '../../../../../contexts/BranchContext';
import { useAvailabilityGuard } from '../../../../../contexts/AvailabilityOverrideContext';
import { friendlyError, isNetworkError, NETWORK_CHECK_CALENDAR_COPY } from '../../../../../utils/friendlyError';
import { submitQuickCreate } from '../quickCreateSubmit';
import { isCheckedOutBlockedSlot, DEFAULT_SLOT_MINUTES } from '../calendarSlots';
import { teamMemberLower } from '../../../../../utils/industryTerms';

// Panel routing for the calendar: which panel is open (booking details, quick-create, block / transfer forms), the
// dirty-guard refs and open/switch/close helpers, the empty-slot / drag-to-create / new-booking entry points, the
// rebook "pick and place" mode, and the create / block / transfer-cancel actions those panels trigger.
export function useCalendarPanels({ branchId, currentDate, calendarData, refreshCalendar, blocksAvailable, showToast, gridRef, canViewCustomerDetails = true }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { guard } = useAvailabilityGuard();
  const { branches } = useBranch();
  const activeBranch = (branches || []).find((b) => b.id === branchId);

  // Modal state
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [previewBooking, setPreviewBooking] = useState(null); // calendar card data shown instantly while the full booking loads
  // Guards: each open panel registers a function here; callers run "switch panel / open another booking" through it so
  // unsaved edits are never lost silently. Only one panel (booking details OR quick-create) is open at a time.
  const quickGuardRef = useRef(null);
  const bookingGuardRef = useRef(null);
  const modalOpenRef = useRef(false);
  const previewBookingRef = useRef(null);
  const quickCreateSlotRef = useRef(null);

  // Quick-create panel state
  const [quickCreateSlot, setQuickCreateSlot] = useState(null);
  modalOpenRef.current = modalOpen;
  previewBookingRef.current = previewBooking;
  quickCreateSlotRef.current = quickCreateSlot;
  const [retargetRequest, setRetargetRequest] = useState(null); // { slot, nonce }: click-to-retarget while the panel is open
  const [draftGhost, setDraftGhost] = useState(null);           // live draft reported by the panel, drawn on the grid

  // Manual blocks + empty-slot choice menu
  const [choiceMenuSlot, setChoiceMenuSlot] = useState(null);
  const [addBlockSlot, setAddBlockSlot] = useState(null);
  const [editingBlock, setEditingBlock] = useState(null); // { blockId, day }
  const [blockDeleteRequest, setBlockDeleteRequest] = useState(null); // { blockId, day, seriesId, description }
  const lastBlockWasRoomOnly = useRef(false);
  const [transferModalTarget, setTransferModalTarget] = useState(null);   // create (from empty-slot menu)
  const [editingTransferTherapist, setEditingTransferTherapist] = useState(null); // manage (header badge / shading)
  // Block / transfer forms live in the docked SidePanel (one panel at a time, like quick-create and booking details).
  const blockPanelOpen = !!(addBlockSlot || editingBlock || transferModalTarget || editingTransferTherapist);
  const blockPanelOpenRef = useRef(false);
  blockPanelOpenRef.current = blockPanelOpen;
  const blockGuardRef = useRef(null);
  const [blockRetarget, setBlockRetarget] = useState(null); // { slot, nonce } — empty-slot click while a block form is open
  const closeBlockPanels = useCallback(() => {
    setAddBlockSlot(null); setEditingBlock(null); setTransferModalTarget(null); setEditingTransferTherapist(null); setBlockRetarget(null);
  }, []);
  // Which waitlist entry (if any) the open quick-create panel is converting; it flips to 'booked' only once the booking saves.
  const [bookingWaitlistEntryId, setBookingWaitlistEntryId] = useState(null);
  // Remembers the choice on this device (collapsed by default).
  const [waitlistCollapsed, setWaitlistCollapsedRaw] = useState(() => {
    try { return localStorage.getItem('calendar.waitlistCollapsed') !== '0'; } catch { return true; }
  });
  const setWaitlistCollapsed = useCallback((next) => {
    setWaitlistCollapsedRaw((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      try { localStorage.setItem('calendar.waitlistCollapsed', v ? '1' : '0'); } catch { /* private mode: not remembered */ }
      return v;
    });
  }, []);
  const [waitlistRefreshToken, setWaitlistRefreshToken] = useState(0);
  const [servicesCache, setServicesCache] = useState(null);
  const [servicesLoading, setServicesLoading] = useState(false);

  // Rebook "pick and place" mode
  // Shape: { booking, customerName, customerPhone, serviceId, serviceName, duration }
  const [rebookSource, setRebookSource] = useState(null);
  const [rebookFallback, setRebookFallback] = useState(false);
  // A reschedule RPC is in flight: pick mode stays up (with a spinner on the card) and slot clicks / Escape are ignored until it answers.
  const [reschedulePending, setReschedulePending] = useState(false);
  const reschedulePendingRef = useRef(false);
  const lastMouseRef = useRef(null);
  useEffect(() => {
    const track = (e) => { lastMouseRef.current = { x: e.clientX, y: e.clientY }; };
    document.addEventListener('mousemove', track);
    return () => document.removeEventListener('mousemove', track);
  }, []);

  // Rebook floating card — mouse tracking
  const rebookCardRef = useRef(null);
  const rebookOverGrid = useRef(false);

  useEffect(() => {
    if (!rebookSource) return;

    // Put the card under the cursor straight away (also when pick mode is restored after a failed placement),
    // instead of leaving it parked off-screen until the mouse next moves.
    const parked = lastMouseRef.current;
    if (parked && rebookCardRef.current) {
      rebookCardRef.current.style.left = `${parked.x + 12}px`;
      rebookCardRef.current.style.top = `${parked.y - 20}px`;
      rebookCardRef.current.style.opacity = '0.95';
    }

    const handleMouseMove = (e) => {
      const card = rebookCardRef.current;
      if (!card) return;

      // Check if cursor is over the calendar grid
      const grid = gridRef.current;
      if (grid) {
        const rect = grid.getBoundingClientRect();
        const isOver = e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
        rebookOverGrid.current = isOver;
        card.style.opacity = isOver ? '0.95' : '0.5';
      }

      card.style.left = `${e.clientX + 12}px`;
      card.style.top = `${e.clientY - 20}px`;
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && rebookSource && !e.defaultPrevented) {
        if (reschedulePendingRef.current) return; // the move is already being saved
        if (rebookSource.isReschedule) {
          // No inline fallback form for Reschedule: leave pick mode and bring the booking panel back.
          setSelectedBooking(rebookSource.booking);
          setModalOpen(true);
          setRebookSource(null);
          return;
        }
        // Reopen modal with rebook inline form
        setSelectedBooking(rebookSource.booking);
        setModalOpen(true);
        setRebookFallback(true);
        setRebookSource(null);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [rebookSource]);

  // ── Quick-create handlers ──────────────────────────────────

  // "Add booking" choice — opens the quick-create panel at the slot (the previous direct behaviour).
  const openQuickCreateForSlot = useCallback(async (slotInfo) => {
    // Overall (all branches) is read-only for bookings: there is no single branch to create in. Every create path ends here.
    if (isOverallBranch(branchId)) return;
    // B7: an inactive location takes no new appointments (the database refuses too, migration-385); it stays viewable.
    if (activeBranch && activeBranch.is_active === false) {
      showToast('This location is inactive, so it cannot take new appointments. Reactivate it in Settings → Locations.', 'error');
      return;
    }
    closeBlockPanels();
    setQuickCreateSlot(slotInfo);
    if (!servicesCache && !servicesLoading) {
      setServicesLoading(true);
      const result = await fetchServices(branchId);
      if (result.data) setServicesCache(result.data);
      setServicesLoading(false);
    }
  }, [servicesCache, servicesLoading, branchId, closeBlockPanels, activeBranch, showToast]);

  // "Book in" from the waitlist panel: opens the normal quick-create form prefilled with what the person asked for. Staff still
  // pick the real slot / time / staff. A restricted account (can_view_customer_details = false) only holds MASKED name/phone, so
  // that text is never typed into a write: a linked customer is resolved by id server-side (knownCustomerId), and the panel hides
  // "Book in" for a walk-in entry with no customer id.
  const handleBookInFromWaitlist = useCallback((entry) => {
    setBookingWaitlistEntryId(entry.id);
    openQuickCreateForSlot({
      day: entry.preferred_date || currentDate,
      hour: entry.preferred_time ? parseInt(entry.preferred_time.slice(0, 2), 10) : undefined,
      minute: entry.preferred_time ? parseInt(entry.preferred_time.slice(3, 5), 10) : undefined,
      colType: entry.preferred_therapist_id ? 'therapist' : null,
      colId: entry.preferred_therapist_id || null,
      defaultServiceId: entry.service_id,
      defaultCustomerName: entry.customer_name,
      defaultCustomerPhone: canViewCustomerDetails && entry.customer_phone ? entry.customer_phone.replace(/^\+\d{1,3}/, '') : '',
      defaultCustomerCountryCode: canViewCustomerDetails ? (entry.customer_phone?.match(/^\+\d{1,3}/)?.[0] || '+977') : '+977',
      defaultCustomerId: entry.customer_id || null,
    });
  }, [openQuickCreateForSlot, currentDate, canViewCustomerDetails]);

  // Toolbar "New booking" / N: quick-create at the selected date, next free 10-min slot >= now (or the open time on other days), no column.
  const handleNewBooking = useCallback(() => {
    if (quickCreateSlotRef.current) return;
    const toMin = (t, d) => { const [h, m] = (t || d).split(':').map(Number); return h * 60 + (m || 0); };
    const openMin = toMin(calendarData?.branchHours?.openTime, '09:00');
    const lastMin = Math.max(openMin, toMin(calendarData?.branchHours?.closeTime, '21:00') - 10);
    let startMin = openMin;
    if (currentDate === toKathmanduParts(new Date().toISOString()).date) {
      const nowMin = toMin(toKathmanduParts(new Date().toISOString()).time, '00:00');
      startMin = Math.min(Math.max(Math.ceil(nowMin / 10) * 10, openMin), lastMin);
    }
    runThroughPanelGuard(() => {
      setModalOpen(false);
      setSelectedBooking(null);
      setPreviewBooking(null);
      setChoiceMenuSlot(null);
      openQuickCreateForSlot({ day: currentDate, colType: null, colId: null, hour: Math.floor(startMin / 60), minute: startMin % 60 });
    });
  }, [calendarData, currentDate, openQuickCreateForSlot]);

  // Drag-to-create release: same routing as a click on an empty slot, minus the choice menu (the user already chose "new booking").
  const handleDragCreate = useCallback((slotInfo) => {
    if (rebookSource) return;
    if (slotInfo.colType === 'therapist' && isCheckedOutBlockedSlot(calendarData?.checkedOutByTherapistAndDate, slotInfo.colId, slotInfo.day, slotInfo.hour, slotInfo.minute)) {
      showToast(`This ${teamMemberLower()} has already checked out for the day and is not bookable after their check-out time.`, 'error');
      return;
    }
    // Starting inside a block is already prevented (blocks swallow the press); a range that runs into one opens with the warning.
    if (quickCreateSlotRef.current) { setRetargetRequest({ slot: slotInfo, nonce: Date.now() }); return; }
    setChoiceMenuSlot(null);
    runThroughPanelGuard(() => {
      setModalOpen(false);
      setSelectedBooking(null);
      setPreviewBooking(null);
      openQuickCreateForSlot(slotInfo);
    });
  }, [rebookSource, calendarData, openQuickCreateForSlot]);

  const handleEmptySlotClick = useCallback(async (slotInfo) => {
    if (reschedulePendingRef.current) return; // a reschedule is being saved: ignore clicks until it answers
    // Refuse new bookings/blocks on any slot covered by a manual block.
    const manualBlock = findBlockOverlap([...(calendarData?.blockOccurrences || []), ...(calendarData?.transferOccurrences || [])], {
      date: slotInfo.day,
      startTime: formatTimeFromSlot(slotInfo.hour, slotInfo.minute),
      durationMinutes: DEFAULT_SLOT_MINUTES,
      therapistId: slotInfo.colType === 'therapist' ? slotInfo.colId : null,
      roomId: slotInfo.colType === 'room' ? slotInfo.colId : null,
    });
    if (manualBlock) {
      showToast(describeBlockOverlap(manualBlock), 'error');
      return;
    }

    if (slotInfo.colType === 'therapist') {
      if (isCheckedOutBlockedSlot(calendarData?.checkedOutByTherapistAndDate, slotInfo.colId, slotInfo.day, slotInfo.hour, slotInfo.minute)) {
        showToast(`This ${teamMemberLower()} has already checked out for the day and is not bookable after their check-out time.`, 'error');
        return;
      }
    }

    // Rebook mode — place booking at clicked slot
    if (rebookSource) {
      const source = rebookSource;
      const startTime = `${String(slotInfo.hour).padStart(2, '0')}:${String(slotInfo.minute).padStart(2, '0')}`;
      const therapistId = slotInfo.colType === 'therapist' ? slotInfo.colId : null;
      const roomId = slotInfo.colType === 'room' ? slotInfo.colId : null;

      if (source.isReschedule) {
        // Single DB transaction (reschedule_booking RPC): creates the new booking and cancels the original atomically, and
        // carries discount / special requests / companion / referral fields over, so there is no partial-failure state.
        // Pick mode stays up while it runs (spinner on the card, further clicks ignored); on failure it simply stays, so the
        // user can pick another slot.
        reschedulePendingRef.current = true;
        setReschedulePending(true);
        const result = await guard((overrideReason) => rescheduleBookingAsNewBooking({
          bookingId: source.originalBookingId,
          date: slotInfo.day,
          startTime,
          therapistId,
          roomId,
          reason: `Rescheduled to ${slotInfo.day} ${startTime}`,
          overrideReason,
        }));
        reschedulePendingRef.current = false;
        setReschedulePending(false);
        if (result.error) {
          if (isNetworkError(result.error)) {
            // The request may have committed before the connection dropped and a retry isn't safe: leave pick mode and let
            // the refreshed calendar show what actually happened.
            setRebookSource(null);
            showToast(NETWORK_CHECK_CALENDAR_COPY, 'error');
            refreshCalendar();
          } else {
            showToast(friendlyError(result.error, 'Failed to reschedule.'), 'error');
          }
        } else {
          setRebookSource(null);
          showToast('Booking rescheduled successfully.');
          refreshCalendar();
        }
        return;
      }

      // Capture and immediately clear to prevent double-click duplicates
      setRebookSource(null);

      // The source booking may be one of the historical bookings created before phone became required: silently resubmitting
      // it would fail the DB's INSERT trigger. Route through the normal editable form instead, pre-filled with what's known,
      // so staff supply a phone here rather than hitting an opaque DB error.
      if (!source.customerPhone || !source.customerPhone.trim()) {
        openQuickCreateForSlot({
          ...slotInfo,
          defaultCustomerName: source.customerName,
          defaultServiceId: source.serviceId,
        });
        return;
      }

      const result = await guard((overrideReason) => createBooking({
        branchId,
        serviceId: source.serviceId,
        date: slotInfo.day,
        startTime,
        customerName: source.customerName,
        customerPhone: source.customerPhone,
        therapistId,
        roomId,
        overrideReason,
      }));
      if (result.error) {
        if (isNetworkError(result.error)) {
          // Rebook isn't atomic: the insert may have committed before the connection dropped, so restoring pick mode would invite a
          // duplicate on retry. Leave pick mode and show the real state.
          showToast(NETWORK_CHECK_CALENDAR_COPY, 'error');
          refreshCalendar();
        } else {
          showToast(friendlyError(result.error, 'Failed to rebook.'), 'error');
          // Restore rebook mode on failure so user can retry
          setRebookSource(source);
        }
      } else {
        if (result.data?._therapistAssignmentWarning) {
          showToast(`Rebooked, but: ${result.data._therapistAssignmentWarning}`, 'error');
        } else {
          showToast('Rebooked successfully — payment will be collected at the new appointment.');
        }
        refreshCalendar();
      }
      return;
    }

    // Quick-create panel already open: move the draft to the clicked slot instead of opening the menu.
    if (quickCreateSlot) {
      setRetargetRequest({ slot: slotInfo, nonce: Date.now() });
      return;
    }

    // Add/Edit block panel open: the click moves the block's start / column. Transfer panels aren't retargetable.
    if (addBlockSlot || editingBlock) {
      setBlockRetarget({ slot: slotInfo, nonce: Date.now() });
      return;
    }
    if (transferModalTarget || editingTransferTherapist) return;

    // Booking panel open: clicking an empty slot switches to quick-create there (through the panel's dirty guard).
    if (modalOpen) {
      runThroughPanelGuard(() => {
        setModalOpen(false);
        setSelectedBooking(null);
        setPreviewBooking(null);
        openQuickCreateForSlot(slotInfo);
      });
      return;
    }

    // Normal flow — offer a choice (Add booking / Add block); with only one option, skip the menu.
    if (!blocksAvailable) {
      openQuickCreateForSlot(slotInfo);
      return;
    }
    // Overall is view-only for anything that creates data (booking, block, transfer): nothing to offer, so no menu.
    if (isOverallBranch(branchId)) return;
    setChoiceMenuSlot(slotInfo);
  }, [rebookSource, branchId, refreshCalendar, calendarData, blocksAvailable, openQuickCreateForSlot, quickCreateSlot, modalOpen, addBlockSlot, editingBlock, transferModalTarget, editingTransferTherapist, guard]);

  // Block management from the calendar overlay: resize, and delete (via the in-app scope dialog).
  const handleDeleteManualBlock = useCallback(async ({ blockId, day, scope = 'this' }) => {
    const result = await deleteBlock({ blockId, scope, occurrenceDate: day });
    if (result.error) {
      showToast(result.error.message || 'Failed to remove block.', 'error');
      return;
    }
    showToast(scope === 'series' ? 'Block series removed.' : 'Block removed.');
    refreshCalendar();
  }, [refreshCalendar]);

  const handleResizeManualBlock = useCallback(async ({ blockId, day, durationMinutes }) => {
    const result = await updateBlock({ blockId, scope: 'this', occurrenceDate: day, durationMinutes });
    if (result.error) {
      showToast(result.error.message || 'Failed to resize block.', 'error');
      return;
    }
    refreshCalendar();
  }, [refreshCalendar]);

  const handleQuickCreateClose = useCallback(() => {
    setQuickCreateSlot(null);
    setBookingWaitlistEntryId(null);
    setRetargetRequest(null);
    setDraftGhost(null);
  }, []);

  // Auto-open the Quick Booking panel when the mobile FAB navigates here with
  // ?newBooking=1. Defaults to today + unassigned, no time. Param is stripped
  // afterwards so refresh/back-nav doesn't re-trigger the panel.
  useEffect(() => {
    if (!branchId) return;
    if (searchParams.get('newBooking') !== '1') return;
    // The Bookings page's Free-now "Book" adds &bt=<therapistId>&btime=HH:MM: open quick-create on that therapist at that slot.
    const bt = searchParams.get('bt');
    const btime = searchParams.get('btime');
    if (bt && /^\d{2}:\d{2}$/.test(btime || '')) {
      const [hour, minute] = btime.split(':').map(Number);
      openQuickCreateForSlot({ day: currentDate, colType: 'therapist', colId: bt, hour, minute });
    } else {
      handleEmptySlotClick({
        day: currentDate,
        colType: null,
        colId: null,
        colName: 'Unassigned',
      });
    }
    const next = new URLSearchParams(searchParams);
    next.delete('newBooking');
    next.delete('bt');
    next.delete('btime');
    setSearchParams(next, { replace: true });
  }, [searchParams, branchId, currentDate, handleEmptySlotClick, openQuickCreateForSlot, setSearchParams]);

  const handleQuickCreateSubmit = useCallback(async (formData) => {
    const r = await submitQuickCreate({ formData, branchId, guard });
    if (r.error) return { message: r.error, code: r.code };
    showToast(r.toast.msg, r.toast.type);
    // The booking exists for real: flip the waitlist entry to 'booked'. Best-effort, a failure here never undoes the booking.
    if (bookingWaitlistEntryId && r.bookingId) {
      const w = await updateWaitlistEntry({ id: bookingWaitlistEntryId, status: 'booked', bookingId: r.bookingId });
      if (w.error) console.error('[Calendar] failed to flip waitlist entry to booked:', w.error.message);
      setBookingWaitlistEntryId(null);
      setWaitlistRefreshToken((v) => v + 1);
    }
    setQuickCreateSlot(null);
    refreshCalendar();
    return null;
  }, [branchId, refreshCalendar, guard, bookingWaitlistEntryId, showToast]);

  // ── Rebook "pick and place" handlers ───────────────────────

  const handleRebookStart = useCallback((booking) => {
    if (isOverallBranch(branchId)) return;
    setRebookSource({
      booking,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      serviceId: booking.serviceId,
      serviceName: booking.service,
      duration: booking.duration,
    });
    setModalOpen(false);
    setSelectedBooking(null);
  }, [branchId]);

  // "Reschedule": same pick-and-place as Rebook, but placing it runs the reschedule RPC (new booking + cancel the original).
  const handleRescheduleStart = useCallback((booking) => {
    if (isOverallBranch(branchId)) return;
    setRebookSource({
      booking,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      serviceId: booking.serviceId,
      serviceName: booking.service,
      duration: booking.duration,
      isReschedule: true,
      originalBookingId: booking.bookingId,
    });
    setModalOpen(false);
    setSelectedBooking(null);
  }, [branchId]);

  const handleRebookCancel = useCallback(() => setRebookSource(null), []);

  // ── Event click → modal ────────────────────────────────────

  const runThroughPanelGuard = (action) => {
    const guard = quickCreateSlotRef.current ? quickGuardRef.current
      : (modalOpenRef.current ? bookingGuardRef.current : (blockPanelOpenRef.current ? blockGuardRef.current : null));
    if (guard) guard(action); else action();
  };

  // Open a block/transfer form panel: closes quick-create and the booking panel first (the caller has already run the guard).
  const openOnlyPanel = (openFn) => {
    setQuickCreateSlot(null); setRetargetRequest(null); setDraftGhost(null);
    setModalOpen(false); setSelectedBooking(null); setPreviewBooking(null);
    setChoiceMenuSlot(null);
    closeBlockPanels();
    openFn();
  };

  const openBookingPanel = useCallback(async (booking) => {
    const bookingId = booking.bookingId || booking.id;
    if (!bookingId) return;

    // The panel opens instantly with the card's known data (skeleton for the rest); one panel at a time.
    closeBlockPanels();
    setQuickCreateSlot(null);
    setRetargetRequest(null);
    setDraftGhost(null);
    setSelectedBooking(null);
    setPreviewBooking(booking);
    setModalLoading(true);
    setModalOpen(true);

    const result = await fetchBookingById(bookingId);

    if (result.error) {
      setModalOpen(false);
      setModalLoading(false);
      setPreviewBooking(null);
      showToast(result.error.message || 'Failed to load booking.', 'error');
      return;
    }

    // Ignore a stale response if the user already clicked another booking.
    if (previewBookingRef.current && (previewBookingRef.current.bookingId || previewBookingRef.current.id) !== bookingId) return;
    // availabilityNote: the card's "why this booking breaks the availability rule" line, carried onto the fresh copy
    setSelectedBooking({ ...transformBooking(result.data), availabilityNote: booking.availabilityNote });
    setModalLoading(false);

    // Pre-fetch services for "Add Another Service" / edit mode
    if (!servicesCache && !servicesLoading) {
      setServicesLoading(true);
      const svcResult = await fetchServices(branchId);
      if (svcResult.data) setServicesCache(svcResult.data);
      setServicesLoading(false);
    }
  }, [servicesCache, servicesLoading, branchId]);

  // Clicking a card: same booking → no-op; otherwise switch (through the open panel's dirty guard).
  const handleBookingClick = useCallback((booking) => {
    const bookingId = booking.bookingId || booking.id;
    if (modalOpenRef.current && previewBookingRef.current && (previewBookingRef.current.bookingId || previewBookingRef.current.id) === bookingId) return;
    runThroughPanelGuard(() => openBookingPanel(booking));
  }, [openBookingPanel]);

  // Re-fetch the open booking after an in-place panel action (status change).
  const refreshOpenBooking = useCallback(async (bookingId) => {
    const refreshed = await fetchBookingById(bookingId);
    if (!refreshed.error) setSelectedBooking((prev) => ({ ...transformBooking(refreshed.data), availabilityNote: prev?.availabilityNote }));
    refreshCalendar();
  }, [refreshCalendar]);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setSelectedBooking(null);
    setPreviewBooking(null);
    setRebookFallback(false);
    refreshCalendar();
  }, [refreshCalendar]);

  return {
    selectedBooking, setSelectedBooking, modalOpen, previewBooking, quickGuardRef, bookingGuardRef, blockGuardRef,
    quickCreateSlot, retargetRequest, draftGhost, setDraftGhost,
    choiceMenuSlot, setChoiceMenuSlot, addBlockSlot, setAddBlockSlot, editingBlock, setEditingBlock,
    blockDeleteRequest, setBlockDeleteRequest, lastBlockWasRoomOnly,
    transferModalTarget, setTransferModalTarget, editingTransferTherapist, setEditingTransferTherapist,
    blockPanelOpen, blockRetarget,
    servicesCache, servicesLoading, rebookSource, rebookFallback, rebookCardRef, reschedulePending,
    bookingWaitlistEntryId, waitlistCollapsed, setWaitlistCollapsed, waitlistRefreshToken, handleBookInFromWaitlist,
    openQuickCreateForSlot, handleNewBooking, handleDragCreate, handleEmptySlotClick,
    handleDeleteManualBlock, handleResizeManualBlock, handleQuickCreateClose, handleQuickCreateSubmit, handleRebookStart, handleRescheduleStart,
    runThroughPanelGuard, openOnlyPanel, handleBookingClick, refreshOpenBooking, handleModalClose,
  };
}
