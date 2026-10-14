import React, { useState, useMemo, useRef } from 'react';
import { DndContext, pointerWithin } from '@dnd-kit/core';
import Icon from '../../../../components/AppIcon';
import BookingActionModal from '../../../../components/ui/BookingActionModal';
import EmptySlotChoiceMenu from './EmptySlotChoiceMenu';
import AddBlockModal from './AddBlockModal';
import EditBlockModal from './EditBlockModal';
import BlockScopeDialog from './BlockScopeDialog';
import TransferFromCalendarModal from './TransferFromCalendarModal';
import TransferManagementModal from '../../../../components/ui/TransferManagementModal';
import CalendarGrid from './CalendarGrid';
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
import { useAutoRefresh } from '../../../../hooks/useAutoRefresh';
import { useAuth } from '../../../../contexts/AuthContext';
import { todayStr, addDays, getStepDays } from './calendarDates';

// ── Component ────────────────────────────────────────────────

const OperationalCalendar = ({ branchId }) => {
  const { profile } = useAuth();
  // Industry-specific labels from auth context
  const industry = profile?.organizations?.industries;
  const staffLabel = industry?.staff_label || 'Therapist';
  const staffLabelPlural = industry?.staff_label_plural || 'Therapists';
  const locationLabel = industry?.location_label || 'Room';
  const locationLabelPlural = industry?.location_label_plural || 'Rooms';
  const enableRooms = industry?.enable_rooms !== false;

  // View state
  const [currentDate, setCurrentDate] = useState(todayStr());
  const [viewMode, setViewMode] = useState('day'); // day | 4day
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
    calendarData, setCalendarData, error, attendanceMap, blocksAvailable, transfersAvailable,
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
    list = list.filter(t => !attendanceMap[t.id]);
    if (showServiceOnly) {
      list = list.filter(t => t.is_service_staff !== false);
    }
    if (selectedPositions.length > 0) {
      list = list.filter(t => t.position && t.position.split('/').some(p => selectedPositions.includes(p.trim())));
    }
    return list;
  }, [calendarData?.therapists, showServiceOnly, selectedPositions, attendanceMap, currentDate]);

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
    transferCancelRequest, setTransferCancelRequest, blockPanelOpen, blockRetarget,
    servicesCache, servicesLoading, rebookSource, rebookFallback, rebookCardRef,
    openQuickCreateForSlot, handleNewBooking, handleDragCreate, handleEmptySlotClick, handleConfirmTransferCancel,
    handleDeleteManualBlock, handleResizeManualBlock, handleQuickCreateClose, handleQuickCreateSubmit, handleRebookStart,
    runThroughPanelGuard, openOnlyPanel, handleBookingClick, refreshOpenBooking, handleModalClose,
  } = useCalendarPanels({ branchId, currentDate, calendarData, refreshCalendar, blocksAvailable, showToast, gridRef });

  const {
    handleStatusUpdate, handleAssignTherapist, handleBookingResize, handleEditBooking, handleApplyDiscount, handleRecordPayment,
  } = useBookingActions({ showToast, refreshCalendar, selectedBooking, setSelectedBooking, getSelectedBookingsRef, staffLabel });

  // Auto-refresh every 60s. Paused while any modal/panel/drag/confirm is active
  // (the tab-hidden skip lives in the hook). fetchData swaps calendarData in place,
  // so scroll position, popovers and the hover label are untouched.
  const autoRefreshPaused = modalOpen || blockPanelOpen || !!activeDragId || isRescheduling || !!quickCreateSlot
    || !!pendingReassign || !!rebookSource || !!choiceMenuSlot || !!addBlockSlot || !!editingBlock || !!blockDeleteRequest
    || !!transferModalTarget || !!editingTransferTherapist || !!transferCancelRequest;
  useAutoRefresh(refreshCalendar, { intervalMs: 60000, enabled: !!branchId && !autoRefreshPaused });

  // ── Navigation ─────────────────────────────────────────────

  const overlapOccurrences = useMemo(() => [...(calendarData?.blockOccurrences || []), ...(calendarData?.transferOccurrences || [])], [calendarData]);
  const goToday = () => setCurrentDate(todayStr());
  const goPrev = () => setCurrentDate(addDays(currentDate, -getStepDays(viewMode)));
  const goNext = () => setCurrentDate(addDays(currentDate, getStepDays(viewMode)));

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
            onNewBooking={handleNewBooking}
            branchId={branchId}
          />

          {/* Main content area: Grid */}
          <div className="flex flex-1 min-h-0 overflow-clip">
            {/* Calendar grid */}
            <div className="flex-1 min-w-0 overflow-x-auto md:overflow-clip">
              {calendarData ? (
                <CalendarGrid
                  therapists={filteredTherapists}
                  rooms={calendarData.rooms || []}
                  bookings={calendarData.bookings}
                  branchHours={calendarData.branchHours}
                  attendanceMap={attendanceMap}
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
                  onCancelScheduledTransfer={transfersAvailable ? (col) => setTransferCancelRequest({ kind: 'scheduled', col }) : undefined}
                  onCancelActiveTransfer={transfersAvailable ? (col) => setTransferCancelRequest({ kind: 'active', col }) : undefined}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                    <p className="font-body text-sm text-text-secondary">Loading calendar...</p>
                  </div>
                </div>
              )}
            </div>

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

        <DragPreviewOverlay activeDragBlock={activeDragBlock} activeDragBooking={activeDragBooking} overSlotData={overSlotData} />
      </DndContext>

      {/* Rebook floating cursor card */}
      {rebookSource && (
        <div
          ref={rebookCardRef}
          role="status"
          aria-live="polite"
          aria-label={`Rebook mode active for ${rebookSource.customerName}. Click an empty calendar slot to place, or press Escape to cancel.`}
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
              <span className="font-caption text-[10px] text-primary font-medium">
                Click to place
              </span>
            </div>
          </div>
        </div>
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
        onCreateBooking={handleQuickCreateSubmit}
        onRebookStart={handleRebookStart}
        // TODO(step 7): onRescheduleStart (reschedule-as-new) and onGroupPaymentRecorded (atomic bundled payment) were Zennly props here; the modal falls back to the sequential payment loop and hides Reschedule until then.
        branchHours={calendarData?.branchHours}
        defaultNewBookingMode={rebookFallback ? 'rebook' : null}
        userRole={profile?.role || 'staff'}
      />

      {/* Toast */}
      {actionToast && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2 ${
          actionToast.type === 'error' ? 'bg-error text-white' :
          actionToast.type === 'info' ? 'bg-blue-500 text-white' :
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
          options={[
            { key: 'booking', label: 'Add booking', icon: 'CalendarPlus', onSelect: () => openQuickCreateForSlot(choiceMenuSlot) },
            { key: 'block', label: 'Add block', icon: 'Ban', onSelect: () => openOnlyPanel(() => setAddBlockSlot(choiceMenuSlot)) },
            // Transfer is a therapist-column action for managers/admins only (the RPC enforces it too).
            ...(transfersAvailable && choiceMenuSlot.colType === 'therapist' && ['manager', 'admin'].includes(profile?.role) ? [{
              key: 'transfer',
              label: 'Transfer therapist',
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
          defaultStartDate={currentDate}
          onClose={() => setEditingTransferTherapist(null)}
          onSuccess={(message) => {
            setEditingTransferTherapist(null);
            if (message) showToast(message);
            refreshCalendar();
          }}
        />
      )}

      {transferCancelRequest && (
        <BlockScopeDialog
          title={transferCancelRequest.kind === 'scheduled'
            ? `Cancel ${transferCancelRequest.col.name}'s scheduled transfer?`
            : `Cancel ${transferCancelRequest.col.name}'s transfer and bring them back now?`}
          recurring={false}
          confirmLabel={transferCancelRequest.kind === 'scheduled' ? 'Cancel transfer' : 'Bring back now'}
          onCancel={() => setTransferCancelRequest(null)}
          onChoose={handleConfirmTransferCancel}
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
