import React, { useState, useMemo, useRef } from 'react';
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
import ReassignConfirmDialog from './ReassignConfirmDialog';
import QuickCreatePanel from './QuickCreatePanel';
import { useCalendarData } from './hooks/useCalendarData';
import { useCalendarDnd } from './hooks/useCalendarDnd';
import { useCalendarPanels } from './hooks/useCalendarPanels';
import { useCalendarShortcuts } from './hooks/useCalendarShortcuts';
import { useGoTodaySignal } from './calendarSignals';
import { useBookingActions } from './hooks/useBookingActions';
import { isOverallBranch } from '../../../../services/api';
import { useAutoRefresh } from '../../../../hooks/useAutoRefresh';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import WaitlistPanel, { useWaitlistEntries } from './WaitlistPanel';
import { todayStr, addDays, addMonths, getStepDays } from './calendarDates';
import { staffWord } from '../../../../utils/industryTerms';

// ── Component ────────────────────────────────────────────────

const OperationalCalendar = ({ branchId }) => {
  const { profile } = useAuth();
  const { orgSettings, enforceStaffAvailability } = useOrg();
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
  const [use24h, setUse24hState] = useState(() => readPref('use24h', null) === '1');
  const setUse24h = (updater) => setUse24hState((prev) => {
    const next = typeof updater === 'function' ? updater(prev) : updater;
    writePref('use24h', next ? '1' : '0');
    return next;
  });
  const [zoomScale, setZoomScaleState] = useState(() => {
    const raw = parseFloat(readPref('zoom', null));
    return Number.isFinite(raw) ? clampZoom(raw) : 1;
  });
  const setZoomScale = (updater) => setZoomScaleState((prev) => {
    const next = clampZoom(typeof updater === 'function' ? updater(prev) : updater);
    writePref('zoom', String(next));
    return next;
  });
  // Default to staff view if rooms are disabled
  const [columnMode, setColumnMode] = useState('therapist'); // therapist | room
  const [freezeUnassigned, setFreezeUnassigned] = useState(true);
  const [showServiceOnly, setShowServiceOnly] = useState(true);
  const [selectedPositions, setSelectedPositions] = useState([]); // empty = all
  const [tipOpen, setTipOpen] = useState(false);
  const [actionToast, setActionToast] = useState(null);

  // Ref to the grid body for calculating time from cursor position
  const gridRef = useRef(null);

  // Multi-drag: ref to get selected bookings from CalendarGrid
  const getSelectedBookingsRef = useRef(() => []);

  const showToast = (msg, type = 'success') => {
    setActionToast({ msg, type });
    setTimeout(() => setActionToast(null), 3000);
  };


  const {
    calendarData, setCalendarData, error, attendanceMap, attendanceByTherapist, shiftsByTherapist, blocksAvailable, transfersAvailable,
    fetchData, refreshCalendar, handleTherapistReorder, handleRoomReorder,
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
    return list;
  }, [calendarData?.therapists, showServiceOnly, selectedPositions, attendanceMap, currentDate, focusTherapistId]);

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
  } = useCalendarDnd({ calendarData, setCalendarData, columnMode, refreshCalendar, showToast, gridRef, getSelectedBookingsRef });

  const {
    selectedBooking, setSelectedBooking, modalOpen, previewBooking, quickGuardRef, bookingGuardRef, blockGuardRef,
    quickCreateSlot, retargetRequest, draftGhost, setDraftGhost,
    choiceMenuSlot, setChoiceMenuSlot, addBlockSlot, setAddBlockSlot, editingBlock, setEditingBlock,
    blockDeleteRequest, setBlockDeleteRequest, lastBlockWasRoomOnly,
    transferModalTarget, setTransferModalTarget, editingTransferTherapist, setEditingTransferTherapist,
    blockPanelOpen, blockRetarget,
    servicesCache, servicesLoading, rebookSource, rebookFallback, rebookCardRef, reschedulePending,
    waitlistCollapsed, setWaitlistCollapsed, waitlistRefreshToken, handleBookInFromWaitlist,
    openQuickCreateForSlot, handleNewBooking, handleDragCreate, handleEmptySlotClick,
    handleDeleteManualBlock, handleResizeManualBlock, handleQuickCreateClose, handleQuickCreateSubmit, handleRebookStart, handleRescheduleStart,
    runThroughPanelGuard, openOnlyPanel, handleBookingClick, refreshOpenBooking, handleModalClose,
  } = useCalendarPanels({ branchId, currentDate, calendarData, refreshCalendar, blocksAvailable, showToast, gridRef, canViewCustomerDetails });
  const waitlist = useWaitlistEntries(branchId, waitlistRefreshToken);
  const [waitlistSheetOpen, setWaitlistSheetOpen] = useState(false);

  const {
    handleStatusUpdate, handleAssignTherapist, handleBookingResize, handleEditBooking, handleApplyDiscount, handleRecordPayment, handleGroupPaymentRecorded,
  } = useBookingActions({ showToast, refreshCalendar, selectedBooking, setSelectedBooking, getSelectedBookingsRef, staffLabel });

  // Auto-refresh every 60s. Paused while any modal/panel/drag/confirm is active
  // (the tab-hidden skip lives in the hook). fetchData swaps calendarData in place,
  // so scroll position, popovers and the hover label are untouched.
  const autoRefreshPaused = modalOpen || blockPanelOpen || !!activeDragId || isRescheduling || !!quickCreateSlot
    || !!pendingReassign || !!rebookSource || !!choiceMenuSlot || !!addBlockSlot || !!editingBlock || !!blockDeleteRequest
    || !!transferModalTarget || !!editingTransferTherapist;
  useAutoRefresh(refreshCalendar, { intervalMs: 60000, enabled: !!branchId && !autoRefreshPaused });

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

  // ── Derived data ───────────────────────────────────────────

  const therapistsForModal = useMemo(() =>
    calendarData
      ? calendarData.therapists
          .filter(t => t.is_service_staff !== false && !attendanceMap[t.id])
          .map(t => ({
            id: t.id,
            name: t.name,
            gender: t.gender,
            specialties: t.specialties || [],
          }))
      : [],
    [calendarData, attendanceMap]
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
          <CalendarToolbar
            staffLabel={staffLabel}
            staffLabelPlural={staffLabelPlural}
            locationLabel={locationLabel}
            enableRooms={enableRooms}
            columnMode={columnMode}
            setColumnMode={setColumnMode}
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
            minZoom={MIN_ZOOM}
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
                  onMultiDrag={(getter) => { getSelectedBookingsRef.current = getter; }}
                  onEmptySlotClick={handleEmptySlotClick}
                  currentDate={currentDate}
                  viewMode={viewMode}
                  columnMode={columnMode}
                  activeDragId={activeDragId}
                  gridRef={gridRef}
                  freezeUnassigned={freezeUnassigned}
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
              therapists={(calendarData?.therapists || []).filter(t => t.is_service_staff !== false && !attendanceMap[t.id])}
              rooms={calendarData?.rooms || []}
              bookings={calendarData?.bookings || []}
              onClose={handleQuickCreateClose}
              onSubmit={handleQuickCreateSubmit}
              branchId={branchId}
              branchHours={calendarData?.branchHours}
              retarget={retargetRequest}
              onDraftChange={setDraftGhost}
              columnMode={columnMode}
              allTherapists={calendarData?.therapists || []}
              guardRef={quickGuardRef}
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
        isOpen={modalOpen}
        previewBooking={previewBooking}
        onRefreshBooking={refreshOpenBooking}
        guardRef={bookingGuardRef}
        onClose={handleModalClose}
        booking={selectedBooking}
        therapists={therapistsForModal}
        rooms={calendarData?.rooms || []}
        services={servicesCache || []}
        onUpdateStatus={handleStatusUpdate}
        onAssignTherapist={handleAssignTherapist}
        onRecordPayment={handleRecordPayment}
        onApplyDiscount={handleApplyDiscount}
        onEditBooking={handleEditBooking}
        // Overall is view-only for creating data: with no create/rebook/reschedule handlers the panel hides Rebook, + Service and Reschedule.
        onCreateBooking={isOverallBranch(branchId) ? undefined : handleQuickCreateSubmit}
        onRebookStart={isOverallBranch(branchId) ? undefined : handleRebookStart}
        onRescheduleStart={isOverallBranch(branchId) ? undefined : handleRescheduleStart}
        onGroupPaymentRecorded={handleGroupPaymentRecorded}
        canViewCustomerDetails={canViewCustomerDetails}
        onViewBooking={(bookingId) => handleBookingClick({ bookingId })}
        branchHours={calendarData?.branchHours}
        defaultNewBookingMode={rebookFallback ? 'rebook' : null}
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

      {/* Toast */}
      {actionToast && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2 ${
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
          onSuccess={({ applied, startDate, startTime } = {}) => {
            const name = transferModalTarget.therapistName;
            setTransferModalTarget(null);
            showToast(applied === false
              ? `${name}'s transfer is scheduled for ${startTime ? `${startDate} at ${startTime}` : startDate} — it hasn't happened yet.`
              : `${name} transferred.`);
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
