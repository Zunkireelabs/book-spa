import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import FullCalendar from '@fullcalendar/react';
import resourceTimelinePlugin from '@fullcalendar/resource-timeline';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import Icon from '../../../components/AppIcon';
import BookingActionModal from '../../../components/ui/BookingActionModal';
import {
  getCalendarBookings,
  fetchBookingById,
  updateBookingStatus,
  assignTherapist,
  recordPayment,
  fetchAttendance,
} from '../../../services/api';
import { transformBooking, toDbStatus } from '../../../services/bookingTransformers';
import StatusLegend from '../../../components/ui/StatusLegend';

// ── Status → Color mapping ──────────────────────────────────
const STATUS_COLORS = {
  'Pending':     { bg: '#f59e0b', text: '#fff' },
  'Confirmed':   { bg: '#3b82f6', text: '#fff' },
  'In-Progress': { bg: '#6366f1', text: '#fff' },
  'Completed':   { bg: '#22c55e', text: '#fff' },
  'No Show':     { bg: '#991b1b', text: '#fff' },
};

const UNPAID_BORDER = '#facc15';

// ── Helpers ──────────────────────────────────────────────────

function formatTimeForFC(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  return `${parts[0].padStart(2, '0')}:${(parts[1] || '00').padStart(2, '0')}:00`;
}

function buildDatetime(date, time) {
  if (!date || !time) return null;
  return `${date}T${time}`;
}

// ── Component ────────────────────────────────────────────────

const OperationalCalendar = ({ branchId }) => {
  const { profile } = useAuth();
  const calendarRef = useRef(null);

  // Calendar data state
  const [calendarData, setCalendarData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentRange, setCurrentRange] = useState(null);

  // Attendance indicators: { [therapistId]: 'Absent' | 'Leave' | ... }
  const [attendanceMap, setAttendanceMap] = useState({});

  // In-page modal state
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [actionToast, setActionToast] = useState(null);

  // ── Calendar data fetching ──────────────────────────────────

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

    // Build attendance map for resource labels
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

  useEffect(() => {
    if (!branchId) return;
    const today = new Date().toISOString().split('T')[0];
    fetchData(today, today);
  }, [branchId, fetchData]);

  const handleDatesSet = useCallback((dateInfo) => {
    const start = dateInfo.startStr.split('T')[0];
    const end = dateInfo.endStr.split('T')[0];

    const rangeKey = `${start}_${end}`;
    if (currentRange === rangeKey) return;
    setCurrentRange(rangeKey);

    fetchData(start, end);
  }, [fetchData, currentRange]);

  // Refresh calendar using the last known range
  const refreshCalendar = useCallback(() => {
    if (!currentRange) return;
    const [start, end] = currentRange.split('_');
    fetchData(start, end);
  }, [currentRange, fetchData]);

  // ── Event click → open in-page modal ────────────────────────

  const handleEventClick = useCallback(async (clickInfo) => {
    const bookingId = clickInfo.event.extendedProps.bookingId;
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
    // Refresh calendar to reflect any changes made in the modal
    refreshCalendar();
  }, [refreshCalendar]);

  // ── Action handlers (called from BookingActionModal) ────────

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

  const handleAssignTherapist = async (bookingId, therapistIds, notes, roomId) => {
    const result = await assignTherapist({ bookingId, therapistIds, roomId });
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

  // ── Build resources & events ────────────────────────────────

  const resources = calendarData
    ? [
        { id: 'unassigned', title: 'Unassigned' },
        ...calendarData.therapists.map((t) => ({
          id: t.id,
          title: t.name,
        })),
      ]
    : [];

  const therapistsForModal = calendarData
    ? calendarData.therapists
        .filter((t) => !attendanceMap[t.id])
        .map((t) => ({
          id: t.id,
          name: t.name,
          gender: t.gender,
          specialties: t.specialties || [],
        }))
    : [];

  const resourceIdSet = calendarData
    ? new Set(calendarData.therapists.map((t) => t.id))
    : new Set();

  const events = calendarData
    ? calendarData.bookings.flatMap((b) => {
        const statusColor = STATUS_COLORS[b.status] || STATUS_COLORS['Pending'];
        const start = b.start_datetime || buildDatetime(b.date, b.start_time);
        const end = b.end_datetime || buildDatetime(b.date, b.end_time);

        // Place events by the assigned therapist(s) from the booking_therapists
        // junction — the same source the detail popover reads — so the column
        // always matches the popover. Only place into lanes that actually exist
        // as resources (a therapist may be inactive or filtered out); otherwise
        // fall back to the legacy therapist_id column, then the Unassigned lane.
        // This guarantees every booking renders somewhere and is never dropped.
        // Multi-therapist bookings render one event per assigned lane.
        const junctionIds = (b.booking_therapists || [])
          .map((bt) => bt.therapist_id)
          .filter((id) => id && resourceIdSet.has(id));
        let resourceIds;
        if (junctionIds.length > 0) {
          resourceIds = junctionIds;
        } else if (b.therapist_id && resourceIdSet.has(b.therapist_id)) {
          resourceIds = [b.therapist_id];
        } else {
          resourceIds = ['unassigned'];
        }

        const base = {
          start,
          end,
          title: `${b.customer_name} — ${b.service?.name || 'Service'}`,
          backgroundColor: statusColor.bg,
          textColor: statusColor.text,
          borderColor: b.payment_status === 'unpaid' ? UNPAID_BORDER : statusColor.bg,
          extendedProps: {
            bookingId: b.id,
            bookingNumber: b.booking_number,
            customerName: b.customer_name,
            serviceName: b.service?.name,
            status: b.status,
            paymentStatus: b.payment_status,
            isLocked: b.is_locked || false,
            startTime: b.start_time,
            endTime: b.end_time,
          },
        };

        return resourceIds.map((resourceId) => ({
          ...base,
          id: `${b.id}::${resourceId}`,
          resourceId,
        }));
      })
    : [];

  const slotMinTime = calendarData
    ? formatTimeForFC(calendarData.branchHours.openTime) || '09:00:00'
    : '09:00:00';
  const slotMaxTime = calendarData
    ? formatTimeForFC(calendarData.branchHours.closeTime) || '21:00:00'
    : '21:00:00';

  // ── Renderers ───────────────────────────────────────────────

  const renderEventContent = (eventInfo) => {
    const props = eventInfo.event.extendedProps;
    const isUnpaid = props.paymentStatus === 'unpaid';
    const isLocked = props.isLocked;

    return (
      <div className="group/evt relative px-1.5 py-0.5 text-xs leading-tight overflow-visible">
        <div className="font-semibold truncate">{props.customerName}</div>
        <div className="truncate opacity-90">{props.serviceName}</div>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {isUnpaid && (
            <span className="inline-flex items-center gap-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-300" />
              <span className="text-[10px] opacity-80">Unpaid</span>
            </span>
          )}
          {isLocked && (
            <span className="inline-flex items-center gap-0.5">
              <span className="text-[10px] opacity-80">🔒</span>
            </span>
          )}
        </div>

        {/* Instant hover tooltip */}
        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-[9999] opacity-0 group-hover/evt:opacity-100 transition-opacity duration-100 w-48">
          <div className="bg-gray-900 text-white rounded-md px-3 py-2 text-[11px] leading-relaxed shadow-lg">
            <div className="font-semibold mb-0.5">{props.customerName}</div>
            <div className="opacity-80">{props.serviceName}</div>
            {props.startTime && props.endTime && (
              <div className="opacity-80 mt-0.5">{props.startTime} – {props.endTime}</div>
            )}
            <div className="flex items-center justify-between mt-1 pt-1 border-t border-white/20">
              <span className="capitalize">{props.status}</span>
              <span className={isUnpaid ? 'text-yellow-300' : 'text-green-300'}>
                {isUnpaid ? 'Unpaid' : 'Paid'}
              </span>
            </div>
            {isLocked && (
              <div className="text-amber-300 mt-0.5">🔒 Day Closed</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderResourceLabel = (resourceInfo) => {
    const isUnassigned = resourceInfo.resource.id === 'unassigned';
    const attStatus = attendanceMap[resourceInfo.resource.id];
    return (
      <div className={`flex items-center space-x-2 py-1 ${isUnassigned ? 'text-warning' : 'text-text-primary'}`}>
        <Icon
          name={isUnassigned ? 'AlertCircle' : 'User'}
          size={14}
          className={isUnassigned ? 'text-warning' : 'text-text-secondary'}
        />
        <span className={`font-body text-sm ${isUnassigned ? 'font-body-medium italic' : 'font-body-normal'}`}>
          {resourceInfo.resource.title}
        </span>
        {attStatus === 'Absent' && (
          <span className="w-2 h-2 rounded-full bg-error flex-shrink-0" title="Absent" />
        )}
        {attStatus === 'Leave' && (
          <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" title="On Leave" />
        )}
      </div>
    );
  };

  // ── Error state ─────────────────────────────────────────────

  if (error && !calendarData) {
    return (
      <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border p-8">
        <div className="text-center py-8">
          <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary mb-2">
            Failed to Load Calendar
          </h3>
          <p className="font-body font-body-normal text-text-secondary mb-4">{error}</p>
          <button
            onClick={() => {
              const today = new Date().toISOString().split('T')[0];
              fetchData(today, today);
            }}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-primary text-white rounded-spa font-body font-body-medium text-sm hover:bg-primary/90 spa-transition-fast"
          >
            <Icon name="RefreshCw" size={16} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────

  return (
    <>
      <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border overflow-hidden">
        {/* Legend */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-background/50">
          <StatusLegend showPayment />
          {loading && (
            <div className="flex items-center space-x-2 text-text-secondary">
              <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
              <span className="font-caption font-caption-normal text-xs">Loading...</span>
            </div>
          )}
        </div>

        {/* Calendar */}
        <div className="bookspa-calendar">
          <FullCalendar
            ref={calendarRef}
            schedulerLicenseKey="CC-Attribution-NonCommercial-NoDerivatives"
            plugins={[resourceTimelinePlugin, dayGridPlugin, interactionPlugin]}
            initialView="resourceTimelineDay"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'resourceTimelineDay,resourceTimelineFourDay,resourceTimelineWeek,dayGridMonth',
            }}
            views={{
              resourceTimelineFourDay: {
                type: 'resourceTimeline',
                duration: { days: 4 },
                buttonText: '4 Day',
              },
            }}
            resources={resources}
            resourceAreaHeaderContent="Therapist"
            resourceAreaWidth="180px"
            resourceLabelContent={renderResourceLabel}
            events={events}
            eventContent={renderEventContent}
            eventClick={handleEventClick}
            slotMinTime={slotMinTime}
            slotMaxTime={slotMaxTime}
            slotDuration="00:30:00"
            slotLabelInterval="01:00:00"
            editable={false}
            eventStartEditable={false}
            eventDurationEditable={false}
            eventResourceEditable={false}
            selectable={false}
            datesSet={handleDatesSet}
            height="auto"
            expandRows={true}
            stickyHeaderDates={true}
            nowIndicator={true}
            locale="en-gb"
            firstDay={0}
            buttonText={{
              today: 'Today',
              day: 'Day',
              week: 'Week',
              month: 'Month',
            }}
          />
        </div>
      </div>

      {/* In-page Booking Action Modal */}
      {modalOpen && modalLoading && (
        <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-surface rounded-spa-lg spa-shadow-modal p-12 text-center animate-fade-in">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body font-body-normal text-text-secondary">Loading booking...</p>
          </div>
        </div>
      )}

      <BookingActionModal
        isOpen={modalOpen && !modalLoading && !!selectedBooking}
        onClose={handleModalClose}
        booking={selectedBooking}
        therapists={therapistsForModal}
        onUpdateStatus={handleStatusUpdate}
        onAssignTherapist={handleAssignTherapist}
        onRecordPayment={handleRecordPayment}
        userRole={profile?.role || 'staff'}
      />

      {/* Toast notification */}
      {actionToast && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2 ${
          actionToast.type === 'error' ? 'bg-error text-white' : 'bg-success text-white'
        }`}>
          <Icon name={actionToast.type === 'error' ? 'AlertCircle' : 'CheckCircle'} size={16} />
          <span className="font-body font-body-medium text-sm">{actionToast.msg}</span>
        </div>
      )}
    </>
  );
};

export default OperationalCalendar;
