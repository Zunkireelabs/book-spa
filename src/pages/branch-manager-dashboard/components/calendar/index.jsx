import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import BookingActionModal from '../../../../components/ui/BookingActionModal';
import StatusLegend from '../../../../components/ui/StatusLegend';
import MiniMonthCalendar from './MiniMonthCalendar';
import CalendarGrid from './CalendarGrid';
import {
  getCalendarBookings,
  fetchBookingById,
  updateBookingStatus,
  assignTherapist,
  recordPayment,
  fetchAttendance,
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

// ── Component ────────────────────────────────────────────────

const OperationalCalendar = ({ branchId, heightOffset = 140 }) => {
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
      <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border p-8">
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
      <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border overflow-hidden flex flex-col" style={{ height: `calc(100vh - ${heightOffset}px)` }}>
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

          {/* Center: Date title */}
          <h2 className="font-heading font-heading-semibold text-base text-text-primary">
            {formatDateTitle(currentDate, viewMode)}
          </h2>

          {/* Right: View toggle + loading */}
          <div className="flex items-center space-x-3">
            {loading && (
              <div className="flex items-center space-x-1.5 text-text-secondary">
                <div className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />
                <span className="font-caption text-xs">Loading...</span>
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
          <div className="flex-1 min-w-0">
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
