import React, { useMemo, useRef, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import Icon from '../../../../components/AppIcon';
import CalendarBookingCard from './CalendarBookingCard';

// Export these constants for time calculation in parent
export const SLOT_HEIGHT = 60; // px per 30-min slot (120px per hour) - for visual grid lines
export const HOUR_HEIGHT = SLOT_HEIGHT * 2; // 120px per hour
const TIME_COL_WIDTH = 64;

function addDaysToStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Single droppable column component (replaces 144 tiny zones per column)
// Note: This is a sibling to booking cards, not a parent, so pointerEvents doesn't block them
const DroppableColumn = ({ id, data, height, isActive }) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data,
  });

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-0 transition-colors duration-100 ${
        isOver && isActive ? 'bg-primary/5' : ''
      }`}
      style={{
        height,
        // Only capture pointer events when actively dragging
        pointerEvents: isActive ? 'auto' : 'none',
      }}
    />
  );
};

const CalendarGrid = ({
  therapists,
  rooms = [],
  bookings,
  branchHours,
  attendanceMap,
  onBookingClick,
  currentDate,
  viewMode = 'day',
  columnMode = 'therapist',
  activeDragId = null,
  gridRef, // Ref to get grid position for time calculation
}) => {
  const scrollRef = useRef(null);
  const gridBodyRef = useRef(null);

  // Expose grid body ref to parent for position calculation
  useEffect(() => {
    if (gridRef) {
      gridRef.current = gridBodyRef.current;
    }
  }, [gridRef]);

  const openHour = useMemo(() => {
    const [h] = (branchHours?.openTime || '09:00:00').split(':').map(Number);
    return h;
  }, [branchHours]);

  const closeHour = useMemo(() => {
    const [h, m] = (branchHours?.closeTime || '21:00:00').split(':').map(Number);
    return m > 0 ? h + 1 : h;
  }, [branchHours]);

  const hours = useMemo(() => {
    const result = [];
    for (let h = openHour; h < closeHour; h++) result.push(h);
    return result;
  }, [openHour, closeHour]);

  const totalHeight = hours.length * HOUR_HEIGHT;

  const days = useMemo(() => {
    if (viewMode === '4day') return [0, 1, 2, 3].map(i => addDaysToStr(currentDate, i));
    return [currentDate];
  }, [currentDate, viewMode]);

  const isMultiDay = days.length > 1;

  // ── Build columns based on mode ──────────────────────────
  const columns = useMemo(() => {
    if (columnMode === 'room') {
      const cols = rooms.map(r => ({
        id: r.id,
        name: r.name,
        type: 'room',
        icon: 'DoorOpen',
        subtitle: null,
        attendance: null,
      }));
      cols.push({ id: 'unassigned', name: 'No Room', type: 'unassigned', icon: 'AlertCircle', subtitle: null, attendance: null });
      return cols;
    }
    // therapist mode
    const cols = therapists.map(t => ({
      id: t.id,
      name: t.name,
      type: 'therapist',
      icon: 'User',
      subtitle: t.gender,
      attendance: attendanceMap[t.id],
    }));
    cols.push({ id: 'unassigned', name: 'Unassigned', type: 'unassigned', icon: 'AlertCircle', subtitle: null, attendance: null });
    return cols;
  }, [therapists, rooms, attendanceMap, columnMode]);

  // ── Group bookings by day and column ─────────────────────
  const bookingsByDayAndCol = useMemo(() => {
    const map = {};
    days.forEach(day => {
      map[day] = {};
      columns.forEach(c => { map[day][c.id] = []; });
    });

    // Build lookup maps for complementary info
    const therapistMap = {};
    therapists.forEach(t => { therapistMap[t.id] = t.name; });
    const roomMap = {};
    rooms.forEach(r => { roomMap[r.id] = r.name; });

    bookings.forEach(b => {
      const colId = columnMode === 'room'
        ? (b.room_id || 'unassigned')
        : (b.therapist_id || 'unassigned');
      const bookingDate = b.date || (b.start_datetime ? b.start_datetime.split('T')[0] : null);
      if (!bookingDate || !map[bookingDate]) return;
      if (!map[bookingDate][colId]) map[bookingDate][colId] = [];

      const startTime = b.start_time || (b.start_datetime ? b.start_datetime.split('T')[1]?.slice(0, 8) : null);
      const endTime = b.end_time || (b.end_datetime ? b.end_datetime.split('T')[1]?.slice(0, 8) : null);

      map[bookingDate][colId].push({
        id: b.id,
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        customerPhone: b.customer_phone || null,
        serviceName: b.service?.name || 'Service',
        serviceDuration: b.service?.duration_minutes || null,
        status: b.status,
        paymentStatus: b.payment_status,
        isLocked: b.is_locked || false,
        startTime,
        endTime,
        date: bookingDate,
        therapistId: b.therapist_id,
        roomId: b.room_id,
        therapistName: therapistMap[b.therapist_id] || null,
        roomName: b.room?.name || roomMap[b.room_id] || null,
        baseAmount: b.base_amount,
        discountAmount: b.discount_amount,
        finalAmount: b.final_amount,
        specialRequests: b.special_requests || null,
      });
    });

    return map;
  }, [bookings, columns, days, columnMode, therapists, rooms]);

  // ── Position helpers ──────────────────────────────────────
  const timeToTop = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return ((h - openHour) * 60 + m) / 60 * HOUR_HEIGHT;
  };

  const timeToHeight = (startStr, endStr) => {
    if (!startStr || !endStr) return SLOT_HEIGHT;
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    return Math.max(((eh * 60 + em) - (sh * 60 + sm)) / 60 * HOUR_HEIGHT, 24);
  };

  // Current time
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const nowTop = timeToTop(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`);

  useEffect(() => {
    if (scrollRef.current && days.includes(todayStr)) {
      scrollRef.current.scrollTop = Math.max(0, (nowTop || 0) - 200);
    }
  }, [days, todayStr, nowTop]);

  const minColWidth = isMultiDay ? 100 : 160;

  // ── Column header renderer ────────────────────────────────
  const renderColumnHeader = (col) => {
    const isUnassigned = col.type === 'unassigned';
    return (
      <div
        key={col.id}
        className="flex-1 border-r border-border last:border-r-0 px-2 py-2.5 text-center"
        style={{ minWidth: minColWidth }}
      >
        <div className={`flex items-center justify-center gap-1.5 ${isUnassigned ? 'text-warning' : 'text-text-primary'}`}>
          <Icon
            name={isUnassigned ? 'AlertCircle' : col.icon}
            size={14}
            className={isUnassigned ? 'text-warning' : 'text-text-secondary'}
          />
          <span className={`font-body text-sm whitespace-nowrap ${isUnassigned ? 'italic font-medium' : 'font-semibold'}`}>
            {col.name}
          </span>
          {col.attendance === 'Absent' && (
            <span className="w-2 h-2 rounded-full bg-error flex-shrink-0" title="Absent" />
          )}
          {col.attendance === 'Leave' && (
            <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" title="On Leave" />
          )}
        </div>
        {col.subtitle && (
          <div className="text-[10px] font-caption text-text-secondary/60 uppercase tracking-wider mt-0.5">
            {col.subtitle}
          </div>
        )}
      </div>
    );
  };

  // ── Shared renderers ──────────────────────────────────────
  const renderTimeLabels = () => (
    <div className="flex-shrink-0 border-r border-border relative bg-surface" style={{ width: TIME_COL_WIDTH }}>
      {hours.map((hour) => (
        <div key={hour} className="absolute w-full" style={{ top: (hour - openHour) * HOUR_HEIGHT }}>
          <span className="absolute -top-2.5 right-2 font-data text-[11px] text-text-secondary">
            {String(hour).padStart(2, '0')}:00
          </span>
        </div>
      ))}
    </div>
  );

  const renderGridLines = () => (
    <>
      {hours.map((hour) => {
        const top = (hour - openHour) * HOUR_HEIGHT;
        return (
          <React.Fragment key={`lines-${hour}`}>
            <div className="absolute left-0 right-0 border-t border-border" style={{ top }} />
            <div className="absolute left-0 right-0 border-t border-border/40" style={{ top: top + SLOT_HEIGHT }} />
          </React.Fragment>
        );
      })}
    </>
  );

  const renderNowIndicator = (day) => {
    if (day !== todayStr || nowTop < 0 || nowTop > totalHeight) return null;
    return (
      <div className="absolute left-0 right-0 z-dropdown pointer-events-none" style={{ top: nowTop }}>
        <div className="flex items-center">
          <div className="w-2.5 h-2.5 rounded-full bg-primary -ml-1" />
          <div className="flex-1 h-0.5 bg-primary" />
        </div>
      </div>
    );
  };

  const renderColumn = (col, day) => {
    const colBookings = (bookingsByDayAndCol[day] || {})[col.id] || [];
    const droppableId = `drop-col-${day}-${col.id}`;

    return (
      <div
        key={col.id}
        className="flex-1 relative border-r border-border/50 last:border-r-0"
        style={{ minWidth: minColWidth, height: totalHeight }}
      >
        {/* Single droppable zone for the entire column (sibling to booking cards) */}
        <DroppableColumn
          id={droppableId}
          data={{ day, colId: col.id, openHour, totalHeight }}
          height={totalHeight}
          isActive={!!activeDragId}
        />

        {/* Booking cards rendered as siblings to droppable, not children */}
        {colBookings.map(booking => (
          <CalendarBookingCard
            key={booking.id}
            booking={booking}
            columnMode={columnMode}
            style={{
              top: timeToTop(booking.startTime),
              height: timeToHeight(booking.startTime, booking.endTime),
            }}
            onClick={onBookingClick}
          />
        ))}
      </div>
    );
  };

  // ── Single-day view ───────────────────────────────────────
  const columnsMinWidth = columns.length * minColWidth;

  const renderDayView = () => (
    <div className="flex flex-col h-full overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-auto sidebar-scroll">
        {/* Sticky header inside scroll container */}
        <div className="sticky top-0 z-header bg-background border-b-2 border-border" style={{ minWidth: TIME_COL_WIDTH + columnsMinWidth }}>
          <div className="flex">
            <div className="flex-shrink-0 border-r border-border px-2 py-3 flex items-center" style={{ width: TIME_COL_WIDTH }}>
              <Icon name="Clock" size={14} className="text-text-secondary" />
            </div>
            <div className="flex" style={{ minWidth: columnsMinWidth }}>
              {columns.map(col => renderColumnHeader(col))}
            </div>
          </div>
        </div>
        {/* Grid body */}
        <div
          ref={gridBodyRef}
          className="flex relative"
          style={{ height: totalHeight, minWidth: TIME_COL_WIDTH + columnsMinWidth }}
          data-open-hour={openHour}
          data-hour-height={HOUR_HEIGHT}
        >
          {renderTimeLabels()}
          <div className="flex relative" style={{ minWidth: columnsMinWidth }}>
            {renderGridLines()}
            {renderNowIndicator(currentDate)}
            {columns.map(col => renderColumn(col, currentDate))}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Multi-day (4-day) view ────────────────────────────────
  const daysMinWidth = days.length * minColWidth;

  const renderMultiDayView = () => (
    <div className="flex flex-col h-full overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-auto sidebar-scroll">
        {/* Sticky header inside scroll container */}
        <div className="sticky top-0 z-header bg-background border-b-2 border-border" style={{ minWidth: TIME_COL_WIDTH + daysMinWidth }}>
          <div className="flex">
            <div className="flex-shrink-0 border-r border-border" style={{ width: TIME_COL_WIDTH }} />
            <div className="flex" style={{ minWidth: daysMinWidth }}>
              {days.map(day => {
                const isCurrentDay = day === todayStr;
                return (
                  <div
                    key={day}
                    className={`flex-1 text-center py-1.5 border-r border-border last:border-r-0 ${isCurrentDay ? 'bg-primary/5' : ''}`}
                    style={{ minWidth: minColWidth }}
                  >
                    <span className={`font-heading text-xs font-semibold ${isCurrentDay ? 'text-primary' : 'text-text-secondary'}`}>
                      {formatShortDate(day)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* Grid body */}
        <div
          ref={gridBodyRef}
          className="flex relative"
          style={{ height: totalHeight, minWidth: TIME_COL_WIDTH + daysMinWidth }}
          data-open-hour={openHour}
          data-hour-height={HOUR_HEIGHT}
        >
          {renderTimeLabels()}
          <div className="flex relative" style={{ minWidth: daysMinWidth }}>
            {renderGridLines()}
            {days.map((day, di) => {
              const isCurrentDay = day === todayStr;
              const dayBookings = [];
              const dayMap = bookingsByDayAndCol[day] || {};
              Object.values(dayMap).forEach(arr => dayBookings.push(...arr));
              const droppableId = `drop-col-${day}-all`;

              return (
                <div
                  key={day}
                  className={`flex-1 relative ${di < days.length - 1 ? 'border-r-2 border-border' : ''} ${isCurrentDay ? 'bg-primary/[0.02]' : ''}`}
                  style={{ minWidth: minColWidth }}
                >
                  {/* Single droppable zone for the entire day column (sibling to booking cards) */}
                  <DroppableColumn
                    id={droppableId}
                    data={{ day, colId: 'all', openHour, totalHeight }}
                    height={totalHeight}
                    isActive={!!activeDragId}
                  />

                  {/* Now indicator */}
                  {isCurrentDay && nowTop >= 0 && nowTop <= totalHeight && (
                    <div className="absolute left-0 right-0 z-dropdown pointer-events-none" style={{ top: nowTop }}>
                      <div className="flex items-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-primary -ml-1" />
                        <div className="flex-1 h-0.5 bg-primary" />
                      </div>
                    </div>
                  )}

                  {/* Booking cards rendered as siblings to droppable */}
                  {dayBookings.map(booking => (
                    <CalendarBookingCard
                      key={booking.id}
                      booking={booking}
                      columnMode={columnMode}
                      style={{
                        top: timeToTop(booking.startTime),
                        height: timeToHeight(booking.startTime, booking.endTime),
                      }}
                      onClick={onBookingClick}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  return isMultiDay ? renderMultiDayView() : renderDayView();
};

export default CalendarGrid;
