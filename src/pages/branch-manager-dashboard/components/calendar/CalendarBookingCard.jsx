import React, { useState, useRef, useEffect, useCallback, useId, useLayoutEffect } from 'react';
import { nameForList } from '../../../../services/dataMasking';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { getBookingStatusColors } from '../../../../utils/bookingStatusColors';
import { useBookingHover, HOVER_CARD_ID } from './BookingHoverCard';
import { formatClockTime } from './timeFormat';
import { isNoShow } from '../../../../services/bookingTransformers';
import { OUTSIDE_HOURS_OUTLINE } from '../../../../services/availabilityShading';
import { cardTier, iconsForBooking, splitForShortCard, statusTag, shouldMoveNameDown, lockReason, fitTinyItems, planFullCard, LINE_PX } from '../../../../services/calendarCardLayout';
import Tooltip from '../../../../components/ui/Tooltip';
import CardIcon, { LockMark } from './CardIcon';
import { useCardIconPrefs } from './cardIconPrefs';

// Row of 13px icons; `wrap` lets them flow onto a second row before they clip. `more` = "+N" for icons a short card has no room for.
const IconRow = ({ icons, more = 0, uid, wrap = false, className = '', rowRef }) => (
  <span ref={rowRef} className={`flex items-center gap-[5px] text-[rgba(45,90,39,0.75)] ${wrap ? 'flex-wrap gap-y-[3px]' : ''} ${className}`}>
    {icons.map(i => <CardIcon key={i.key} icon={i} uid={uid} />)}
    {more > 0 && <Tooltip label={`${more} more: open the booking`}><span className="font-data text-[10px] text-text-tertiary leading-none">+{more}</span></Tooltip>}
  </span>
);

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

const CalendarBookingCard = ({ booking, style, onClick, columnMode = 'therapist', onResize, isSelected = false, onSelect, isPanelSelected = false, isLinkedActive = false, onSharedActivate, onSharedDeactivate, onClientActivate, onClientDeactivate, sameClient = false, hideSensitive = false, use24h = false, outsideHours = null }) => {
  const colors = getBookingStatusColors(isNoShow(booking) ? 'No Show' : booking.status);
  const isDraggable = canDragBooking(booking);

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

  const rangeLabel = compactRange12h(booking.startTime, booking.endTime, use24h);
  const cardHeight = typeof style?.height === 'number' ? style.height : parseFloat(style?.height) || 0;
  const tier = cardTier(cardHeight);
  const uid = useId().replace(/:/g, '');
  const prefs = useCardIconPrefs();
  const icons = iconsForBooking(booking, prefs);
  const shortIcons = splitForShortCard(icons);
  const tag = statusTag(booking);
  const lockWhy = prefs.lock !== false ? lockReason(booking, getNepalNow()) : null;
  const tagColor = tag === 'No-show' ? '#374151' : '#991B1B';
  const displayName = hideSensitive ? '•••••' : nameForList(booking.customerName, booking.customerPhone);

  // Name drops to its own line only when time + name don't fit line 1 AND the card has a row to spare (height never grows).
  const lineRef = useRef(null);
  const timeRef = useRef(null);
  const nameRef = useRef(null);
  const iconsRef = useRef(null);
  const [nameDown, setNameDown] = useState(false);
  const tagRef = useRef(null);
  const svcMeasureRef = useRef(null);
  const [svcNeeded, setSvcNeeded] = useState(1); // natural (wrapped) line count of the status words + service
  useLayoutEffect(() => {
    if (tier !== 'full') return undefined;
    const m = svcMeasureRef.current;
    if (!m) return undefined;
    const measure = () => setSvcNeeded(Math.max(1, Math.round(m.offsetHeight / LINE_PX.service)));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(m);
    return () => ro.disconnect();
  }, [tier, booking.serviceName, tag, outsideHours]);
  const serviceBits = (
    <>
      {tag && <span className="font-medium text-[11px]" style={{ color: tagColor }}>· {tag}{booking.serviceName ? ' · ' : ''}</span>}
      {outsideHours && <span className="font-medium text-[11px]" style={{ color: OUTSIDE_HOURS_OUTLINE }}>· {outsideHours}{booking.serviceName ? ' · ' : ''}</span>}
      {booking.serviceName}
    </>
  );
  const roomLine = columnMode === 'room' ? booking.therapistName : columnMode === 'therapist' ? booking.roomName : null;
  const hasLead = !!(tag || outsideHours || booking.serviceName);
  const plan = tier === 'full'
    ? planFullCard({ height: cardHeight, nameDown, hasLead, serviceLines: svcNeeded, hasRoom: !!roomLine, hasIcons: icons.length > 0 || !!lockWhy })
    : null;
  const measureRef = useRef(null);
  const [tinyVisible, setTinyVisible] = useState(null); // null = not measured yet (show all)
  const tinyItems = tier === 'tiny' ? [
    ...shortIcons.shown.map(i => ({ key: i.key, node: <CardIcon key={i.key} icon={i} uid={uid} /> })),
    ...(shortIcons.more > 0 ? [{ key: 'more', node: <Tooltip key="more" label={`${shortIcons.more} more: open the booking`}><span className="font-data text-[10px] text-text-tertiary leading-none">+{shortIcons.more}</span></Tooltip> }] : []),
    ...(lockWhy ? [{ key: 'lock', node: <LockMark key="lock" reason={lockWhy} /> }] : []),
  ] : [];
  const tinyKeys = tinyItems.map(i => i.key).join(',');
  useLayoutEffect(() => {
    if (tier !== 'tiny') return undefined;
    const fit = () => {
      const line = lineRef.current, time = timeRef.current, name = nameRef.current, m = measureRef.current;
      if (!line || !time || !name || !m) return;
      const items = [...m.children].map(c => ({ key: c.dataset.k, width: c.offsetWidth }));
      setTinyVisible(fitTinyItems({ lineWidth: line.clientWidth, fixedWidth: time.offsetWidth + 4 + (tagRef.current ? tagRef.current.offsetWidth + 4 : 0), nameWidth: name.scrollWidth, items }));
    };
    fit();
    if (typeof ResizeObserver === 'undefined' || !lineRef.current) return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(lineRef.current);
    return () => ro.disconnect();
  }, [tier, tinyKeys, displayName, tag]);
  useLayoutEffect(() => {
    if (tier === 'tiny') { setNameDown(false); return undefined; }
    const measure = () => {
      const line = lineRef.current, time = timeRef.current, name = nameRef.current;
      if (!line || !time || !name) return;
      setNameDown(shouldMoveNameDown({ height: cardHeight, timeWidth: time.scrollWidth, nameWidth: name.scrollWidth, lineWidth: line.clientWidth - (iconsRef.current ? iconsRef.current.offsetWidth + 4 : 0) }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined' || !lineRef.current) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(lineRef.current);
    return () => ro.disconnect();
  }, [tier, cardHeight, displayName, rangeLabel]);

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
        // Same client as the hovered / focused / open booking (ZNLY-281): brand outline; a linked (spa) copy keeps its own status-colour outline.
        ...(sameClient && !isLinkedActive && !isPanelSelected && !isDragging ? { outline: '2px solid #2D5A27', outlineOffset: 1 } : {}),
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
      onPointerEnter={(e) => { hoverHandlers.onPointerEnter?.(e); onClientActivate?.(booking.bookingId || booking.id); if (booking.isShared || booking.isRoomShared || booking.isCombo) onSharedActivate?.(booking.bookingId); }}
      onPointerLeave={(e) => { hoverHandlers.onPointerLeave?.(e); onClientDeactivate?.(); if (booking.isShared || booking.isRoomShared || booking.isCombo) onSharedDeactivate?.(); }}
      onFocus={(e) => { hoverHandlers.onFocus?.(e); onClientActivate?.(booking.bookingId || booking.id); if (booking.isShared || booking.isRoomShared || booking.isCombo) onSharedActivate?.(booking.bookingId); }}
      onBlur={(e) => { hoverHandlers.onBlur?.(e); onClientDeactivate?.(); if (booking.isShared || booking.isRoomShared || booking.isCombo) onSharedDeactivate?.(); }}
    >
      {/* Drag handle area — middle section of card, not edges */}
      <div
        className={`${tier === 'tiny' ? 'px-2 py-0 justify-center' : tier === 'short' ? 'px-2 py-[2px]' : 'px-2 py-[3px]'} h-full flex flex-col overflow-hidden`}
        {...(isDraggable && !isResizing ? { ...listeners, ...attributes, tabIndex: -1, role: undefined, 'aria-describedby': undefined } : {})}
      >
        {tier === 'tiny' ? (
          <div ref={lineRef} className="relative flex items-center gap-1 min-w-0 leading-tight">
            <span ref={timeRef} className="font-data text-[11px] text-text-secondary whitespace-nowrap flex-shrink-0">{formatClockTime(booking.startTime, use24h)}</span>
            <span ref={nameRef} className="font-body font-semibold text-[13px] text-text-primary truncate min-w-0">{displayName}</span>
            {tag && <span ref={tagRef} className="text-[11px] font-medium flex-shrink-0 whitespace-nowrap" style={{ color: tagColor }}>· {tag}</span>}
            {tinyItems.some(it => !tinyVisible || tinyVisible.has(it.key)) && (
              <span className="ml-auto flex items-center gap-[5px] flex-shrink-0 text-[rgba(45,90,39,0.75)]">
                {tinyItems.filter(it => !tinyVisible || tinyVisible.has(it.key)).map(it => it.node)}
              </span>
            )}
            {/* invisible measurer: natural width of each right-hand item */}
            <span ref={measureRef} aria-hidden="true" className="absolute left-0 top-0 invisible pointer-events-none flex items-center gap-[5px] whitespace-nowrap">
              {tinyItems.map(it => <span key={it.key} data-k={it.key} className="inline-flex">{it.node}</span>)}
            </span>
          </div>
        ) : tier === 'short' ? (
          <>
            <div ref={lineRef} className="flex items-center gap-1 min-w-0 flex-shrink-0 leading-[1.3]">
              <span ref={timeRef} className="font-data text-[11px] text-text-secondary whitespace-nowrap flex-shrink-0">{rangeLabel}</span>
              {!nameDown && <span ref={nameRef} className="font-body font-semibold text-[13px] text-text-primary truncate min-w-0">{displayName}</span>}
              {(shortIcons.shown.length > 0 || shortIcons.more > 0 || lockWhy) && (
                <span ref={iconsRef} className="ml-auto flex items-center gap-[5px] flex-shrink-0">
                  <IconRow icons={shortIcons.shown} more={shortIcons.more} uid={uid} />
                  {lockWhy && <LockMark reason={lockWhy} />}
                </span>
              )}
            </div>
            {nameDown ? (
              <div ref={nameRef} className="font-body font-semibold text-[13px] text-text-primary leading-[1.3] truncate flex-shrink-0">{displayName}</div>
            ) : (
              <div className="font-body text-[11px] text-text-secondary leading-[1.3] truncate flex-shrink-0">
                {tag && <span className="font-medium" style={{ color: tagColor }}>· {tag}{booking.serviceName ? ' · ' : ''}</span>}
                {outsideHours && <span className="font-medium" style={{ color: OUTSIDE_HOURS_OUTLINE }}>· {outsideHours}{booking.serviceName ? ' · ' : ''}</span>}
                {booking.serviceName}
              </div>
            )}
          </>
        ) : (
          <>
            <div ref={lineRef} className="flex items-center gap-1 min-w-0 flex-shrink-0 leading-[1.3]">
              <span ref={timeRef} className="font-data text-[11px] text-text-secondary whitespace-nowrap flex-shrink-0">{rangeLabel}</span>
              {!nameDown && <span ref={nameRef} className="font-body font-semibold text-[13px] text-text-primary truncate min-w-0">{displayName}</span>}
            </div>
            {nameDown && <div ref={nameRef} className="font-body font-semibold text-[13px] text-text-primary leading-[1.3] truncate flex-shrink-0">{displayName}</div>}
            {plan.serviceLines > 0 && (
              <div className="font-body text-[12px] text-text-secondary leading-[1.3] overflow-hidden break-words flex-shrink-0 mt-px" style={{ maxHeight: `${plan.serviceLines * LINE_PX.service}px`, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: plan.serviceLines }}>
                {serviceBits}
              </div>
            )}
            {plan.showRoom && (
              <div className="font-body text-[11px] text-text-tertiary leading-tight truncate flex-shrink-0">{roomLine}</div>
            )}
            {plan.showIcons && (
              <div className="flex items-end gap-1 flex-shrink-0 mt-auto">
                <IconRow icons={icons} uid={uid} wrap className="flex-1 min-w-0" />
                {lockWhy && <LockMark reason={lockWhy} />}
              </div>
            )}
            {/* invisible measurer: natural wrapped height of status words + service */}
            <div ref={svcMeasureRef} aria-hidden="true" className="absolute left-2 right-2 top-0 invisible pointer-events-none font-body text-[12px] leading-[1.3] break-words">{serviceBits}</div>
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
