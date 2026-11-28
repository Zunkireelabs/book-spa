import React, { useState, useMemo, useRef, useEffect } from 'react';
import { refreshLight } from './refreshLight';
import { buildVisitIndex, visitDayInfo } from './sameVisit';
import { visitKey } from '../../../../utils/visit';
import { viewerAccess } from 'services/dataMasking';
import UnlinkedLoginNotice from 'components/ui/UnlinkedLoginNotice';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DndContext, pointerWithin } from '@dnd-kit/core';
import Icon from '../../../../components/AppIcon';
import BookingActionModal from '../../../../components/ui/BookingActionModal';
import EmptySlotChoiceMenu from './EmptySlotChoiceMenu';
import AddBlockModal from './AddBlockModal';
import EditBlockModal from './EditBlockModal';
import BlockScopeDialog from './BlockScopeDialog';
import TransferFromCalendarModal from './TransferFromCalendarModal';
import TransferManagementModal from '../../../../components/ui/TransferManagementModal';
import CalendarGrid, { MIN_ZOOM, MAX_ZOOM, clampZoom } from './CalendarGrid';
import MonthGridView from './MonthGridView';
import PrintReportModal from './PrintReportModal';
import CalendarToolbar from './CalendarToolbar';
import DragPreviewOverlay from './DragPreviewOverlay';
import { useUse24h } from '../../../../hooks/useUse24h';
import ReassignConfirmDialog from './ReassignConfirmDialog';
import QuickCreatePanel from './QuickCreatePanel';
import MoveBookingDialog from '../../../../components/ui/MoveBookingDialog';
import { GuideNotice } from '../../../../components/ui/GuideCard';
import { describeError } from '../../../../utils/errorGuide';
import { useCalendarData } from './hooks/useCalendarData';
import { useCalendarDnd } from './hooks/useCalendarDnd';
import { useCalendarPanels } from './hooks/useCalendarPanels';
import { useCalendarShortcuts } from './hooks/useCalendarShortcuts';
import { useGoTodaySignal } from './calendarSignals';
import { useBookingActions } from './hooks/useBookingActions';
import { isOverallBranch, assignTherapist, extendBooking } from '../../../../services/api';
import { supabase } from '../../../../lib/supabase';
import { useAvailabilityGuard } from '../../../../contexts/AvailabilityOverrideContext';
import AssignFlow from './AssignFlow';
import { dayAssignCount } from '../../../../utils/unassignedList';
import { useAutoRefresh } from '../../../../hooks/useAutoRefresh';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { formatClockRange } from '../../../../utils/clockTime';
import { readUse24h } from '../../../../utils/clockPref';
import WaitlistPanel, { useWaitlistEntries } from './WaitlistPanel';
import { todayStr, addDays, addMonths, getStepDays } from './calendarDates';
import { staffWord } from '../../../../utils/industryTerms';
import { useViewportWidth, PHONE_MAX } from '../../../../hooks/useViewportWidth';
import { clampPhoneZoom } from './phoneCalendarLayout';
import { offStaffReasons } from '../../../../utils/staffFit';

// ── Component ────────────────────────────────────────────────

const OperationalCalendar = ({ branchId }) => {
  const { profile } = useAuth();
  const { orgSettings, enforceStaffAvailability, canExtend } = useOrg();
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  // Deep link from the Therapists list ("See on calendar"): ?view=calendar&therapist=<id> shows only that person's column.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusTherapistId = searchParams.get('therapist');
  const clearFocusTherapist = () => { const next = new URLSearchParams(searchParams); next.delete('therapist'); setSearchParams(next, { replace: true }); };
  const userRole = profile?.role || 'staff';
  // Restricted staff (can_view_customer_details = false) see masked customer details; managers/admins always see them.
  const canViewCustomerDetails = userRole === 'manager' || userRole === 'admin' || profile?.can_view_customer_details !== false;
  // Calendar settings (admin: ⋮ → Calendar settings): visible hours, interval, full-day view
  const hourFromSetting = (t, min, max) => {
    if (!t || typeof t !== 'string') return undefined;
    const h = parseInt(t.split(':')[0], 10);
    return Number.isInteger(h) && h >= min && h <= max ? h : undefined;
  };
  const calendarStartHour = hourFromSetting(orgSettings?.calendar_start_time, 0, 23);
  const calendarEndHour = hourFromSetting(orgSettings?.calendar_end_time, 1, 24);
  const calendarIntervalMinutes = [15, 30, 60].includes(orgSettings?.calendar_interval_minutes) ? orgSettings.calendar_interval_minutes : 30;
  const calendarShowFullDay = orgSettings?.calendar_show_full_day === true;
  // Industry-specific labels from auth context
  const industry = profile?.organizations?.industries;
  const ownOnly = viewerAccess(profile).ownOnly; // ZNLY-278: an own-only login sees only its own column (the data layer already returns just its own team member)
  const staffLabel = industry?.staff_label || 'Therapist';
  const staffLabelPlural = industry?.staff_label_plural || 'Therapists';
  const locationLabel = industry?.location_label || 'Room';
  const locationLabelPlural = industry?.location_label_plural || 'Rooms';
  const enableRooms = industry?.enable_rooms !== false;

  // View state
  // ?date=YYYY-MM-DD deep-links a day (the "falls outside" list's "Open in calendar").
  const [currentDate, setCurrentDate] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date') || '') ? searchParams.get('date') : todayStr()));
  const [viewMode, setViewMode] = useState('day'); // day | 4day | week | month
  const [printReportOpen, setPrintReportOpen] = useState(false);

  // Per-org, per-user client-side display preferences (never sent to the server): hide names/prices, 12h/24h, grid zoom.
  const prefKey = (name) => (profile ? `bookspa_calendar_${name}_${profile.org_id}_${profile.id}` : null);
  const readPref = (name, fallback) => { try { const k = prefKey(name); return k ? localStorage.getItem(k) : fallback; } catch { return fallback; } };
  const writePref = (name, value) => { try { const k = prefKey(name); if (k) localStorage.setItem(k, value); } catch { /* ignore */ } };
  const [hideSensitive, setHideSensitiveState] = useState(() => readPref('hide_sensitive', null) === '1');
  const setHideSensitive = (updater) => setHideSensitiveState((prev) => {
    const next = typeof updater === 'function' ? updater(prev) : updater;
    writePref('hide_sensitive', next ? '1' : '0');
    return next;
  });
  const [use24h, setUse24h] = useUse24h();
  const isPhoneView = useViewportWidth() <= PHONE_MAX;
  const [zoomSaved, setZoomScaleState] = useState(() => {
    const raw = parseFloat(readPref('zoom', null));
    return Number.isFinite(raw) ? clampZoom(raw) : 1;
  });
  // ZNLY-299: on a phone zoom only goes up (100% is the floor); a saved lower value reads as 100% there and is left alone for desktop.
  const zoomScale = isPhoneView ? clampPhoneZoom(zoomSaved) : zoomSaved;
  const minZoomNow = isPhoneView ? 1 : MIN_ZOOM;
  const setZoomScale = (updater) => setZoomScaleState((prev) => {
    const cur = isPhoneView ? clampPhoneZoom(prev) : prev;
    const next = Math.max(minZoomNow, clampZoom(typeof updater === 'function' ? updater(cur) : updater));
    writePref('zoom', String(next));
    return next;
  });
  // Default to staff view if rooms are disabled
  // The Group by choice is remembered per device (group_by pref), phone and desktop alike.
  const [columnMode, setColumnMode] = useState(() => (enableRooms && !viewerAccess(profile).ownOnly && readPref('group_by', null) === 'room' ? 'room' : 'therapist')); // therapist | room
  const setGroupBy = (mode) => { setColumnMode(mode); writePref('group_by', mode); };
  const [freezeUnassigned, setFreezeUnassigned] = useState(true);
  const [openTab, setOpenTab] = useState(null); // booking panel tab to open on (phone Unassigned bar -> team tab); cleared when the panel closes
  const [showServiceOnly, setShowServiceOnly] = useState(true);
  const [selectedPositions, setSelectedPositions] = useState([]); // empty = all
  const [hiddenStaffIds, setHiddenStaffIds] = useState([]); // people UNTICKED in the team filter; empty = everyone; ANDed with positions + service-staff
  const [tipOpen, setTipOpen] = useState(false);
  const [actionToast, setActionToast] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false); // ZNLY-299: the Assign list / staff step (phone sheet, desktop side panel)
  const [assignedToast, setAssignedToast] = useState(null); // { msg, undo } — "Assigned to <name> · Undo", 6s
  const assignedToastTimer = useRef(null);
  const { guard: assignGuard, canOverride } = useAvailabilityGuard();

  // Ref to the grid body for calculating time from cursor position
  const gridRef = useRef(null);

  // Multi-drag: ref to get selected bookings from CalendarGrid
  const getSelectedBookingsRef = useRef(() => []);

  // Refused drag / reschedule / resize: a floating ✦ card (or the calm system card), see GuideNotice.
  const [guideNotice, setGuideNotice] = useState(null);
  const showGuide = (error, extra, area) => setGuideNotice({
    area, card: describeError(error, { staffLabel, staffLabelPlural, hasRooms: (calendarData?.rooms || []).length > 0, ...extra }),
  });

  const showToast = (msg, type = 'success') => {
    setActionToast({ msg, type });
    setTimeout(() => setActionToast(null), 3000);
  };

  const showAssignedToast = (toast) => {
    clearTimeout(assignedToastTimer.current);
    setAssignedToast(toast);
    assignedToastTimer.current = setTimeout(() => setAssignedToast(null), 6000);
  };
  useEffect(() => () => clearTimeout(assignedToastTimer.current), []);
  // Scroll the calendar to a card and flash it (the grid re-renders after the refresh, so retry briefly).
  const flashBooking = (bookingId) => {
    let tries = 0;
    const tick = () => {
      const el = document.querySelector(`[data-booking-key="${bookingId}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        el.classList.add('ring-2', 'ring-primary');
        setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 2200);
      } else if (++tries < 12) setTimeout(tick, 250);
    };
    setTimeout(tick, 250);
  };


  const {
    calendarData, setCalendarData, error, attendanceMap, attendanceByTherapist, shiftsByTherapist, blocksAvailable, transfersAvailable,
    fetchData, refreshCalendar, handleTherapistReorder, handleRoomReorder, lastFetchStartedAtRef,
  } = useCalendarData({ branchId, currentDate, viewMode });

  // Available position options for filter (from service staff only)
  const calendarPositionOptions = useMemo(() => {
    if (!calendarData?.therapists) return [];
    const positions = new Set();
    calendarData.therapists.forEach(t => {
      if (t.is_service_staff !== false && t.position) {
        t.position.split('/').forEach(p => positions.add(p.trim()));
      }
    });
    return Array.from(positions).sort();
  }, [calendarData?.therapists]);

  // People the Team filter can pick: everyone the calendar would show before any position/team narrowing (not absent; service staff per the checkbox).
  const staffOptions = useMemo(() => {
    if (!calendarData?.therapists) return [];
    return calendarData.therapists
      .filter(t => attendanceMap[t.id] !== 'Absent' && (!showServiceOnly || t.is_service_staff !== false))
      .map(t => ({ id: t.id, name: t.name }));
  }, [calendarData?.therapists, attendanceMap, showServiceOnly]);

  // The people the calendar would show before team narrowing: staffOptions, further narrowed by any picked positions. Ticks, the lock and the button count are all measured against this.
  const teamUniverse = useMemo(() => {
    if (selectedPositions.length === 0) return staffOptions;
    const byId = new Map((calendarData?.therapists || []).map(t => [t.id, t]));
    return staffOptions.filter(p => { const t = byId.get(p.id); return t?.position && t.position.split('/').some(x => selectedPositions.includes(x.trim())); });
  }, [staffOptions, selectedPositions, calendarData?.therapists]);

  // Filter therapists for calendar display (hide absent/leave)
  const filteredTherapists = useMemo(() => {
    if (!calendarData?.therapists) return [];
    let list = calendarData.therapists;
    if (focusTherapistId) return list.filter(t => t.id === focusTherapistId);
    // Only absent staff are hidden; someone on leave keeps their column (purple shade, header "On leave") so the day's plan stays visible.
    list = list.filter(t => attendanceMap[t.id] !== 'Absent');
    if (showServiceOnly) {
      list = list.filter(t => t.is_service_staff !== false);
    }
    if (selectedPositions.length > 0) {
      list = list.filter(t => t.position && t.position.split('/').some(p => selectedPositions.includes(p.trim())));
    }
    if (hiddenStaffIds.length > 0) {
      list = list.filter(t => !hiddenStaffIds.includes(t.id));
    }
    return list;
  }, [calendarData?.therapists, showServiceOnly, selectedPositions, hiddenStaffIds, attendanceMap, currentDate, focusTherapistId]);

  // Absent / on-leave therapists (hidden from columns) for the toolbar "N away" summary
  const awayList = useMemo(() => {
    if (!calendarData?.therapists) return [];
    return Object.entries(attendanceMap)
      .map(([id, status]) => ({ id, status, name: calendarData.therapists.find(t => t.id === id)?.name }))
      .filter(a => a.name);
  }, [attendanceMap, calendarData?.therapists]);

  const {
    sensors, activeDragId, activeDragBooking, activeDragBlock, overSlotData, isRescheduling, pendingReassign, setPendingReassign,
    handleDragStart, handleDragMove, handleDragOver, handleDragEnd, handleDragCancel, handleConfirmReassign,
  } = useCalendarDnd({ calendarData, setCalendarData, columnMode, refreshCalendar, showToast, showGuide, gridRef, getSelectedBookingsRef });

  const {
    selectedBooking, setSelectedBooking, modalOpen, previewBooking, quickGuardRef, bookingGuardRef, blockGuardRef,
    quickCreateSlot, retargetRequest, draftGhost, setDraftGhost,
    choiceMenuSlot, setChoiceMenuSlot, addBlockSlot, setAddBlockSlot, editingBlock, setEditingBlock,
    blockDeleteRequest, setBlockDeleteRequest, lastBlockWasRoomOnly,
    transferModalTarget, setTransferModalTarget, editingTransferTherapist, setEditingTransferTherapist,
    blockPanelOpen, blockRetarget,
    servicesCache, servicesLoading, rebookSource, rebookCardRef, reschedulePending, visitMove, setVisitMove, handleRebookCancel,
    waitlistCollapsed, setWaitlistCollapsed, waitlistRefreshToken, handleBookInFromWaitlist,
    openQuickCreateForSlot, handleNewBooking, handleDragCreate, handleEmptySlotClick,
    handleDeleteManualBlock, handleResizeManualBlock, handleQuickCreateClose, handleQuickCreateBack, handleQuickCreateSubmit, handleAddServiceStart, handleEditFormStart, handleRebookStart, handleRescheduleStart,
    runThroughPanelGuard, openOnlyPanel, handleBookingClick, refreshOpenBooking, handleModalClose,
  } = useCalendarPanels({ branchId, currentDate, calendarData, refreshCalendar, blocksAvailable, showToast, showGuide, gridRef, canViewCustomerDetails });
  const waitlist = useWaitlistEntries(branchId, waitlistRefreshToken);
  const [waitlistSheetOpen, setWaitlistSheetOpen] = useState(false);

  const {
    handleStatusUpdate, handleAssignTherapist, handleBookingResize, handleEditBooking, handleApplyDiscount, handleRecordPayment, handleGroupPaymentRecorded,
  } = useBookingActions({ showToast, refreshCalendar, selectedBooking, setSelectedBooking, getSelectedBookingsRef, staffLabel, showGuide });

  // Auto-refresh every 60s. Paused while any modal/panel/drag/confirm is active
  // (the tab-hidden skip lives in the hook). fetchData swaps calendarData in place,
  // so scroll position, popovers and the hover label are untouched.
  const autoRefreshPaused = modalOpen || blockPanelOpen || !!activeDragId || isRescheduling || !!quickCreateSlot
    || !!pendingReassign || !!rebookSource || !!choiceMenuSlot || !!addBlockSlot || !!editingBlock || !!blockDeleteRequest
    || !!transferModalTarget || !!editingTransferTherapist;
  useEffect(() => { if (!modalOpen) setOpenTab(null); }, [modalOpen]);
  useAutoRefresh(refreshCalendar, { intervalMs: 60000, enabled: !!branchId && !autoRefreshPaused });

  // A booking changed on another device (or by a colleague): refresh the bookings only, debounced to one request per burst. While a
  // modal, panel or drag is open the refresh waits and runs once it closes (same rule as the auto-refresh above).
  const refreshCalendarRef = useRef(refreshCalendar);
  refreshCalendarRef.current = refreshCalendar;
  const realtimePausedRef = useRef(autoRefreshPaused);
  realtimePausedRef.current = autoRefreshPaused;
  const realtimeDirtyRef = useRef(false);
  useEffect(() => {
    if (!autoRefreshPaused && realtimeDirtyRef.current) { realtimeDirtyRef.current = false; refreshLight(refreshCalendarRef.current); }
  }, [autoRefreshPaused]);
  useEffect(() => {
    if (!branchId || isOverallBranch(branchId)) return undefined;
    let timer = null;
    let burstStart = null;
    const channel = supabase
      .channel(`calendar-bookings-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `branch_id=eq.${branchId}` }, () => {
        if (burstStart == null) burstStart = Date.now();
        clearTimeout(timer);
        timer = setTimeout(() => {
          const since = burstStart;
          burstStart = null;
          if (lastFetchStartedAtRef.current >= since) return; // a refresh already started after the change (e.g. our own edit): it has the new data
          if (realtimePausedRef.current) realtimeDirtyRef.current = true;
          else refreshLight(refreshCalendarRef.current);
        }, 1000);
      })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [branchId]);

  // ── Navigation ─────────────────────────────────────────────

  const overlapOccurrences = useMemo(() => [...(calendarData?.blockOccurrences || []), ...(calendarData?.transferOccurrences || [])], [calendarData]);
  const goToday = () => setCurrentDate(todayStr());
  const goPrev = () => setCurrentDate(viewMode === 'month' ? addMonths(currentDate, -1) : addDays(currentDate, -getStepDays(viewMode)));
  const goNext = () => setCurrentDate(viewMode === 'month' ? addMonths(currentDate, 1) : addDays(currentDate, getStepDays(viewMode)));

  useGoTodaySignal(goToday);
  useCalendarShortcuts({ goToday, goPrev, goNext, setViewMode, handleNewBooking, setTipOpen });

  // ── Therapist/room column reorder ────────────────────────────
  // Gates both onTherapistReorder and onRoomReorder below. Branch-scoped:
  // staff can rearrange columns for their own branch only.
  const canReorderTherapists = ['staff', 'manager', 'admin'].includes(profile?.role);
  // Own-only and view-only logins (and the all-branches view) cannot assign, so they get no bar and no link.
  const canAssign = !ownOnly && profile?.role !== 'admin_viewer' && !isOverallBranch(branchId);

  const assignCount = useMemo(() => dayAssignCount(calendarData?.bookings || [], currentDate), [calendarData?.bookings, currentDate]);

  const minutesOf = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  // ZNLY-407: make a booking longer by dragging its end. No confirm box: it saves on release, with Undo. A refusal leaves it as it was and says why.
  const handleExtendBooking = async (booking, extraMinutes) => {
    const id = booking.bookingId || booking.id;
    const base = booking.serviceMinutes ?? booking.serviceDuration;
    const before = Math.max(0, (booking.endTime && booking.startTime ? minutesOf(booking.endTime) - minutesOf(booking.startTime) : 0) - base);
    const r = await assignGuard((overrideReason) => extendBooking({ bookingId: id, extraMinutes, overrideReason }));
    if (r?.error) {
      // staff cannot override working hours: a plain sentence that says who can
      if (!r.error.cancelled) showToast(`${(r.error.message || "Couldn't change the length. Nothing was changed.").replace(/[.\s]+$/, '')}.${r.error.overridable && !canOverride ? ' Ask a manager.' : ''}`, 'error');
      refreshLight(refreshCalendar);
      return;
    }
    refreshLight(refreshCalendar);
    const len = base + extraMinutes;
    const endMin = minutesOf(booking.startTime) + len;
    const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const undo = async () => {
      setAssignedToast(null);
      const u = await assignGuard((overrideReason) => extendBooking({ bookingId: id, extraMinutes: before, overrideReason }));
      if (u?.error) { showToast(u.error.message || "Couldn't undo. Open the booking to change it.", 'error'); return; }
      showToast('Back to the old length');
      refreshLight(refreshCalendar);
    };
    showAssignedToast({ msg: `${extraMinutes > before ? 'Made longer' : 'Made shorter'}: ${formatClockRange(hhmm(minutesOf(booking.startTime)), hhmm(endMin), readUse24h())} · ${len} min`, undo });
  };

  const handleAssigned = ({ bookingId, date, names, prevRoomId, roomChanged }) => {
    refreshLight(refreshCalendar);
    if (date && date !== currentDate) setCurrentDate(date);
    flashBooking(bookingId);
    const who = names.join(' & ') || staffLabel.toLowerCase();
    const undo = async () => {
      setAssignedToast(null);
      const r = await assignGuard((overrideReason) => assignTherapist({ bookingId, therapistIds: [], roomId: roomChanged ? prevRoomId : undefined, overrideReason }));
      if (r?.error) { showToast(r.error.message || 'Could not undo. Open the booking to change it.', 'error'); return; }
      showToast('Back to unassigned');
      refreshLight(refreshCalendar);
    };
    showAssignedToast({ msg: `Assigned to ${who}`, undo });
  };

  // ── Derived data ───────────────────────────────────────────

  // ZNLY-281: "N bookings today for this client" in the open panel / sheet (same index the grid uses).
  // ZNLY-402: "Also booked today" (visit rules) only for orgs with "Several services in one booking" ON; others keep "N bookings today for this client".
  const clientIndexAll = useMemo(() => buildVisitIndex(calendarData?.bookings), [calendarData?.bookings]);
  const selectedClientDay = useMemo(
    () => (selectedBooking
      ? visitDayInfo(clientIndexAll, selectedBooking)
      : null),
    [clientIndexAll, selectedBooking]
  );
  // ZNLY-435: the open booking's visit rows, straight from the calendar data, so the panel's card is drawn on first paint (it then refreshes quietly). Any view.
  const instantRows = useMemo(() => {
    if (!selectedBooking || !calendarData?.bookings) return null;
    const key = visitKey(selectedBooking);
    const seen = new Set();
    const rows = calendarData.bookings.filter((b) => visitKey(b) === key && (!selectedBooking.customerId || !b.customer_id || b.customer_id === selectedBooking.customerId) && !seen.has(b.id) && seen.add(b.id));
    return rows.length ? rows : null;
  }, [calendarData?.bookings, selectedBooking]);
  // People who are off / on leave on the shown day (the Staff picker lists them under "Off today", not selectable). Day view only:
  // the attendance + shift data is for one day, so other views keep the old rule of hiding them.
  const offStaff = useMemo(
    () => (calendarData && viewMode === 'day' ? offStaffReasons(calendarData.therapists.filter(t => t.is_service_staff !== false), { attendanceMap, shiftsByTherapist, date: currentDate }) : {}),
    [calendarData, viewMode, attendanceMap, shiftsByTherapist, currentDate]
  );
  const therapistsForModal = useMemo(() =>
    calendarData
      ? calendarData.therapists
          .filter(t => t.is_service_staff !== false && (!attendanceMap[t.id] || offStaff[t.id]))
          .map(t => ({
            id: t.id,
            name: t.name,
            gender: t.gender,
            specialties: t.specialties || [],
          }))
      : [],
    [calendarData, attendanceMap, offStaff]
  );

  // ── Error state ────────────────────────────────────────────

  if (error && !calendarData) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-8">
        <div className="text-center py-8">
          <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary mb-2">
            Failed to Load Calendar
          </h3>
          <p className="font-body font-body-normal text-text-secondary mb-4">{error}</p>
          <button
            onClick={() => fetchData(currentDate, currentDate)}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-primary text-white rounded-spa font-body font-body-medium text-sm hover:bg-primary/90 spa-transition-fast"
          >
            <Icon name="RefreshCw" size={16} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <UnlinkedLoginNotice />
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="bg-surface overflow-clip flex flex-col h-full pb-2">
          {rebookSource?.visit && (
            <div role="status" data-pick-new-time className="flex items-center justify-between gap-3 px-4 min-h-11 bg-success/10 text-success text-[13px] font-medium border-b border-success/20">
              <span>Pick a new time for {String(rebookSource.customerName || 'this').split(' ')[0]}&apos;s booking ({rebookSource.visit.count} services)</span>
              <button type="button" onClick={handleRebookCancel} aria-label="Stop moving this booking" className="p-1.5 rounded-spa hover:bg-success/10"><Icon name="X" size={16} /></button>
            </div>
          )}
          <CalendarToolbar
            staffLabel={staffLabel}
            staffLabelPlural={staffLabelPlural}
            locationLabel={locationLabel}
            enableRooms={enableRooms && !ownOnly}
            ownOnly={ownOnly}
            columnMode={columnMode}
            setColumnMode={setColumnMode}
            onGroupByChange={setGroupBy}
            awayList={awayList}
            currentDate={currentDate}
            setCurrentDate={setCurrentDate}
            viewMode={viewMode}
            setViewMode={setViewMode}
            goToday={goToday}
            goPrev={goPrev}
            goNext={goNext}
            tipOpen={tipOpen}
            setTipOpen={setTipOpen}
            showServiceOnly={showServiceOnly}
            setShowServiceOnly={setShowServiceOnly}
            selectedPositions={selectedPositions}
            setSelectedPositions={setSelectedPositions}
            staffOptions={staffOptions}
            teamUniverse={teamUniverse}
            hiddenStaffIds={hiddenStaffIds}
            setHiddenStaffIds={setHiddenStaffIds}
            calendarPositionOptions={calendarPositionOptions}
            onNewBooking={isOverallBranch(branchId) ? undefined : handleNewBooking}
            onOpenWaitlist={() => setWaitlistSheetOpen(true)}
            waitlistCount={waitlist.entries.length}
            branchId={branchId}
            userRole={userRole}
            onPrint={() => setPrintReportOpen(true)}
            onEditRoster={isOverallBranch(branchId) ? undefined : () => navigate(`/${orgSlug}/dashboard?view=roster`)}
            onBlockWholeCalendar={isOverallBranch(branchId) ? undefined : () => setAddBlockSlot({ day: currentDate, colType: 'location', colId: null, colName: 'Whole location' })}
            onCalendarSettings={() => navigate(`/${orgSlug}/dashboard?view=calendar-settings`)}
            onClosedDates={() => navigate(`/${orgSlug}/dashboard?view=closed-dates`)}
            zoomScale={zoomScale}
            onZoomChange={setZoomScale}
            minZoom={minZoomNow}
            maxZoom={MAX_ZOOM}
            use24h={use24h}
            setUse24h={setUse24h}
            hideSensitive={hideSensitive}
            setHideSensitive={setHideSensitive}
          />

          {focusTherapistId && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-[13px] bg-background border-b border-border" data-calendar-focus>
              <span className="text-text-secondary">Showing only <b className="text-text-primary font-medium">{(calendarData?.therapists || []).find(t => t.id === focusTherapistId)?.name || 'one person'}</b></span>
              <button type="button" onClick={clearFocusTherapist} className="text-primary hover:underline">Show everyone</button>
            </div>
          )}
          {columnMode === 'therapist' && viewMode !== 'month' && !focusTherapistId && calendarData && filteredTherapists.length === 0 && (hiddenStaffIds.length > 0 || selectedPositions.length > 0) && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-[13px] bg-background border-b border-border" data-calendar-no-match>
              <span className="text-text-secondary">No {staffLabelPlural.toLowerCase()} match this filter.</span>
              <button type="button" onClick={() => { setHiddenStaffIds([]); setSelectedPositions([]); }} className="text-primary hover:underline">Clear filter</button>
            </div>
          )}
          {/* Main content area: Grid */}
          <div className="flex flex-1 min-h-0 overflow-clip">
            {/* Calendar grid */}
            <div className="flex-1 min-w-0 overflow-x-auto md:overflow-clip">
              {calendarData ? (
                viewMode === 'month' ? (
                  <MonthGridView
                    currentDate={currentDate}
                    bookings={calendarData.bookings}
                    branchHours={calendarData.branchHours}
                    hideSensitive={hideSensitive}
                    use24h={use24h}
                    onDayClick={(date) => { setCurrentDate(date); setViewMode('day'); }}
                    onBookingClick={handleBookingClick}
                  />
                ) : (
                <CalendarGrid
                  therapists={filteredTherapists}
                  rooms={calendarData.rooms || []}
                  bookings={calendarData.bookings}
                  branchHours={calendarData.branchHours}
                  attendanceMap={attendanceMap}
                  attendanceByTherapist={attendanceByTherapist}
                  shiftsByTherapist={shiftsByTherapist}
                  checkedOutByTherapistAndDate={calendarData.checkedOutByTherapistAndDate}
                  onBookingClick={handleBookingClick}
                  onBookingResize={handleBookingResize}
                  canExtend={canExtend}
                  onExtendBooking={handleExtendBooking}
                  onMultiDrag={(getter) => { getSelectedBookingsRef.current = getter; }}
                  // Phones (ZNLY-285): with the booking sheet open, a tap on the empty grid only closes the sheet (through its dirty guard).
                  onEmptySlotClick={(slot) => {
                    if (modalOpen && window.innerWidth < 768) { runThroughPanelGuard(handleModalClose); return; }
                    handleEmptySlotClick(slot);
                  }}
                  currentDate={currentDate}
                  viewMode={viewMode}
                  columnMode={columnMode}
                  activeDragId={activeDragId}
                  gridRef={gridRef}
                  freezeUnassigned={freezeUnassigned}
                  hideUnassigned={ownOnly}
                  onToggleFreezeUnassigned={() => setFreezeUnassigned(prev => !prev)}
                  onTherapistReorder={canReorderTherapists ? handleTherapistReorder : undefined}
                  onRoomReorder={canReorderTherapists ? handleRoomReorder : undefined}
                  blockOccurrences={calendarData.blockOccurrences}
                  overlapOccurrences={overlapOccurrences}
                  onDragCreate={handleDragCreate}
                  onDeleteManualBlock={setBlockDeleteRequest}
                  onResizeManualBlock={handleResizeManualBlock}
                  draftGhost={(quickCreateSlot || blockPanelOpen) && !draftGhost?.hidden ? draftGhost : null}
                  selectedBookingId={modalOpen ? (selectedBooking?.bookingId || previewBooking?.bookingId || previewBooking?.id || null) : null}
                  pickMode={!!rebookSource}
                  onEditManualBlock={(range) => runThroughPanelGuard(() => openOnlyPanel(() => setEditingBlock({ blockId: range.blockId, day: range.day })))}
                  onEditTransfer={transfersAvailable ? (col) => runThroughPanelGuard(() => openOnlyPanel(() => setEditingTransferTherapist({ id: col.id, name: col.name }))) : undefined}
                  hideSensitive={hideSensitive}
                  startHour={calendarStartHour}
                  endHour={calendarEndHour}
                  showFullDay={calendarShowFullDay}
                  intervalMinutes={calendarIntervalMinutes}
                  use24h={use24h}
                  zoomScale={zoomScale}
                  onZoomScaleChange={setZoomScale}
                  onOpenUnassigned={canAssign ? (b) => { if (columnMode === 'room') { setOpenTab('assign'); handleBookingClick(b); } else setAssignOpen(true); } : undefined}
                  assignCount={columnMode === 'room' ? null : assignCount}
                  onOpenAssignList={canAssign ? () => setAssignOpen(true) : undefined}
                />
                )
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                    <p className="font-body text-sm text-text-secondary">Loading calendar...</p>
                  </div>
                </div>
              )}
            </div>

            <WaitlistPanel
              wl={waitlist}
              sheetOpen={waitlistSheetOpen}
              onCloseSheet={() => setWaitlistSheetOpen(false)}
              branchId={branchId}
              services={servicesCache || []}
              therapists={calendarData?.therapists || []}
              collapsed={waitlistCollapsed}
              onToggleCollapse={() => setWaitlistCollapsed((v) => !v)}
              onBookIn={(entry) => { setWaitlistSheetOpen(false); handleBookInFromWaitlist(entry); }}
              canViewCustomerDetails={canViewCustomerDetails}
            />

            {/* Quick-create: docked at lg+ (shrinks the calendar), overlay below */}
            <QuickCreatePanel
              slotInfo={quickCreateSlot}
              services={servicesCache}
              servicesLoading={servicesLoading}
              therapists={(calendarData?.therapists || []).filter(t => t.is_service_staff !== false && (!attendanceMap[t.id] || offStaff[t.id]))}
              offStaff={offStaff}
              offDate={currentDate}
              rooms={calendarData?.rooms || []}
              bookings={calendarData?.bookings || []}
              onClose={handleQuickCreateClose}
              onBack={handleQuickCreateBack}
              onSubmit={handleQuickCreateSubmit}
              branchId={branchId}
              branchHours={calendarData?.branchHours}
              retarget={retargetRequest}
              onDraftChange={setDraftGhost}
              columnMode={columnMode}
              allTherapists={calendarData?.therapists || []}
              guardRef={quickGuardRef}
              onRefreshCalendar={refreshCalendar}
            />
          </div>
        </div>

        <DragPreviewOverlay
          activeDragBlock={activeDragBlock}
          activeDragBooking={activeDragBooking}
          overSlotData={overSlotData}
          columnMode={columnMode}
          shiftsByTherapist={shiftsByTherapist}
          therapists={calendarData?.therapists}
          enforce={enforceStaffAvailability}
          canOverride={['manager', 'admin'].includes(profile?.role)}
        />
      </DndContext>

      {visitMove && (
        <MoveBookingDialog
          visitKey={visitMove.visitKey}
          date={visitMove.date}
          startTime={visitMove.startTime}
          lines={visitMove.lines}
          onConfirm={visitMove.onConfirm}
          staffIds={visitMove.staffIds}
          dayBookings={calendarData?.bookings || []}
          canOverride={['manager', 'admin'].includes(profile?.role)}
          onClose={() => setVisitMove(null)}
          onDone={() => { setVisitMove(null); if (visitMove.onConfirm) return; handleRebookCancel(); showToast('Booking moved.'); refreshLight(refreshCalendar); }}
        />
      )}

      {/* Rebook floating cursor card */}
      {rebookSource && (
        <div
          ref={rebookCardRef}
          role="status"
          aria-live="polite"
          aria-label={`${rebookSource.isReschedule ? 'Reschedule' : 'Rebook'} mode active for ${rebookSource.customerName}. Click an empty calendar slot to place, or press Escape to cancel.`}
          className="fixed pointer-events-none z-notification"
          style={{ left: -9999, top: -9999, opacity: 0 }}
        >
          <div className="bg-white rounded-md border-2 border-primary shadow-lg px-3 py-2 min-w-[140px]">
            <div className="font-body font-semibold text-xs text-text-primary">
              {rebookSource.customerName}
            </div>
            <div className="font-body text-[11px] text-text-secondary">
              {rebookSource.serviceName}
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="font-caption text-[10px] text-text-secondary">
                {rebookSource.duration}
              </span>
              <span className="font-caption text-[10px] text-primary font-medium inline-flex items-center gap-1">
                {reschedulePending && <span className="w-2.5 h-2.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" aria-hidden="true" />}
                {reschedulePending ? 'Moving…' : rebookSource.isReschedule ? 'Click to move' : 'Click to place'}
              </span>
            </div>
          </div>
        </div>
      )}

      {printReportOpen && (
        <PrintReportModal
          date={currentDate}
          bookings={calendarData?.bookings || []}
          onClose={() => setPrintReportOpen(false)}
          use24h={use24h}
        />
      )}

      {/* Booking Action Modal */}
      <BookingActionModal
        variant="panel"
        liveBackdrop
        use24h={use24h}
        initialTab={openTab}
        isOpen={modalOpen}
        previewBooking={previewBooking}
        onRefreshBooking={refreshOpenBooking}
        guardRef={bookingGuardRef}
        onClose={handleModalClose}
        booking={selectedBooking}
        clientDay={selectedClientDay}
        instantRows={instantRows}
        therapists={therapistsForModal}
        dayBookings={viewMode === 'day' ? (calendarData?.bookings || []) : null}
        offStaff={offStaff}
        rooms={calendarData?.rooms || []}
        services={servicesCache || []}
        onUpdateStatus={handleStatusUpdate}
        onAssignTherapist={handleAssignTherapist}
        onRecordPayment={handleRecordPayment}
        onApplyDiscount={handleApplyDiscount}
        onEditBooking={handleEditBooking}
        // Overall is view-only for creating data: with no create/rebook/reschedule handlers the panel hides Rebook, + Service and Reschedule.
        onAddServiceStart={isOverallBranch(branchId) ? undefined : handleAddServiceStart}
        onRebookStart={isOverallBranch(branchId) ? undefined : handleRebookStart}
        onRescheduleStart={isOverallBranch(branchId) ? undefined : handleRescheduleStart}
        onEditForm={isOverallBranch(branchId) ? undefined : handleEditFormStart}
        onGroupPaymentRecorded={handleGroupPaymentRecorded}
        canViewCustomerDetails={canViewCustomerDetails}
        onViewBooking={(bookingId) => handleBookingClick({ bookingId })}
        branchHours={calendarData?.branchHours}
        userRole={profile?.role || 'staff'}
      />

      {printReportOpen && (
        <PrintReportModal
          date={currentDate}
          bookings={calendarData?.bookings || []}
          onClose={() => setPrintReportOpen(false)}
          use24h={use24h}
        />
      )}

      <AssignFlow
        isOpen={assignOpen}
        onClose={() => setAssignOpen(false)}
        branchId={branchId}
        currentDate={currentDate}
        calendarData={calendarData}
        attendanceMap={attendanceMap}
        shiftsByTherapist={shiftsByTherapist}
        staffLabel={staffLabel}
        staffLabelPlural={staffLabelPlural}
        locationLabel={locationLabel}
        onAssigned={handleAssigned}
      />

      {assignedToast && (
        <div role="status" className="fixed toast-bottom left-1/2 -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center gap-4 bg-success text-white">
          <Icon name="CheckCircle" size={16} />
          <span className="font-body font-body-medium text-sm">{assignedToast.msg}</span>
          <button type="button" onClick={assignedToast.undo} className="min-h-[44px] -my-2 px-2 text-sm font-semibold underline">Undo</button>
        </div>
      )}

      {/* Toast */}
      <GuideNotice notice={guideNotice} can={new Set(['show-calendar'])} onClose={() => setGuideNotice(null)}
        onAction={(act) => { if (act.intent === 'show-calendar') { setGuideNotice(null); refreshCalendar(); } }} />

      {actionToast && (
        <div className={`fixed toast-top left-1/2 transform -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2 ${
          actionToast.type === 'error' ? 'bg-error text-white' :
          actionToast.type === 'info' ? 'bg-primary text-white' :
          'bg-success text-white'
        }`}>
          <Icon name={actionToast.type === 'error' ? 'AlertCircle' : actionToast.type === 'info' ? 'Clock' : 'CheckCircle'} size={16} />
          <span className="font-body font-body-medium text-sm">{actionToast.msg}</span>
        </div>
      )}

      {/* Empty-slot choice menu — add further options (e.g. 3c "Transfer staff") to this array */}
      {choiceMenuSlot && (
        <EmptySlotChoiceMenu
          x={choiceMenuSlot.clientX}
          y={choiceMenuSlot.clientY}
          onClose={() => setChoiceMenuSlot(null)}
          header={choiceMenuSlot.reason || null}
          options={[
            // On shaded time the slot is "not bookable" for staff (and for anyone when the reason can't be overridden, e.g. leave).
            // Managers/admins can still open the form: it shows the amber notice and asks for a reason on save.
            ...(isOverallBranch(branchId) ? [] : [{
              key: 'booking', label: 'Add booking', icon: 'CalendarPlus', onSelect: () => openQuickCreateForSlot(choiceMenuSlot),
              disabled: !!choiceMenuSlot.reason && enforceStaffAvailability && !(['manager', 'admin'].includes(profile?.role) && choiceMenuSlot.reasonOverridable),
              note: 'not bookable',
            }]),
            ...(isOverallBranch(branchId) ? [] : [{ key: 'block', label: 'Add block', icon: 'Ban', onSelect: () => openOnlyPanel(() => setAddBlockSlot(choiceMenuSlot)) }]),
            // Transfer is a therapist-column action for managers/admins only (the RPC enforces it too).
            ...(!isOverallBranch(branchId) && transfersAvailable && choiceMenuSlot.colType === 'therapist' && ['manager', 'admin'].includes(profile?.role) ? [{
              key: 'transfer',
              label: `Transfer ${staffWord()}`,
              icon: 'ArrowRightLeft',
              onSelect: () => openOnlyPanel(() => setTransferModalTarget({
                therapistId: choiceMenuSlot.colId,
                therapistName: choiceMenuSlot.colName,
                defaultDate: choiceMenuSlot.day,
                defaultTime: `${String(choiceMenuSlot.hour).padStart(2, '0')}:${String(choiceMenuSlot.minute).padStart(2, '0')}`,
              })),
            }] : []),
          ]}
        />
      )}

      {transferModalTarget && (
        <TransferFromCalendarModal
          variant="panel"
          guardRef={blockGuardRef}
          onDraftChange={setDraftGhost}
          therapistId={transferModalTarget.therapistId}
          therapistName={transferModalTarget.therapistName}
          currentBranchId={branchId}
          defaultDate={transferModalTarget.defaultDate}
          defaultTime={transferModalTarget.defaultTime}
          onClose={() => setTransferModalTarget(null)}
          onSuccess={({ message } = {}) => {
            const name = transferModalTarget.therapistName;
            setTransferModalTarget(null);
            showToast(message || `${name} transferred.`);
            refreshCalendar();
          }}
        />
      )}

      {editingTransferTherapist && (
        <TransferManagementModal
          variant="panel"
          guardRef={blockGuardRef}
          onDraftChange={setDraftGhost}
          therapistId={editingTransferTherapist.id}
          therapistName={editingTransferTherapist.name}
          currentBranchId={branchId}
          use24h={use24h}
          defaultStartDate={currentDate}
          onClose={() => setEditingTransferTherapist(null)}
          onSuccess={(message) => {
            setEditingTransferTherapist(null);
            if (message) showToast(message);
            refreshCalendar();
          }}
        />
      )}

      {addBlockSlot && (
        <AddBlockModal
          variant="panel"
          guardRef={blockGuardRef}
          onDraftChange={setDraftGhost}
          retarget={blockRetarget}
          bookings={calendarData?.bookings || []}
          branchHours={calendarData?.branchHours}
          branchId={branchId}
          slotInfo={addBlockSlot}
          therapists={calendarData?.therapists || []}
          rooms={calendarData?.rooms || []}
          onClose={() => setAddBlockSlot(null)}
          onSuccess={() => {
            const hiddenInThisView = columnMode === 'therapist' && lastBlockWasRoomOnly.current;
            setAddBlockSlot(null);
            showToast(hiddenInThisView ? 'Block added. Switch to Room view to see it.' : 'Block added.');
            refreshCalendar();
          }}
          onRoomOnlyChange={(v) => { lastBlockWasRoomOnly.current = v; }}
        />
      )}

      {editingBlock && (
        <EditBlockModal
          variant="panel"
          guardRef={blockGuardRef}
          onDraftChange={setDraftGhost}
          retarget={blockRetarget}
          bookings={calendarData?.bookings || []}
          branchHours={calendarData?.branchHours}
          blockId={editingBlock.blockId}
          occurrenceDate={editingBlock.day}
          therapists={calendarData?.therapists || []}
          rooms={calendarData?.rooms || []}
          onClose={() => setEditingBlock(null)}
          onSuccess={() => {
            setEditingBlock(null);
            showToast('Block updated.');
            refreshCalendar();
          }}
        />
      )}

      {blockDeleteRequest && (
        <BlockScopeDialog
          title="Remove block"
          verb="removed"
          recurring={!!blockDeleteRequest.seriesId}
          onCancel={() => setBlockDeleteRequest(null)}
          onChoose={(scope) => {
            const req = blockDeleteRequest;
            setBlockDeleteRequest(null);
            handleDeleteManualBlock({ blockId: req.blockId, day: req.day, scope });
          }}
        />
      )}

      {pendingReassign && (
        <ReassignConfirmDialog
          pendingReassign={pendingReassign}
          calendarData={calendarData}
          staffLabel={staffLabel}
          locationLabel={locationLabel}
          onCancel={() => setPendingReassign(null)}
          onConfirm={handleConfirmReassign}
        />
      )}
    </>
  );
};

export default OperationalCalendar;
