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
  fetchServices,
  createBooking,
} from '../../../../services/api';
import { transformBooking, toDbStatus } from '../../../../services/bookingTransformers';
import CustomSelect from '../../../../components/ui/CustomSelect';

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

// ── Quick Create Panel ────────────────────────────────────────

const QuickCreatePanel = ({ slotInfo, services, servicesLoading, onClose, onSubmit }) => {
  const [serviceId, setServiceId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);

  // Reset form when slot changes
  useEffect(() => {
    setServiceId('');
    setCustomerName('');
    setCustomerPhone('');
    setSpecialRequests('');
    setError(null);
    setSubmitting(false);
  }, [slotInfo]);

  // Autofocus name field when panel opens
  useEffect(() => {
    if (slotInfo && nameRef.current) {
      const timer = setTimeout(() => nameRef.current?.focus(), 350);
      return () => clearTimeout(timer);
    }
  }, [slotInfo]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!serviceId || !customerName.trim()) return;
    setSubmitting(true);
    setError(null);
    const err = await onSubmit({
      serviceId,
      customerName: customerName.trim(),
      customerPhone: customerPhone.replace(/\D/g, '') || null,
      specialRequests: specialRequests.trim() || null,
    });
    if (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  const isOpen = !!slotInfo;
  const timeStr = slotInfo
    ? `${String(slotInfo.hour).padStart(2, '0')}:${String(slotInfo.minute).padStart(2, '0')}`
    : '';
  const dateDisplay = slotInfo
    ? new Date(slotInfo.day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-text-primary/20 z-sidebar transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[400px] z-modal bg-surface border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-background/50">
          <div className="flex items-center gap-2">
            <Icon name="CalendarPlus" size={20} className="text-primary" />
            <h3 className="font-heading font-heading-semibold text-base text-text-primary">Quick Booking</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
            <Icon name="X" size={18} className="text-text-secondary" />
          </button>
        </div>

        {/* Context banner */}
        {slotInfo && (
          <div className="px-5 py-3 bg-primary/5 border-b border-border">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <Icon name="Calendar" size={14} className="text-primary" />
                <span className="font-body font-body-medium text-text-primary">{dateDisplay}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Icon name="Clock" size={14} className="text-primary" />
                <span className="font-body font-body-medium text-text-primary">{timeStr}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Icon name={slotInfo.colType === 'room' ? 'DoorOpen' : slotInfo.colType === 'therapist' ? 'User' : 'LayoutGrid'} size={14} className="text-text-secondary" />
              <span className="font-body text-sm text-text-secondary">{slotInfo.colName}</span>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-y-auto">
          <div className="px-5 py-4 space-y-4 flex-1">
            {/* Service */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
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
                      label: `${s.name} — ${s.duration_minutes}min — Rs.${s.price_npr}`,
                    })),
                  ]}
                  placeholder="Select a service"
                  size="md"
                />
              )}
            </div>

            {/* Customer name */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Customer Name <span className="text-error">*</span>
              </label>
              <input
                ref={nameRef}
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                placeholder="Enter customer name"
                className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Phone
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 py-2 text-sm border border-r-0 border-border rounded-l-spa bg-background text-text-secondary">
                  +977
                </span>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="98XXXXXXXX"
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-r-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            {/* Special requests */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
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
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-border bg-background/50 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !serviceId || !customerName.trim()}
              className="px-4 py-2 text-sm font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />}
              {submitting ? 'Creating...' : 'Create Booking'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

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
  const [dragGrabOffset, setDragGrabOffset] = useState(0); // Y offset from card top where user grabbed

  // Cross-column reassignment confirmation
  // Shape: { booking, bookingId, newDate, newStartTime, newEndTime, targetColId, targetColName, sourceColName, type: 'therapist'|'room', durationMinutes }
  const [pendingReassign, setPendingReassign] = useState(null);

  // Quick-create panel state
  const [quickCreateSlot, setQuickCreateSlot] = useState(null);
  const [servicesCache, setServicesCache] = useState(null);
  const [servicesLoading, setServicesLoading] = useState(false);

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
    // Subtract dragGrabOffset so the card's TOP edge aligns with the time slot
    // (not the cursor position which could be anywhere on the card)
    const relativeY = pointerYRef.current - gridRect.top - dragGrabOffset;

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
  }, [dragGrabOffset]);

  // ── Drag and Drop Handlers ────────────────────────────────

  const handleDragStart = useCallback((event) => {
    const { active, activatorEvent } = event;
    setActiveDragId(active.id);

    const booking = active.data.current?.booking;
    if (booking) {
      setActiveDragBooking(booking);
    }

    // Calculate how far down the card the user grabbed
    // This offset is used to align the card's TOP edge with the time slot
    const cursorY = activatorEvent?.clientY ?? 0;

    // Calculate expected card top position based on booking's start time
    // This is more reliable than trying to get the DOM element's position
    if (booking?.startTime && gridRef.current) {
      const gridRect = gridRef.current.getBoundingClientRect();
      const openHour = parseInt(gridRef.current.dataset?.openHour || '9', 10);
      const hourHeight = parseInt(gridRef.current.dataset?.hourHeight || '120', 10);

      const [bookingHour, bookingMinute] = booking.startTime.split(':').map(Number);
      const minutesFromOpen = (bookingHour - openHour) * 60 + bookingMinute;
      const expectedCardTop = gridRect.top + (minutesFromOpen / 60) * hourHeight;

      const grabOffset = cursorY - expectedCardTop;
      setDragGrabOffset(grabOffset);
    } else {
      setDragGrabOffset(0);
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

  // Build column name lookup maps for confirmation dialog
  const colNameMap = useMemo(() => {
    const map = { unassigned: 'Unassigned' };
    if (calendarData?.therapists) {
      for (const t of calendarData.therapists) map[t.id] = t.name;
    }
    if (calendarData?.rooms) {
      for (const r of calendarData.rooms) map[r.id] = r.name;
    }
    return map;
  }, [calendarData]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;

    // Capture final position before clearing state
    const finalTimeData = over?.data?.current ? calculateTimeFromPointer(over.data.current) : null;

    // If not dropped on a valid target, just clear state
    if (!over || !active.data.current?.booking || !finalTimeData) {
      setActiveDragId(null);
      setActiveDragBooking(null);
      setOverSlotData(null);
      setDragGrabOffset(0);
      return;
    }

    const booking = active.data.current.booking;
    const { day: newDate, colId: targetColId, hour, minute } = finalTimeData;

    if (hour === undefined || minute === undefined) {
      setActiveDragId(null);
      setActiveDragBooking(null);
      setOverSlotData(null);
      setDragGrabOffset(0);
      return;
    }

    const newStartTime = formatTimeFromSlot(hour, minute);
    const bookingId = booking.bookingId || booking.id;

    // Determine source column based on column mode
    const sourceColId = columnMode === 'therapist'
      ? (booking.therapistId || 'unassigned')
      : (booking.roomId || 'unassigned');
    const effectiveTargetColId = targetColId || 'unassigned';

    const isCrossColumn = sourceColId !== effectiveTargetColId;

    // Check if anything actually changed
    const oldTime = booking.startTime?.slice(0, 5);
    const oldDate = booking.date;
    if (oldTime === newStartTime && oldDate === newDate && !isCrossColumn) {
      setActiveDragId(null);
      setActiveDragBooking(null);
      setOverSlotData(null);
      setDragGrabOffset(0);
      return; // No change
    }

    // Calculate new end time
    const durationMinutes = booking.serviceDuration ||
      (booking.startTime && booking.endTime
        ? (() => {
            const [sh, sm] = booking.startTime.split(':').map(Number);
            const [eh, em] = booking.endTime.split(':').map(Number);
            return (eh * 60 + em) - (sh * 60 + sm);
          })()
        : 60);
    const newEndTime = calculateEndTime(hour, minute, durationMinutes);

    // Clear drag state
    setActiveDragId(null);
    setActiveDragBooking(null);
    setOverSlotData(null);
    setDragGrabOffset(0);

    if (isCrossColumn) {
      // Cross-column drop → show confirmation dialog
      setPendingReassign({
        booking,
        bookingId,
        newDate,
        newStartTime,
        newEndTime,
        durationMinutes,
        targetColId: effectiveTargetColId,
        sourceColId,
        targetColName: colNameMap[effectiveTargetColId] || effectiveTargetColId,
        sourceColName: colNameMap[sourceColId] || sourceColId,
        type: columnMode,
        timeChanged: oldTime !== newStartTime || oldDate !== newDate,
      });
    } else {
      // Same column — time-only reschedule (existing behavior, no confirmation)
      executeReschedule({ booking, bookingId, newDate, newStartTime, newEndTime, durationMinutes });
    }
  }, [refreshCalendar, calculateTimeFromPointer, columnMode, colNameMap]);

  // Execute reschedule with optimistic update (time-only, no column change)
  const executeReschedule = useCallback(async ({ bookingId, newDate, newStartTime, newEndTime, durationMinutes }) => {
    // Optimistic UI update
    setCalendarData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        bookings: prev.bookings.map(b => {
          if (b.id === bookingId) {
            return { ...b, date: newDate, start_time: newStartTime, end_time: newEndTime };
          }
          return b;
        }),
      };
    });

    setIsRescheduling(true);
    try {
      const result = await rescheduleBooking({ bookingId, newDate, newStartTime });
      if (result.error) {
        showToast(result.error.message || 'Failed to reschedule booking.', 'error');
        refreshCalendar();
      } else {
        showToast(`Rescheduled to ${newStartTime}`, 'success');
      }
    } catch (err) {
      showToast('An error occurred while rescheduling.', 'error');
      refreshCalendar();
    } finally {
      setIsRescheduling(false);
    }
  }, [refreshCalendar]);

  // Handle cross-column reassignment confirmation
  const handleConfirmReassign = useCallback(async () => {
    if (!pendingReassign) return;

    const { bookingId, newDate, newStartTime, newEndTime, targetColId, type, targetColName } = pendingReassign;

    // Build API params
    const apiParams = { bookingId, newDate, newStartTime };
    const optimisticFields = { date: newDate, start_time: newStartTime, end_time: newEndTime };

    if (type === 'therapist') {
      const therapistVal = targetColId === 'unassigned' ? null : targetColId;
      apiParams.newTherapistId = targetColId === 'unassigned' ? 'unassigned' : targetColId;
      optimisticFields.therapist_id = therapistVal;
    } else {
      const roomVal = targetColId === 'unassigned' ? null : targetColId;
      apiParams.newRoomId = targetColId === 'unassigned' ? 'unassigned' : targetColId;
      optimisticFields.room_id = roomVal;
    }

    // Optimistic UI update
    setCalendarData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        bookings: prev.bookings.map(b => {
          if (b.id === bookingId) {
            return { ...b, ...optimisticFields };
          }
          return b;
        }),
      };
    });

    setPendingReassign(null);
    setIsRescheduling(true);

    try {
      const result = await rescheduleBooking(apiParams);
      if (result.error) {
        showToast(result.error.message || 'Failed to reassign booking.', 'error');
        refreshCalendar();
      } else {
        showToast(`Reassigned to ${targetColName}`, 'success');
      }
    } catch (err) {
      showToast('An error occurred while reassigning.', 'error');
      refreshCalendar();
    } finally {
      setIsRescheduling(false);
    }
  }, [pendingReassign, refreshCalendar]);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setActiveDragBooking(null);
    setOverSlotData(null);
    setDragGrabOffset(0);
  }, []);

  // ── Quick-create handlers ──────────────────────────────────

  const handleEmptySlotClick = useCallback(async (slotInfo) => {
    setQuickCreateSlot(slotInfo);
    if (!servicesCache && !servicesLoading) {
      setServicesLoading(true);
      const result = await fetchServices();
      if (result.data) setServicesCache(result.data);
      setServicesLoading(false);
    }
  }, [servicesCache, servicesLoading]);

  const handleQuickCreateClose = useCallback(() => {
    setQuickCreateSlot(null);
  }, []);

  const handleQuickCreateSubmit = useCallback(async (formData) => {
    if (!quickCreateSlot || !branchId) return 'Missing slot or branch info.';
    const date = quickCreateSlot.day;
    const startTime = `${String(quickCreateSlot.hour).padStart(2, '0')}:${String(quickCreateSlot.minute).padStart(2, '0')}`;
    const result = await createBooking({
      branchId,
      serviceId: formData.serviceId,
      date,
      startTime,
      customerName: formData.customerName,
      customerPhone: formData.customerPhone,
      specialRequests: formData.specialRequests,
    });
    if (result.error) {
      return result.error.message || 'Failed to create booking.';
    }
    showToast('Booking created successfully');
    setQuickCreateSlot(null);
    refreshCalendar();
    return null;
  }, [quickCreateSlot, branchId, refreshCalendar]);

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
                  onEmptySlotClick={handleEmptySlotClick}
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

      {/* Quick Create Panel */}
      <QuickCreatePanel
        slotInfo={quickCreateSlot}
        services={servicesCache}
        servicesLoading={servicesLoading}
        onClose={handleQuickCreateClose}
        onSubmit={handleQuickCreateSubmit}
      />

      {/* Reassignment Confirmation Dialog */}
      {pendingReassign && (
        <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-surface rounded-spa-lg spa-shadow-modal p-6 max-w-sm w-full animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <Icon name={pendingReassign.type === 'therapist' ? 'UserCheck' : 'DoorOpen'} size={20} className="text-primary" />
              <h3 className="font-heading font-heading-semibold text-base text-text-primary">
                Reassign {pendingReassign.type === 'therapist' ? 'Therapist' : 'Room'}
              </h3>
            </div>
            <p className="font-body text-sm text-text-secondary mb-1">
              Move <span className="font-semibold text-text-primary">{pendingReassign.booking.customerName}</span>
            </p>
            <p className="font-body text-sm text-text-secondary mb-3">
              from <span className="font-semibold text-text-primary">{pendingReassign.sourceColName}</span>
              {' '}&rarr;{' '}
              <span className="font-semibold text-text-primary">{pendingReassign.targetColName}</span>
            </p>
            {pendingReassign.timeChanged && (
              <p className="font-body text-xs text-text-secondary mb-3">
                Time: {formatTimeDisplay(pendingReassign.newStartTime)} – {formatTimeDisplay(pendingReassign.newEndTime)}
                {pendingReassign.newDate !== pendingReassign.booking.date && (
                  <span> on {pendingReassign.newDate}</span>
                )}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setPendingReassign(null)}
                className="px-4 py-2 text-sm font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReassign}
                className="px-4 py-2 text-sm font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OperationalCalendar;
