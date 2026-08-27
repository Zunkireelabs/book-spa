import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../../../../components/AppIcon';

const STATUS_COLORS = {
  'Pending':     { bg: '#f59e0b', text: '#fff', light: '#fef3c7' },
  'Confirmed':   { bg: '#3b82f6', text: '#fff', light: '#dbeafe' },
  'In-Progress': { bg: '#6366f1', text: '#fff', light: '#e0e7ff' },
  'Completed':   { bg: '#22c55e', text: '#fff', light: '#dcfce7' },
  'No Show':     { bg: '#6b7280', text: '#fff', light: '#f3f4f6' },
};

const UNPAID_BORDER = '#facc15';

// Convert "HH:MM" or "HH:MM:SS" to 12h format
function to12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

// Statuses that cannot be dragged (terminal states)
const NON_DRAGGABLE_STATUSES = ['Completed', 'Cancelled', 'No Show'];

function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatAmount(amount) {
  if (amount == null) return null;
  return Number(amount).toLocaleString('en-IN');
}

function getNepalNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
}

// Confirmed/In-Progress lock once their start time has passed; Pending stays
// movable even if overdue, since staff still need to reschedule/assign it.
function isTimeLocked(booking) {
  if (booking.status === 'Pending') return false;
  if (!booking.date || !booking.startTime) return false;
  const start = new Date(`${booking.date}T${booking.startTime}`);
  return getNepalNow() >= start;
}

// Check if booking can be dragged
function canDragBooking(booking) {
  // Cannot drag terminal statuses
  if (NON_DRAGGABLE_STATUSES.includes(booking.status)) return false;
  // Cannot drag paid bookings
  if (booking.paymentStatus === 'paid') return false;
  // Cannot drag locked bookings (day-closed)
  if (booking.isLocked) return false;
  // Cannot drag once the booking has started — status check catches an early
  // start (before the scheduled slot), isTimeLocked catches an overdue one.
  if (booking.status === 'In-Progress') return false;
  if (isTimeLocked(booking)) return false;
  return true;
}

const CalendarBookingCard = ({ booking, style, onClick, columnMode = 'therapist', onResize, isSelected = false, onSelect }) => {
  const colors = STATUS_COLORS[booking.status] || STATUS_COLORS['Pending'];
  const isUnpaid = booking.paymentStatus === 'unpaid';
  const isPaid = booking.paymentStatus === 'paid';
  const isDraggable = canDragBooking(booking);
  // status check catches a service started before its scheduled slot, which
  // isTimeLocked (wall-clock vs. scheduled start) would otherwise miss.
  const isLocked = booking.isLocked || booking.status === 'In-Progress' || isTimeLocked(booking);

  const cardRef = useRef(null);
  const [showPopover, setShowPopover] = useState(false);
  const [popoverPos, setPopoverPos] = useState(null);
  const hoverTimer = useRef(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDir, setResizeDir] = useState(null); // 'top' or 'bottom'
  const [resizeDelta, setResizeDelta] = useState(0);
  const resizeStartY = useRef(null);
  const canResize = false; // Disabled: resize handles temporarily turned off

  const handleResizeStart = useCallback((e, direction) => {
    if (!canResize) return;
    e.stopPropagation();
    e.preventDefault();
    resizeStartY.current = e.clientY;
    setIsResizing(true);
    setResizeDir(direction);
    setResizeDelta(0);

    const handleMouseMove = (me) => {
      setResizeDelta(me.clientY - resizeStartY.current);
    };

    const handleMouseUp = (me) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      const finalDelta = me.clientY - resizeStartY.current;
      setIsResizing(false);
      setResizeDir(null);
      setResizeDelta(0);
      resizeStartY.current = null;
      if (Math.abs(finalDelta) > 5 && onResize) {
        onResize(booking, finalDelta, direction);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [canResize, booking, onResize]);

  // Setup draggable
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: booking._colTherapistId
      ? `${booking.bookingId || booking.id}__${booking._colTherapistId}`
      : (booking.bookingId || booking.id),
    data: {
      booking,
      type: 'booking',
    },
    disabled: !isDraggable,
  });

  const dragStyle = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: 9999,
    opacity: isDragging ? 0.9 : 1,
    boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.2)' : undefined,
  } : {};

  const durationMins = (() => {
    if (!booking.startTime || !booking.endTime) return null;
    const [sh, sm] = booking.startTime.split(':').map(Number);
    const [eh, em] = booking.endTime.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  })();

  const timeLabel = booking.startTime && booking.endTime
    ? `${to12h(booking.startTime)} – ${to12h(booking.endTime)}`
    : '';

  const handleMouseEnter = useCallback(() => {
    if (isDragging) return;
    hoverTimer.current = setTimeout(() => {
      if (cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect();
        const side = rect.right > window.innerWidth * 0.6 ? 'left' : 'right';
        // Clamp top so popover stays within viewport (estimate ~280px popover height)
        const popoverHeight = 280;
        const maxTop = window.innerHeight - popoverHeight - 10;
        const clampedTop = Math.min(rect.top, maxTop);
        setPopoverPos({
          side,
          top: Math.max(10, clampedTop),
          left: side === 'right' ? rect.right + 8 : rect.left - 288,
        });
      }
      setShowPopover(true);
    }, 200);
  }, [isDragging]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setShowPopover(false);
    setPopoverPos(null);
  }, []);

  useEffect(() => {
    return () => clearTimeout(hoverTimer.current);
  }, []);

  // Hide popover when dragging
  useEffect(() => {
    if (isDragging) {
      clearTimeout(hoverTimer.current);
      setShowPopover(false);
    }
  }, [isDragging]);

  return (
    <div
      ref={(node) => {
        cardRef.current = node;
        setNodeRef(node);
      }}
      className={`absolute left-1 right-1 rounded-md overflow-visible transition-all duration-150 ease-out hover:shadow-lg hover:z-dropdown ${
        isDraggable && !isResizing ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${isSelected ? 'ring-2 ring-violet-500 ring-offset-1' : ''}`}
      data-booking-id={booking.isShared ? booking.bookingId : undefined}
      data-shared={booking.isShared ? 'true' : undefined}
      style={{
        ...style,
        ...(isResizing ? {} : dragStyle),
        ...(isResizing && resizeDir === 'bottom' ? { height: Math.max((style?.height || 60) + resizeDelta, 20), zIndex: 9999 } : {}),
        ...(isResizing && resizeDir === 'top' ? { top: (style?.top || 0) + resizeDelta, height: Math.max((style?.height || 60) - resizeDelta, 20), zIndex: 9999 } : {}),
        backgroundColor: colors.light,
        borderLeft: `3px solid ${colors.bg}`,
        borderTop: isUnpaid ? `2px solid ${UNPAID_BORDER}` : 'none',
        borderRight: isUnpaid ? `1px solid ${UNPAID_BORDER}` : `1px solid ${colors.bg}20`,
        borderBottom: isUnpaid ? `1px solid ${UNPAID_BORDER}` : `1px solid ${colors.bg}20`,
        opacity: isDragging ? 0.3 : booking._isFaded ? 0.4 : 1,
      }}
      onClick={(e) => {
        if (!isDragging && !isResizing) {
          e.stopPropagation();
          clearTimeout(hoverTimer.current);
          setShowPopover(false);
          setPopoverPos(null);
          if (onSelect && (e.metaKey || e.ctrlKey)) {
            onSelect(booking, e);
          } else {
            onClick(booking);
          }
        }
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Drag handle area — middle section of card, not edges */}
      <div
        className="px-2 py-1.5 h-full flex flex-col overflow-hidden"
        {...(isDraggable && !isResizing ? { ...listeners, ...attributes } : {})}
      >
        {timeLabel && (
          <div className="font-data text-[10px] text-text-secondary leading-none mb-0.5 flex-shrink-0">
            {timeLabel}
          </div>
        )}
        <div className="font-body font-semibold text-xs text-text-primary leading-tight truncate flex-shrink-0">
          {booking.customerName}
        </div>
        <div className="font-body text-[11px] text-text-secondary leading-tight truncate flex-shrink-0">
          {booking.serviceName}
        </div>
        {columnMode === 'room' && booking.therapistName && (
          <div className="font-caption text-[10px] text-primary/70 leading-tight truncate flex-shrink-0">
            {booking.therapistName}
          </div>
        )}
        {columnMode === 'therapist' && booking.roomName && (
          <div className="font-caption text-[10px] text-secondary/70 leading-tight truncate flex-shrink-0">
            {booking.roomName}
          </div>
        )}
        {durationMins && (
          <div className="font-caption text-[10px] text-text-secondary/70 mt-auto flex-shrink-0">
            {durationMins} mins
          </div>
        )}
        {(isUnpaid || isLocked || isPaid || booking.specialRequests) && (
          <div className="flex items-center gap-1 mt-0.5 flex-shrink-0">
            {booking.specialRequests && (
              <Icon name="AlertTriangle" size={14} className="text-warning" title="Special request" />
            )}
            {isUnpaid && (
              <span className="inline-flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                <span className="text-[9px] text-yellow-600 font-medium">Unpaid</span>
              </span>
            )}
            {isLocked && <span className="text-[9px]">🔒</span>}
            {!isLocked && isPaid && <span className="text-[9px]">✓</span>}
          </div>
        )}
      </div>

      {/* Resize handles for shared booking cards */}
      {canResize && (
        <>
          <div
            className="absolute -top-1 left-0 right-0 h-3 cursor-n-resize z-10 group/resize-top"
            onMouseDown={(e) => handleResizeStart(e, 'top')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-1 left-1 right-1 h-1 rounded-full bg-violet-400/60 group-hover/resize-top:bg-violet-500 transition-colors" />
          </div>
          <div
            className="absolute -bottom-1 left-0 right-0 h-3 cursor-s-resize z-10 group/resize-bottom"
            onMouseDown={(e) => handleResizeStart(e, 'bottom')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute bottom-1 left-1 right-1 h-1 rounded-full bg-violet-400/60 group-hover/resize-bottom:bg-violet-500 transition-colors" />
          </div>
        </>
      )}

      {/* Rich hover popover — rendered via portal to escape overflow clipping */}
      {showPopover && !isDragging && popoverPos && createPortal(
        <div
          className="fixed z-dropdown pointer-events-none"
          style={{
            top: popoverPos.top,
            left: popoverPos.left,
            width: 280,
          }}
        >
          <div className="bg-surface rounded-lg border border-border spa-shadow-elevated overflow-hidden animate-fade-in">
            {/* Status banner */}
            <div
              className="px-3 py-1.5 text-center text-xs font-body font-semibold"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              {booking.status}
            </div>

            {/* Customer info */}
            <div className="px-3 pt-2.5 pb-2 border-b border-border">
              <div className="flex items-start justify-between">
                <div className="font-body font-semibold text-sm text-text-primary">
                  {booking.customerName}
                </div>
                {booking.bookingNumber && (
                  <span className="font-data text-[10px] text-text-secondary bg-background px-1.5 py-0.5 rounded">
                    #{booking.bookingNumber}
                  </span>
                )}
              </div>
              {booking.customerPhone && (
                <div className="font-caption text-xs text-text-secondary mt-0.5">
                  📞 {booking.customerPhone}
                </div>
              )}
            </div>

            {/* Booking details table */}
            <div className="px-3 py-2 space-y-1.5 border-b border-border">
              <DetailRow label="Service" value={booking.serviceName} />
              <DetailRow
                label="Date"
                value={`${formatDateLabel(booking.date)}, ${timeLabel}`}
              />
              <DetailRow
                label="Duration"
                value={durationMins ? `${durationMins} mins` : (booking.serviceDuration ? `${booking.serviceDuration} mins` : null)}
              />
              <DetailRow label="Therapist" value={booking.therapistName || '—'} />
              <DetailRow label="Room" value={booking.roomName || '—'} />
              <DetailRow label="Created by" value={booking.createdByName || 'Online booking'} />
            </div>

            {/* Financial info */}
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-1">
                  <span className="font-caption text-[10px] text-text-secondary uppercase tracking-wider">Amount</span>
                  {booking.finalAmount != null ? (
                    <span className="font-data text-sm text-text-primary font-semibold">
                      NPR {formatAmount(booking.finalAmount)}
                    </span>
                  ) : booking.baseAmount != null ? (
                    <span className="font-data text-sm text-text-primary font-semibold">
                      NPR {formatAmount(booking.baseAmount)}
                    </span>
                  ) : (
                    <span className="font-body text-xs text-text-secondary">—</span>
                  )}
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    isUnpaid
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {isUnpaid ? 'Unpaid' : 'Paid'}
                </span>
              </div>
              {booking.discountAmount > 0 && (
                <div className="font-caption text-[10px] text-text-secondary mt-0.5">
                  Discount: NPR {formatAmount(booking.discountAmount)}
                </div>
              )}
            </div>

            {/* Special requests */}
            {booking.specialRequests && (
              <div className="px-3 py-2 border-b border-border">
                <div className="font-caption text-[10px] text-text-secondary uppercase tracking-wider mb-0.5 flex items-center gap-1">
                  <Icon name="AlertTriangle" size={10} className="text-warning" />
                  Notes
                </div>
                <div className="font-body text-xs text-text-primary italic leading-snug">
                  "{booking.specialRequests}"
                </div>
              </div>
            )}

            {/* CTA hint */}
            <div className="px-3 py-1.5 bg-background/50">
              <div className="font-caption text-[10px] text-text-secondary text-center">
                {isDraggable ? 'Drag to reschedule • Click for details →' : 'Click for full details →'}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const DetailRow = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="font-caption text-[10px] text-text-secondary uppercase tracking-wider w-16 flex-shrink-0 pt-px">
        {label}
      </span>
      <span className="font-body text-xs text-text-primary leading-snug">
        {value}
      </span>
    </div>
  );
};

export default CalendarBookingCard;
