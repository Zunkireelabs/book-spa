import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../../../../components/AppIcon';

import { getBookingStatusColors, UNPAID_DOT_COLOR } from '../../../../utils/bookingStatusColors';
import { useBookingHover, HOVER_CARD_ID } from './BookingHoverCard';
import { formatClockTime } from './timeFormat';
import { isNoShow } from '../../../../services/bookingTransformers';
import { OUTSIDE_HOURS_OUTLINE } from '../../../../services/availabilityShading';

// Compact range: "2:30–3:15pm", or "11:30am–12:15pm" when the period differs; "14:30–15:15" in 24h mode
function compactRange12h(startStr, endStr, use24h = false) {
  if (!startStr) return '';
  const start = formatClockTime(startStr, use24h);
  if (!endStr) return start;
  const end = formatClockTime(endStr, use24h);
  if (use24h) return `${start}–${end}`;
  const sp = start.slice(-2);
  return sp === end.slice(-2) ? `${start.slice(0, -2)}–${end}` : `${start}–${end}`;
}

// Statuses that cannot be dragged (terminal states)
const NON_DRAGGABLE_STATUSES = ['Completed', 'Cancelled', 'No Show'];

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
export function canDragBooking(booking) {
  // A couple booking split across two room columns (isRoomShared) has no per-companion drag target: a plain drag would move
  // bookings.room_id only and desync it from the companion's booking_therapists.room_id. Reassign rooms in the booking panel.
  if (booking.isRoomShared) return false;
  // Combo components are time-offset from each other (sequential/concurrent) and conflict-checked server-side:
  // no per-component drag target exists yet.
  if (booking.isCombo) return false;
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

const CalendarBookingCard = ({ booking, style, onClick, columnMode = 'therapist', onResize, isSelected = false, onSelect, isPanelSelected = false, isLinkedActive = false, onSharedActivate, onSharedDeactivate, hideSensitive = false, use24h = false, outsideHours = null }) => {
  const colors = getBookingStatusColors(isNoShow(booking) ? 'No Show' : booking.status);
  const isUnpaid = booking.paymentStatus === 'unpaid';
  const isPaid = booking.paymentStatus === 'paid';
  const isDraggable = canDragBooking(booking);
  // status check catches a service started before its scheduled slot, which
  // isTimeLocked (wall-clock vs. scheduled start) would otherwise miss.
  const isLocked = booking.isLocked || booking.status === 'In-Progress' || isTimeLocked(booking);

  // Hover card: one shared popover (see BookingHoverCard.jsx). Not shown for the booking already open in the side panel.
  const { ref: cardRef, handlers: hoverHandlers, open: hoverOpen, hideNow } = useBookingHover(booking, { draggable: isDraggable, suppress: isPanelSelected || hideSensitive });
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
    id: (booking._colTherapistId || booking._colRoomId)
      ? `${booking.bookingId || booking.id}__${booking._colTherapistId || booking._colRoomId}${booking._comboIndex != null ? `__c${booking._comboIndex}` : ''}` // combo parts can share a column
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

  const rangeLabel = compactRange12h(booking.startTime, booking.endTime, use24h);
  const cardHeight = typeof style?.height === 'number' ? style.height : parseFloat(style?.height) || 0;
  const isTall = cardHeight >= 56;
  const isShort = cardHeight > 0 && cardHeight < 40;
  const sharedLabel = booking.isShared ? `Shared with ${booking.therapistName}` : null;

  return (
    <div
      ref={(node) => {
        cardRef.current = node;
        setNodeRef(node);
      }}
      className={`absolute left-1 right-1 rounded-spa overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-primary/60 transition-colors duration-150 ease-out hover:z-dropdown hover:brightness-[0.97] ${
        isDraggable && !isResizing ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${isSelected ? 'ring-2 ring-primary ring-offset-1' : ''} ${isPanelSelected ? 'ring-2 ring-primary z-[3]' : ''}`}
      data-booking-card="true"
      data-booking-key={booking.bookingId || booking.id}
      data-outside-hours={outsideHours ? 'true' : undefined}
      data-booking-id={(booking.isShared || booking.isRoomShared || booking.isCombo) ? booking.bookingId : undefined}
      data-shared={(booking.isShared || booking.isRoomShared || booking.isCombo) ? 'true' : undefined}
      data-bar={(booking.isShared || booking.isRoomShared || booking.isCombo) ? colors.bar : undefined}
      style={{
        ...style,
        ...(isResizing ? {} : dragStyle),
        ...(isResizing && resizeDir === 'bottom' ? { height: Math.max((style?.height || 60) + resizeDelta, 20), zIndex: 9999 } : {}),
        ...(isResizing && resizeDir === 'top' ? { top: (style?.top || 0) + resizeDelta, height: Math.max((style?.height || 60) - resizeDelta, 20), zIndex: 9999 } : {}),
        // Secondary copies of a shared booking stay readable: a lighter fill and a softer bar, not ghosted.
        backgroundColor: booking._isFaded ? `color-mix(in srgb, ${colors.fill} 55%, white)` : colors.fill,
        borderLeft: `3px solid ${booking._isFaded ? `color-mix(in srgb, ${colors.bar} 50%, transparent)` : colors.bar}`,
        opacity: isDragging ? 0.3 : 1,
        // Booked before the therapist's hours / break / leave changed: left where it is, flagged (ZNLY-100).
        ...(outsideHours && !isDragging ? { boxShadow: `inset 0 0 0 1.5px ${OUTSIDE_HOURS_OUTLINE}` } : {}),
        // Linked highlight (all copies of the hovered/focused/open shared booking); the panel ring wins on the open card.
        ...(isLinkedActive && !isPanelSelected && !isDragging ? { outline: `1.5px solid ${colors.bar}`, outlineOffset: 1 } : {}),
      }}
      onClick={(e) => {
        if (!isDragging && !isResizing) {
          e.stopPropagation();
          hideNow();
          if (onSelect && (e.metaKey || e.ctrlKey)) {
            onSelect(booking, e);
          } else {
            onClick(booking);
          }
        }
      }}
      tabIndex={0}
      aria-label={`${hideSensitive ? 'Booking' : booking.customerName}, ${booking.status}, ${rangeLabel}${booking.serviceName ? `, ${booking.serviceName}` : ''}`}
      aria-describedby={hoverOpen ? HOVER_CARD_ID : undefined}
      onKeyDown={(e) => {
        hoverHandlers.onKeyDown(e);
        if (!e.defaultPrevented && e.key === 'Enter' && e.target === e.currentTarget && !isResizing) { e.preventDefault(); hideNow(); onClick(booking); }
      }}
      onPointerEnter={(e) => { hoverHandlers.onPointerEnter?.(e); if (booking.isShared || booking.isRoomShared || booking.isCombo) onSharedActivate?.(booking.bookingId); }}
      onPointerLeave={(e) => { hoverHandlers.onPointerLeave?.(e); if (booking.isShared || booking.isRoomShared || booking.isCombo) onSharedDeactivate?.(); }}
      onFocus={(e) => { hoverHandlers.onFocus?.(e); if (booking.isShared || booking.isRoomShared || booking.isCombo) onSharedActivate?.(booking.bookingId); }}
      onBlur={(e) => { hoverHandlers.onBlur?.(e); if (booking.isShared || booking.isRoomShared || booking.isCombo) onSharedDeactivate?.(); }}
    >
      {/* Drag handle area — middle section of card, not edges */}
      <div
        className={`px-2 ${isShort ? 'py-0.5 justify-center' : 'py-1.5'} h-full flex flex-col overflow-hidden`}
        {...(isDraggable && !isResizing ? { ...listeners, ...attributes, tabIndex: -1, role: undefined, 'aria-describedby': undefined } : {})}
      >
        {isShort ? (
          <div className="flex items-center gap-1 min-w-0 leading-tight">
            {isUnpaid && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: UNPAID_DOT_COLOR }} title="Unpaid" />}
            <span className="font-body font-medium text-xs text-text-primary truncate">{hideSensitive ? '•••••' : booking.customerName}</span>
            <span className="font-data text-[11px] text-text-secondary shrink-[1000] min-w-0 truncate">· {formatClockTime(booking.startTime, use24h)}</span>
            {(sharedLabel || booking.specialRequests || booking.customerNotes) && (
              <span className="flex-shrink-0 ml-auto flex items-center gap-1">
                {sharedLabel && <span title={sharedLabel} aria-label={sharedLabel} className="text-text-tertiary"><Icon name="Users" size={11} /></span>}
                {(booking.specialRequests || booking.customerNotes) && (
                  <span title="Has notes" aria-label="Has notes" style={{ color: booking.customerNotes ? '#D97706' : undefined }}><Icon name="AlertTriangle" size={11} /></span>
                )}
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 min-w-0 flex-shrink-0">
              {isUnpaid && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: UNPAID_DOT_COLOR }} title="Unpaid" />}
              <span className="font-body font-medium text-xs text-text-primary leading-tight truncate">{hideSensitive ? '•••••' : booking.customerName}</span>
              <span className="ml-auto flex items-center gap-1 flex-shrink-0 text-text-tertiary">
                {sharedLabel && (
                  <span title={sharedLabel} aria-label={sharedLabel} className="flex items-center gap-0.5">
                    <Icon name="Users" size={12} />
                    <span className="text-[10px] font-data leading-none">{booking.sharedCount}</span>
                  </span>
                )}
                {booking.isNewCustomer && (
                  <span className="px-1 rounded-sm bg-primary/10 text-primary text-[10px] font-medium leading-4">New</span>
                )}
                {(booking.specialRequests || booking.customerNotes) && (
                  <span title="Has notes" aria-label="Has notes" style={booking.customerNotes ? { color: '#D97706' } : undefined}><Icon name="AlertTriangle" size={12} /></span>
                )}
                {isLocked && <Icon name="Lock" size={12} title="Locked" />}
                {!isLocked && isPaid && <Icon name="Check" size={12} title="Paid" />}
              </span>
            </div>
            <div className="font-body text-[11px] text-text-secondary leading-tight truncate flex-shrink-0">
              {rangeLabel}{booking.serviceName ? ` · ${booking.serviceName}` : ''}
              {outsideHours && <span className="font-medium" style={{ color: OUTSIDE_HOURS_OUTLINE }}> · {outsideHours}</span>}
            </div>
            {isTall && columnMode === 'room' && booking.therapistName && (
              <div className="font-body text-[11px] text-text-tertiary leading-tight truncate flex-shrink-0">
                {booking.therapistName}
              </div>
            )}
            {isTall && columnMode === 'therapist' && booking.roomName && (
              <div className="font-body text-[11px] text-text-tertiary leading-tight truncate flex-shrink-0">
                {booking.roomName}
              </div>
            )}
            {isTall && durationMins && (
              <div className="font-body text-[11px] text-text-tertiary mt-auto flex-shrink-0">
                {durationMins} mins
              </div>
            )}
          </>
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
            <div className="absolute top-1 left-1 right-1 h-1 rounded-full bg-primary/40 group-hover/resize-top:bg-primary transition-colors" />
          </div>
          <div
            className="absolute -bottom-1 left-0 right-0 h-3 cursor-s-resize z-10 group/resize-bottom"
            onMouseDown={(e) => handleResizeStart(e, 'bottom')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute bottom-1 left-1 right-1 h-1 rounded-full bg-primary/40 group-hover/resize-bottom:bg-primary transition-colors" />
          </div>
        </>
      )}

    </div>
  );
};

export default CalendarBookingCard;
