import React, { useEffect, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import Icon from '../../../../components/AppIcon';
import { canDragBooking } from './CalendarBookingCard';
import { useBookingHover } from './BookingHoverCard';
import { formatClockTime } from './timeFormat';

// One row in the overflow popover's hidden-bookings list. Draggable exactly
// like CalendarBookingCard (same activation constraint tells clicks from
// drags apart) so staff can reassign a hidden booking to another therapist
// without first opening it. Reports its dragging state up so the popover can
// fade out (not unmount — unmounting mid-drag would tear down dnd-kit's
// active drag) while it's in flight, then close once the drag ends.
const OverflowPopoverRow = ({ booking, onClick, onDragChange, use24h, hideSensitive }) => {
  const isDraggable = canDragBooking(booking);
  const dragId = (booking._colTherapistId || booking._colRoomId)
    ? `${booking.bookingId || booking.id}__${booking._colTherapistId || booking._colRoomId}`
    : (booking.bookingId || booking.id);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { booking, type: 'booking' },
    disabled: !isDraggable,
  });

  // Only report actual true<->false transitions, not the initial mount
  // (isDragging starts false) — otherwise the popover would close itself
  // the instant it opens.
  const prevDragging = useRef(false);
  useEffect(() => {
    if (prevDragging.current !== isDragging) {
      prevDragging.current = isDragging;
      onDragChange(isDragging);
    }
  }, [isDragging, onDragChange]);

  // Same hover card as a regular card (shared popover; see BookingHoverCard.jsx).
  const { ref: rowRef, handlers: hoverHandlers, hideNow } = useBookingHover(booking, { draggable: isDraggable, suppress: hideSensitive });

  return (
    <>
      <button
        ref={(node) => { rowRef.current = node; setNodeRef(node); }}
        type="button"
        className={`w-full text-left px-2.5 py-1.5 border-b border-border/50 last:border-b-0 hover:bg-background/80 transition-colors ${
          isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        onClick={() => {
          if (!isDragging) { hideNow(); onClick(booking); }
        }}
        onPointerEnter={hoverHandlers.onPointerEnter}
        onPointerLeave={hoverHandlers.onPointerLeave}
        onFocus={hoverHandlers.onFocus}
        onBlur={hoverHandlers.onBlur}
        onKeyDown={hoverHandlers.onKeyDown}
        {...(isDraggable ? { ...listeners, ...attributes } : {})}
      >
        <div className="text-[11px] font-medium text-text-primary truncate">{hideSensitive ? '•••••' : (booking.customerName || 'Guest')}</div>
        <div className="text-[10px] text-text-secondary truncate">{booking.serviceName || 'Service'}</div>
        <div className="text-[10px] font-data text-text-secondary/80">{formatClockTime(booking.startTime, use24h)} – {formatClockTime(booking.endTime, use24h)}</div>
      </button>
    </>
  );
};

// Badge showing "+N" for overflow in compact overlap layout. Split into two
// stacked regions: a small "+" strip on top (add a new booking at this same
// time — onAdd) and the count below. Clicking the count expands — but not
// into the badge's own narrow sliver, which is too thin to show a readable
// list. Instead it takes over the FULL cluster area (`expandedStyle`, same
// top/height/left/width the two cards + badge together already occupy) —
// still the same time slot, same therapist column, nothing floats outside
// it — and lists the hidden bookings (`bookings`) with a scroll. Deliberately
// NOT the 2 already-visible ones too: they're already rendered as their own
// draggable CalendarBookingCard, and dnd-kit doesn't allow two draggable
// elements sharing the same id in one DndContext.
const OverflowBadge = ({ count, bookings, style, expandedStyle, onBookingClick, onAdd, use24h, hideSensitive }) => {
  const [expanded, setExpanded] = useState(false);
  const [rowDragging, setRowDragging] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!expanded) return undefined;
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setExpanded(false);
    };
    // Delay so the opening click itself doesn't immediately close it
    const id = setTimeout(() => {
      document.addEventListener('mousedown', close);
      document.addEventListener('keydown', close);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [expanded]);

  if (expanded) {
    return (
      <div
        ref={wrapRef}
        className="absolute overflow-hidden border-2 border-primary/50 bg-surface rounded flex flex-col z-dropdown shadow-spa-elevated"
        style={{ ...(expandedStyle || style), opacity: rowDragging ? 0 : 1, pointerEvents: rowDragging ? 'none' : 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex items-center justify-between px-1.5 py-0.5 border-b border-border bg-background/60" style={{ height: 20 }}>
          <span className="text-[10px] font-semibold text-text-primary truncate">+{count} more</span>
          <button
            type="button"
            title="Collapse"
            className="flex-shrink-0 text-text-secondary hover:text-text-primary"
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          >
            <Icon name="X" size={11} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {(bookings || []).map((booking) => (
            <OverflowPopoverRow
              key={booking._colRoomId ? `${booking.id}__${booking._colRoomId}` : booking.id}
              booking={booking}
              use24h={use24h}
              hideSensitive={hideSensitive}
              onClick={(b) => {
                setExpanded(false);
                onBookingClick?.(b);
              }}
              onDragChange={(dragging) => {
                setRowDragging(dragging);
                if (!dragging) setExpanded(false);
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute overflow-hidden border-2 border-primary/40 bg-background/80 rounded flex flex-col z-dropdown"
      data-overflow-booking-ids={(bookings || []).map(b => b.bookingId || b.id).join(' ')}
      style={style}
    >
      {!!onAdd && (
        <button
          type="button"
          title="Add booking at this time"
          className="flex-shrink-0 flex items-center justify-center border-b border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-white spa-transition-fast"
          style={{ height: 18 }}
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          <Icon name="Plus" size={12} strokeWidth={3} />
        </button>
      )}
      <button
        type="button"
        title={`${count} more booking${count === 1 ? '' : 's'} — click to view`}
        className="flex-1 min-h-0 flex items-center justify-center cursor-pointer hover:bg-background"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(true);
        }}
      >
        <span className="font-data text-[10px] leading-tight text-text-secondary px-0.5 whitespace-nowrap">
          +{count}
        </span>
      </button>
    </div>
  );
};

export default OverflowBadge;
