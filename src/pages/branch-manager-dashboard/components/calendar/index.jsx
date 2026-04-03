import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, pointerWithin } from '@dnd-kit/core';
import Icon from '../../../../components/AppIcon';
import BookingActionModal from '../../../../components/ui/BookingActionModal';
import StatusLegend from '../../../../components/ui/StatusLegend';
import MiniMonthCalendar from './MiniMonthCalendar';
import CalendarGrid, { HOUR_HEIGHT } from './CalendarGrid';
import {
  getCalendarBookings,
  fetchBookingById,
  updateBookingStatus,
  assignTherapist,
  recordPayment,
  fetchAttendance,
  rescheduleBooking,
} from '../../../../services/api';
import { transformBooking, toDbStatus } from '../../../../services/bookingTransformers';

// ── Helpers ──────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatDateTitle(dateStr, viewMode) {
  const d = new Date(dateStr + 'T00:00:00');
  if (viewMode === '4day') {
    const end = new Date(d);
    end.setDate(end.getDate() + 3);
    const startStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function getDateRange(dateStr, viewMode) {
  if (viewMode === '4day') {
    return { start: dateStr, end: addDays(dateStr, 3) };
  }
  return { start: dateStr, end: dateStr };
}

function getStepDays(viewMode) {
  return viewMode === '4day' ? 4 : 1;
}

function formatTimeFromSlot(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function calculateEndTime(startHour, startMinute, durationMinutes) {
  const totalMinutes = startHour * 60 + startMinute + (durationMinutes || 60);
  const endHour = Math.floor(totalMinutes / 60);
  const endMinute = totalMinutes % 60;
  return `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
}

function formatTimeDisplay(time) {
  if (!time) return '';
  // Convert HH:MM to display format
  const [h, m] = time.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Component ────────────────────────────────────────────────

const OperationalCalendar = ({ branchId, heightOffset = 100 }) => {
  // View state
  const [currentDate, setCurrentDate] = useState(todayStr());
  const [viewMode, setViewMode] = useState('day'); // day | 4day
  const [columnMode, setColumnMode] = useState('therapist'); // therapist | room

  // Calendar data state
  const [calendarData, setCalendarData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Attendance indicators
  const [attendanceMap, setAttendanceMap] = useState({});

  // Modal state
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [actionToast, setActionToast] = useState(null);

  // Drag state
  const [activeDragId, setActiveDragId] = useState(null);
  const [activeDragBooking, setActiveDragBooking] = useState(null);
  const [overSlotData, setOverSlotData] = useState(null); // { hour, minute, day }
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Ref to the grid body for calculating time from cursor position
  const gridRef = useRef(null);

  // Configure drag sensors with activation constraints
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Require 5px movement or 150ms delay before drag starts
        // This prevents accidental drags and allows clicks to work
        distance: 5,
      },
    })
  );

  // ── Data fetching ──────────────────────────────────────────

  const fetchData = useCallback(async (startDate, endDate) => {
    if (!branchId || !startDate || !endDate) return;

    setLoading(true);
    setError(null);

    const [result, attResult] = await Promise.all([
      getCalendarBookings(branchId, startDate, endDate),
      fetchAttendance({ branchId, date: startDate }),
    ]);

    if (result.error) {
      setError(result.error.message || 'Failed to load calendar data.');
      setLoading(false);
      return;
    }

    setCalendarData(result.data);

    const attMap = {};
    if (attResult.data) {
      for (const a of attResult.data) {
        if (a.status === 'Absent' || a.status === 'Leave') {
          attMap[a.therapistId] = a.status;
        }
      }
    }
    setAttendanceMap(attMap);
    setLoading(false);
  }, [branchId]);

  // Reload when date or view changes
  useEffect(() => {
    if (!branchId) return;
    const { start, end } = getDateRange(currentDate, viewMode);
    fetchData(start, end);
  }, [branchId, currentDate, viewMode, fetchData]);

  const refreshCalendar = useCallback(() => {
    const { start, end } = getDateRange(currentDate, viewMode);
    fetchData(start, end);
  }, [currentDate, viewMode, fetchData]);

  // ── Navigation ─────────────────────────────────────────────

  const goToday = () => setCurrentDate(todayStr());
  const goPrev = () => setCurrentDate(addDays(currentDate, -getStepDays(viewMode)));
  const goNext = () => setCurrentDate(addDays(currentDate, getStepDays(viewMode)));

  // Ref to track current pointer Y position during drag (synchronous updates)
  const pointerYRef = useRef(null);

  // Track pointer position during drag
  useEffect(() => {
    if (!activeDragId) {
      pointerYRef.current = null;
      return;
    }

    const handlePointerMove = (e) => {
      pointerYRef.current = e.clientY;
    };

    document.addEventListener('pointermove', handlePointerMove);
    return () => document.removeEventListener('pointermove', handlePointerMove);
  }, [activeDragId]);

  // Calculate time slot from pointer Y position
  const calculateTimeFromPointer = useCallback((overData) => {
    if (!overData || !gridRef.current || pointerYRef.current === null) {
      return null;
    }

    const { day, colId, openHour } = overData;
    const gridRect = gridRef.current.getBoundingClientRect();

    // Get cursor position relative to the grid body element
    // getBoundingClientRect returns viewport coordinates which already account for scroll
    const relativeY = pointerYRef.current - gridRect.top;

    // Calculate hour and minute from Y position
    const minutesFromTop = (relativeY / HOUR_HEIGHT) * 60;
    const hour = Math.floor(minutesFromTop / 60) + openHour;
    const rawMinute = minutesFromTop % 60;
    const minute = Math.floor(rawMinute / 5) * 5; // Round to 5-minute intervals

    // Clamp to valid hours
    if (hour < openHour || minute < 0) {
      return { day, colId, hour: openHour, minute: 0 };
    }

    return { day, colId, hour, minute };
  }, []);

  // ── Drag and Drop Handlers ────────────────────────────────

  const handleDragStart = useCallback((event) => {
    const { active } = event;
    setActiveDragId(active.id);
    if (active.data.current?.booking) {
      setActiveDragBooking(active.data.current.booking);
    }
  }, []);

  // Called on every mouse move during drag - calculates time from position
  const handleDragMove = useCallback((event) => {
    const { over } = event;
    if (!over?.data?.current) {
      setOverSlotData(null);
      return;
    }

    const timeData = calculateTimeFromPointer(over.data.current);
    if (timeData) {
      setOverSlotData(timeData);
    }
  }, [calculateTimeFromPointer]);

  // Called when hovering over a new droppable (less frequent than dragMove)
  const handleDragOver = useCallback((event) => {
    const { over } = event;
    if (!over?.data?.current) {
      setOverSlotData(null);
      return;
    }

    const timeData = calculateTimeFromPointer(over.data.current);
    if (timeData) {
      setOverSlotData(timeData);
    }
  }, [calculateTimeFromPointer]);

  const handleDragEnd = useCallback(async (event) => {
    const { active, over } = event;

    // Capture final position before clearing state
    const finalTimeData = over?.data?.current ? calculateTimeFromPointer(over.data.current) : null;

    setActiveDragId(null);
    setActiveDragBooking(null);
    setOverSlotData(null);

    // If not dropped on a valid target, do nothing
    if (!over || !active.data.current?.booking || !finalTimeData) {
      return;
    }

    const booking = active.data.current.booking;
    const { day: newDate, hour, minute } = finalTimeData;

    if (hour === undefined || minute === undefined) {
      return;
    }

    const newStartTime = formatTimeFromSlot(hour, minute);
    const bookingId = booking.bookingId || booking.id;

    // Check if the time actually changed
    const oldTime = booking.startTime?.slice(0, 5);
    const oldDate = booking.date;
    if (oldTime === newStartTime && oldDate === newDate) {
      return; // No change
    }

    // Perform reschedule
    setIsRescheduling(true);
    showToast(`Rescheduling to ${newStartTime}...`, 'info');

    try {
      const result = await rescheduleBooking({
        bookingId,
        newDate,
        newStartTime,
      });

      if (result.error) {
        showToast(result.error.message || 'Failed to reschedule booking.', 'error');
      } else {
        showToast(`Booking rescheduled to ${newStartTime}`, 'success');
        refreshCalendar();
      }
    } catch (err) {
      showToast('An error occurred while rescheduling.', 'error');
    } finally {
      setIsRescheduling(false);
    }
  }, [refreshCalendar, calculateTimeFromPointer]);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setActiveDragBooking(null);
    setOverSlotData(null);
  }, []);

  // ── Event click → modal ────────────────────────────────────

  const handleBookingClick = useCallback(async (booking) => {
    const bookingId = booking.bookingId || booking.id;
    if (!bookingId) return;

    setModalLoading(true);
    setModalOpen(true);

    const result = await fetchBookingById(bookingId);

    if (result.error) {
      setModalOpen(false);
      setModalLoading(false);
      showToast(result.error.message || 'Failed to load booking.', 'error');
      return;
    }

    setSelectedBooking(transformBooking(result.data));
    setModalLoading(false);
  }, []);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setSelectedBooking(null);
    refreshCalendar();
  }, [refreshCalendar]);

  // ── Action handlers ────────────────────────────────────────

  const showToast = (msg, type = 'success') => {
    setActionToast({ msg, type });
    setTimeout(() => setActionToast(null), 3000);
  };

  const handleStatusUpdate = async (bookingId, newStatus) => {
    const dbStatus = toDbStatus(newStatus);
    const result = await updateBookingStatus({ bookingId, newStatus: dbStatus });
    if (result.error) {
      showToast(result.error.message || 'Failed to update status.', 'error');
      return;
    }
    showToast(`Status updated to ${newStatus}`);
  };

  const handleAssignTherapist = async (bookingId, therapistId) => {
    const result = await assignTherapist({ bookingId, therapistId });
    if (result.error) {
      showToast(result.error.message || 'Failed to assign therapist.', 'error');
      return;
    }
    showToast('Therapist assigned successfully');
  };

  const handleRecordPayment = async (bookingId, { paymentMode, notes }) => {
    const result = await recordPayment({ bookingId, paymentMode, notes });
    if (result.error) {
      return { error: result.error };
    }
    showToast('Payment recorded successfully');
    return { error: null };
  };

  // ── Derived data ───────────────────────────────────────────

  const therapistsForModal = useMemo(() =>
    calendarData
      ? calendarData.therapists.map(t => ({
          id: t.id,
          name: t.name,
          gender: t.gender,
          specialties: t.specialties || [],
        }))
      : [],
    [calendarData]
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

  // ── Render ─────────────────────────────────────────────────

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
        <div className="bg-surface overflow-hidden flex flex-col" style={{ height: `calc(100vh - ${heightOffset}px)` }}>
          {/* Top toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/50 flex-shrink-0">
            {/* Left: Navigation */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center border border-border rounded-spa overflow-hidden">
                <button
                  onClick={goPrev}
                  className="px-2 py-1.5 hover:bg-background spa-transition-fast border-r border-border"
                  aria-label="Previous day"
                >
                  <Icon name="ChevronLeft" size={16} className="text-text-secondary" />
                </button>
                <button
                  onClick={goNext}
                  className="px-2 py-1.5 hover:bg-background spa-transition-fast"
                  aria-label="Next day"
                >
                  <Icon name="ChevronRight" size={16} className="text-text-secondary" />
                </button>
              </div>
              <button
                onClick={goToday}
                className="px-3 py-1.5 text-sm font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast"
              >
                Today
              </button>
            </div>

            {/* Center: Date title with navigation */}
            <div className="flex items-center space-x-3">
              <button
                onClick={goPrev}
                className="p-1.5 border border-border rounded-spa hover:bg-background spa-transition-fast"
                aria-label="Previous"
              >
                <Icon name="ChevronLeft" size={18} className="text-text-secondary" />
              </button>
              <h2 className="font-heading font-heading-semibold text-base text-text-primary min-w-[140px] text-center">
                {formatDateTitle(currentDate, viewMode)}
              </h2>
              <button
                onClick={goNext}
                className="p-1.5 border border-border rounded-spa hover:bg-background spa-transition-fast"
                aria-label="Next"
              >
                <Icon name="ChevronRight" size={18} className="text-text-secondary" />
              </button>
            </div>

            {/* Right: View toggle + loading */}
            <div className="flex items-center space-x-3">
              {(loading || isRescheduling) && (
                <div className="flex items-center space-x-1.5 text-text-secondary">
                  <div className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />
                  <span className="font-caption text-xs">{isRescheduling ? 'Updating...' : 'Loading...'}</span>
                </div>
              )}
              <div className="flex items-center border border-border rounded-spa overflow-hidden">
                {[
                  { key: 'day', label: 'Day' },
                  { key: '4day', label: '4 Day' },
                ].map(v => (
                  <button
                    key={v.key}
                    onClick={() => setViewMode(v.key)}
                    className={`px-3 py-1.5 text-sm font-body font-body-medium spa-transition-fast ${
                      viewMode === v.key
                        ? 'bg-primary text-white'
                        : 'text-text-primary hover:bg-background'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Main content area: Sidebar + Grid */}
          <div className="flex flex-1 min-h-0">
            {/* Left sidebar: Mini calendar + Legend */}
            <div className="w-52 flex-shrink-0 border-r border-border bg-surface p-3 flex flex-col overflow-y-auto sidebar-scroll">
              <MiniMonthCalendar
                selectedDate={currentDate}
                onDateSelect={setCurrentDate}
              />

              {/* View By toggle */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                  View By
                </div>
                <div className="flex border border-border rounded-spa overflow-hidden">
                  <button
                    onClick={() => setColumnMode('therapist')}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-body font-body-medium spa-transition-fast ${
                      columnMode === 'therapist'
                        ? 'bg-primary text-white'
                        : 'text-text-primary hover:bg-background'
                    }`}
                  >
                    <Icon name="User" size={12} />
                    <span>Therapist</span>
                  </button>
                  <button
                    onClick={() => setColumnMode('room')}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-body font-body-medium spa-transition-fast border-l border-border ${
                      columnMode === 'room'
                        ? 'bg-primary text-white'
                        : 'text-text-primary hover:bg-background'
                    }`}
                  >
                    <Icon name="DoorOpen" size={12} />
                    <span>Room</span>
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                  Status
                </div>
                <StatusLegend showPayment compact />
              </div>

              {/* Drag hint */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                  Tip
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Drag unpaid bookings to reschedule. Paid and completed bookings are locked.
                </p>
              </div>

              {/* Resource count */}
              {calendarData && (
                <div className="mt-4 pt-4 border-t border-border">
                  {columnMode === 'therapist' ? (
                    <>
                      <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                        Therapists
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-text-primary font-body">
                        <Icon name="Users" size={14} className="text-text-secondary" />
                        <span>{calendarData.therapists.length} active</span>
                      </div>
                      {Object.keys(attendanceMap).length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {Object.entries(attendanceMap).map(([tid, status]) => {
                            const t = calendarData.therapists.find(th => th.id === tid);
                            if (!t) return null;
                            return (
                              <div key={tid} className="flex items-center gap-1.5 text-xs text-text-secondary">
                                <span className={`w-1.5 h-1.5 rounded-full ${status === 'Absent' ? 'bg-error' : 'bg-warning'}`} />
                                <span className="truncate">{t.name}</span>
                                <span className="opacity-60">({status})</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                        Rooms
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-text-primary font-body">
                        <Icon name="DoorOpen" size={14} className="text-text-secondary" />
                        <span>{calendarData.rooms?.length || 0} active</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Calendar grid */}
            <div className="flex-1 overflow-hidden">
              {calendarData ? (
                <CalendarGrid
                  therapists={calendarData.therapists}
                  rooms={calendarData.rooms || []}
                  bookings={calendarData.bookings}
                  branchHours={calendarData.branchHours}
                  attendanceMap={attendanceMap}
                  onBookingClick={handleBookingClick}
                  currentDate={currentDate}
                  viewMode={viewMode}
                  columnMode={columnMode}
                  activeDragId={activeDragId}
                  gridRef={gridRef}
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
          </div>
        </div>

        {/* Drag overlay for visual feedback */}
        <DragOverlay>
          {activeDragBooking && (() => {
            // Calculate preview time based on hovered slot
            const duration = activeDragBooking.serviceDuration ||
              (activeDragBooking.startTime && activeDragBooking.endTime
                ? (() => {
                    const [sh, sm] = activeDragBooking.startTime.split(':').map(Number);
                    const [eh, em] = activeDragBooking.endTime.split(':').map(Number);
                    return (eh * 60 + em) - (sh * 60 + sm);
                  })()
                : 60);

            const previewStartTime = overSlotData
              ? formatTimeFromSlot(overSlotData.hour, overSlotData.minute)
              : activeDragBooking.startTime?.slice(0, 5) || '';

            const previewEndTime = overSlotData
              ? calculateEndTime(overSlotData.hour, overSlotData.minute, duration)
              : activeDragBooking.endTime?.slice(0, 5) || '';

            return (
              <div className="bg-white rounded-md border-2 border-primary shadow-lg px-3 py-2 opacity-95 min-w-[140px]">
                {/* Time display - prominent */}
                <div className="font-data text-sm font-semibold text-text-primary mb-1">
                  {previewStartTime} – {previewEndTime}
                </div>
                <div className="font-body font-semibold text-xs text-text-primary">
                  {activeDragBooking.customerName}
                </div>
                <div className="font-body text-[11px] text-text-secondary">
                  {activeDragBooking.serviceName}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-caption text-[10px] text-text-secondary">
                    {duration} mins
                  </span>
                  {overSlotData && (
                    <span className="font-caption text-[10px] text-primary font-medium">
                      Drop here
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </DragOverlay>
      </DndContext>

      {/* Modal loading overlay */}
      {modalOpen && modalLoading && (
        <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-surface rounded-spa-lg spa-shadow-modal p-12 text-center animate-fade-in">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body font-body-normal text-text-secondary">Loading booking...</p>
          </div>
        </div>
      )}

      {/* Booking Action Modal */}
      <BookingActionModal
        isOpen={modalOpen && !modalLoading && !!selectedBooking}
        onClose={handleModalClose}
        booking={selectedBooking}
        therapists={therapistsForModal}
        onUpdateStatus={handleStatusUpdate}
        onAssignTherapist={handleAssignTherapist}
        onRecordPayment={handleRecordPayment}
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
    </>
  );
};

export default OperationalCalendar;
