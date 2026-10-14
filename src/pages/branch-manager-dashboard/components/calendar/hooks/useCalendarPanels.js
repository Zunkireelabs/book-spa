import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchServices,
  createBooking,
  fetchBookingById,
  cancelScheduledTransfer,
  revertStaffTransferNow,
  deleteBlock,
  updateBlock,
} from '../../../../../services/api';
import { transformBooking } from '../../../../../services/bookingTransformers';
import { findBlockOverlap, describeBlockOverlap } from '../../../../../utils/blockOverlap';
import { toKathmanduParts, formatTimeFromSlot } from '../calendarDates';
import { isCheckedOutBlockedSlot, DEFAULT_SLOT_MINUTES } from '../calendarSlots';

// Panel routing for the calendar: which panel is open (booking details, quick-create, block / transfer forms), the
// dirty-guard refs and open/switch/close helpers, the empty-slot / drag-to-create / new-booking entry points, the
// rebook "pick and place" mode, and the create / block / transfer-cancel actions those panels trigger.
export function useCalendarPanels({ branchId, currentDate, calendarData, refreshCalendar, blocksAvailable, showToast, gridRef }) {
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [transferCancelRequest, setTransferCancelRequest] = useState(null);   // { kind: 'scheduled'|'active', col }
  // Block / transfer forms live in the docked SidePanel (one panel at a time, like quick-create and booking details).
  const blockPanelOpen = !!(addBlockSlot || editingBlock || transferModalTarget || editingTransferTherapist);
  const blockPanelOpenRef = useRef(false);
  blockPanelOpenRef.current = blockPanelOpen;
  const blockGuardRef = useRef(null);
  const [blockRetarget, setBlockRetarget] = useState(null); // { slot, nonce } — empty-slot click while a block form is open
  const closeBlockPanels = useCallback(() => {
    setAddBlockSlot(null); setEditingBlock(null); setTransferModalTarget(null); setEditingTransferTherapist(null); setBlockRetarget(null);
  }, []);
  const [servicesCache, setServicesCache] = useState(null);
  const [servicesLoading, setServicesLoading] = useState(false);

  // Rebook "pick and place" mode
  // Shape: { booking, customerName, customerPhone, serviceId, serviceName, duration }
  const [rebookSource, setRebookSource] = useState(null);
  const [rebookFallback, setRebookFallback] = useState(false);

  // Rebook floating card — mouse tracking
  const rebookCardRef = useRef(null);
  const rebookOverGrid = useRef(false);

  useEffect(() => {
    if (!rebookSource) return;

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
    closeBlockPanels();
    setQuickCreateSlot(slotInfo);
    if (!servicesCache && !servicesLoading) {
      setServicesLoading(true);
      const result = await fetchServices(branchId);
      if (result.data) setServicesCache(result.data);
      setServicesLoading(false);
    }
  }, [servicesCache, servicesLoading, branchId, closeBlockPanels]);

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
      showToast('This therapist has already checked out for the day and is not bookable after their check-out time.', 'error');
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
        showToast('This therapist has already checked out for the day and is not bookable after their check-out time.', 'error');
        return;
      }
    }

    // Rebook mode — place booking at clicked slot
    if (rebookSource) {
      // Capture and immediately clear to prevent double-click duplicates
      const source = rebookSource;
      setRebookSource(null);

      const startTime = `${String(slotInfo.hour).padStart(2, '0')}:${String(slotInfo.minute).padStart(2, '0')}`;
      const therapistId = slotInfo.colType === 'therapist' ? slotInfo.colId : null;
      const roomId = slotInfo.colType === 'room' ? slotInfo.colId : null;
      const result = await createBooking({
        branchId,
        serviceId: source.serviceId,
        date: slotInfo.day,
        startTime,
        customerName: source.customerName,
        customerPhone: source.customerPhone,
        therapistId,
        roomId,
      });
      if (result.error) {
        showToast(result.error.message || 'Failed to rebook.', 'error');
        // Restore rebook mode on failure so user can retry
        setRebookSource(source);
      } else {
        showToast('Rebooked successfully — payment will be collected at the new appointment.');
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
    setChoiceMenuSlot(slotInfo);
  }, [rebookSource, branchId, refreshCalendar, calendarData, blocksAvailable, openQuickCreateForSlot, quickCreateSlot, modalOpen, addBlockSlot, editingBlock, transferModalTarget, editingTransferTherapist]);

  // Transfers: cancel a scheduled transfer / bring an active one back now, via an in-app confirm.
  const handleConfirmTransferCancel = useCallback(async () => {
    const req = transferCancelRequest;
    setTransferCancelRequest(null);
    if (!req) return;
    const result = req.kind === 'scheduled'
      ? await cancelScheduledTransfer(req.col.scheduledTransfer.id)
      : await revertStaffTransferNow({ transferId: req.col.transferId });
    if (result.error) {
      showToast(result.error.message || 'Failed to cancel transfer.', 'error');
      return;
    }
    showToast(req.kind === 'scheduled' ? 'Scheduled transfer cancelled.' : `${req.col.name} is back at this branch.`);
    refreshCalendar();
  }, [transferCancelRequest, refreshCalendar]);

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
    setRetargetRequest(null);
    setDraftGhost(null);
  }, []);

  // Auto-open the Quick Booking panel when the mobile FAB navigates here with
  // ?newBooking=1. Defaults to today + unassigned, no time. Param is stripped
  // afterwards so refresh/back-nav doesn't re-trigger the panel.
  useEffect(() => {
    if (!branchId) return;
    if (searchParams.get('newBooking') !== '1') return;
    handleEmptySlotClick({
      day: currentDate,
      colType: null,
      colId: null,
      colName: 'Unassigned',
    });
    const next = new URLSearchParams(searchParams);
    next.delete('newBooking');
    setSearchParams(next, { replace: true });
  }, [searchParams, branchId, currentDate, handleEmptySlotClick, setSearchParams]);

  const handleQuickCreateSubmit = useCallback(async (formData) => {
    if (!branchId) return 'Missing branch info.';
    const date = formData.bookingDate;
    const startTime = formData.bookingTime;
    if (!date || !startTime) return 'Date and time are required.';

    // Group booking: one booking per person, all sharing one booking_group_id.
    // Created sequentially so each room-capacity check sees prior group members
    // (matters for a Couple sharing one room, and Separate rooms running low).
    if (formData.mode === 'group') {
      const people = formData.people || [];
      if (people.length === 0) return 'Add at least one person.';
      const groupId = crypto.randomUUID();
      let created = 0;
      for (let i = 0; i < people.length; i++) {
        const person = people[i];
        const result = await createBooking({
          branchId,
          serviceId: person.serviceId,
          date,
          startTime,
          customerName: person.customerName,
          customerPhone: person.customerPhone,
          customerEmail: person.customerEmail,
          customerGender: person.customerGender,
          specialRequests: formData.specialRequests,
          therapistIds: person.therapistIds,
          roomId: person.roomId || undefined,
          bookingGroupId: groupId,
        });
        if (result.error) {
          const who = person.customerName || `person ${i + 1}`;
          const tail = created > 0 ? ` (${created} booking${created > 1 ? 's' : ''} already created)` : '';
          return `Failed for ${who}: ${result.error.message || 'could not create booking.'}${tail}`;
        }
        created++;
      }
      showToast(`${created} group bookings created successfully`);
      setQuickCreateSlot(null);
      refreshCalendar();
      return null;
    }

    const result = await createBooking({
      branchId,
      serviceId: formData.serviceId,
      date,
      startTime,
      customerName: formData.customerName,
      customerPhone: formData.customerPhone,
      customerEmail: formData.customerEmail,
      customerGender: formData.customerGender,
      specialRequests: formData.specialRequests,
      therapistIds: formData.therapistIds || (formData.therapistId ? [formData.therapistId] : null),
      // Zennly: bookings.room_id is NOT NULL, so "Any available" must let createBooking auto-assign a room ('none' would insert NULL).
      roomId: formData.roomId || undefined,
      therapistRoomOverrides: formData.therapistRoomOverrides,
      companionName: formData.companionName,
      companionPhone: formData.companionPhone,
      referringCustomerId: formData.referringCustomerId,
      referringRewardType: formData.referringRewardType,
      referringRewardAmount: formData.referringRewardAmount,
    });
    if (result.error) {
      return result.error.message || 'Failed to create booking.';
    }
    showToast('Booking created successfully');
    setQuickCreateSlot(null);
    refreshCalendar();
    return null;
  }, [branchId, refreshCalendar]);

  // ── Rebook "pick and place" handlers ───────────────────────

  const handleRebookStart = useCallback((booking) => {
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
  }, []);

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
    setSelectedBooking(transformBooking(result.data));
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
    if (!refreshed.error) setSelectedBooking(transformBooking(refreshed.data));
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
    transferCancelRequest, setTransferCancelRequest, blockPanelOpen, blockRetarget,
    servicesCache, servicesLoading, rebookSource, rebookFallback, rebookCardRef,
    openQuickCreateForSlot, handleNewBooking, handleDragCreate, handleEmptySlotClick, handleConfirmTransferCancel,
    handleDeleteManualBlock, handleResizeManualBlock, handleQuickCreateClose, handleQuickCreateSubmit, handleRebookStart,
    runThroughPanelGuard, openOnlyPanel, handleBookingClick, refreshOpenBooking, handleModalClose,
  };
}
