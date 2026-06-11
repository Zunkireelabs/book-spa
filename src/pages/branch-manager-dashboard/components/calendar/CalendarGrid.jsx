import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import Icon from '../../../../components/AppIcon';
import CalendarBookingCard from './CalendarBookingCard';

// SVG overlay: inverted-U bracket connectors between shared booking cards
const SharedBookingLines = ({ containerRef, bookings }) => {
  const [brackets, setBrackets] = useState([]);

  const drawBrackets = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const sharedCards = container.querySelectorAll('[data-shared="true"]');
    if (sharedCards.length === 0) { setBrackets([]); return; }

    const groups = {};
    sharedCards.forEach(card => {
      const bid = card.dataset.bookingId;
      if (!groups[bid]) groups[bid] = [];
      groups[bid].push(card);
    });

    const containerRect = container.getBoundingClientRect();
    const newBrackets = [];

    Object.entries(groups).forEach(([bid, cards]) => {
      if (cards.length < 2) return;
      const sorted = [...cards].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const rects = sorted.map(c => c.getBoundingClientRect());

      // Find the topmost card position
      const minTop = Math.min(...rects.map(r => r.top - containerRect.top));
      // Bridge line sits 20px above the topmost card
      const bridgeY = Math.max(minTop - 20, 2);

      // Build path: for each card, go up from top-center to bridgeY, then horizontal across
      const points = rects.map(r => ({
        cx: r.left + r.width / 2 - containerRect.left,
        cardTop: r.top - containerRect.top,
      }));

      // SVG path: vertical lines up + horizontal bridge
      let path = '';
      points.forEach((p, i) => {
        // Vertical line from card top to bridge
        path += `M ${p.cx} ${p.cardTop} L ${p.cx} ${bridgeY} `;
      });
      // Horizontal bridge connecting leftmost to rightmost
      path += `M ${points[0].cx} ${bridgeY} L ${points[points.length - 1].cx} ${bridgeY} `;

      newBrackets.push({ key: bid, path });
    });

    setBrackets(newBrackets);
  }, [containerRef]);

  useEffect(() => {
    drawBrackets();
    // Multiple delayed redraws to catch DOM settling after data refresh
    const t1 = setTimeout(drawBrackets, 50);
    const t2 = setTimeout(drawBrackets, 200);
    const t3 = setTimeout(drawBrackets, 500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [drawBrackets, bookings]);

  // Redraw on scroll
  useEffect(() => {
    const scrollEl = containerRef.current?.closest('.overflow-auto, [class*="overflow-x"]');
    if (!scrollEl) return;
    const handler = () => drawBrackets();
    scrollEl.addEventListener('scroll', handler);
    return () => scrollEl.removeEventListener('scroll', handler);
  }, [containerRef, drawBrackets]);

  // Redraw when DOM changes (cards move/appear/disappear)
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new MutationObserver(() => {
      requestAnimationFrame(drawBrackets);
    });
    observer.observe(containerRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, [containerRef, drawBrackets]);

  if (brackets.length === 0) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 5, overflow: 'visible' }}>
      {brackets.map(b => (
        <path
          key={b.key}
          d={b.path}
          fill="none"
          stroke="#dc2626"
          strokeWidth={2}
          strokeLinejoin="round"
          opacity={0.7}
        />
      ))}
    </svg>
  );
};

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

// ── Overlap layout constants & helpers ─────────────────
const MAX_VISIBLE_OVERLAP = 2;
const OVERLAP_GAP = 2;       // px between side-by-side cards
const OVERLAP_PADDING = 4;   // px from column edges

/**
 * Group overlapping bookings into clusters.
 * Sweep algorithm: sort by startTime, extend running max endTime.
 * Strict overlap (startTime < clusterEnd), back-to-back are separate clusters.
 */
function clusterOverlapping(bookings) {
  const valid = bookings.filter(b => b.startTime && b.endTime);
  if (valid.length === 0) return [];

  const sorted = [...valid].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const clusters = [[sorted[0]]];
  let clusterEnd = sorted[0].endTime;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startTime < clusterEnd) {
      clusters[clusters.length - 1].push(sorted[i]);
      if (sorted[i].endTime > clusterEnd) clusterEnd = sorted[i].endTime;
    } else {
      clusters.push([sorted[i]]);
      clusterEnd = sorted[i].endTime;
    }
  }
  return clusters;
}

/**
 * Calculate positioning for cards within an overlap cluster.
 * Returns { cards: [{left, width}|null], badge: {left, width, count}|null }
 */
function getOverlapLayout(clusterSize, columnWidth) {
  if (clusterSize <= 1) {
    return { cards: [null], badge: null };
  }

  const slots = clusterSize > MAX_VISIBLE_OVERLAP ? MAX_VISIBLE_OVERLAP + 1 : clusterSize;
  const availableWidth = columnWidth - OVERLAP_PADDING * 2;
  const totalGap = (slots - 1) * OVERLAP_GAP;
  const slotWidth = Math.floor((availableWidth - totalGap) / slots);

  const cards = [];
  for (let i = 0; i < Math.min(clusterSize, MAX_VISIBLE_OVERLAP); i++) {
    cards.push({
      left: OVERLAP_PADDING + i * (slotWidth + OVERLAP_GAP),
      width: slotWidth,
    });
  }

  let badge = null;
  if (clusterSize > MAX_VISIBLE_OVERLAP) {
    const badgeIndex = MAX_VISIBLE_OVERLAP;
    badge = {
      left: OVERLAP_PADDING + badgeIndex * (slotWidth + OVERLAP_GAP),
      width: slotWidth,
      count: clusterSize - MAX_VISIBLE_OVERLAP,
    };
  }

  return { cards, badge };
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

// Badge showing "+N more" for overflow in compact overlap layout
const OverflowBadge = ({ count, style }) => (
  <div
    className="absolute border-2 border-dashed border-text-secondary/40 bg-background/80 rounded flex items-center justify-center cursor-pointer z-[1]"
    style={style}
    onClick={(e) => e.stopPropagation()}
  >
    <span className="font-data text-[10px] text-text-secondary whitespace-nowrap">
      +{count} more
    </span>
  </div>
);

// Sortable wrapper for draggable column headers
const SortableColumnHeader = ({ id, children, minWidth }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: transform ? CSS.Transform.toString({ ...transform, y: 0 }) : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    flex: 1,
    minWidth,
  };
  return (
    <div
      ref={setNodeRef}
      className={`relative ${isDragging ? 'z-dropdown' : ''}`}
      style={style}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
};

const CalendarGrid = ({
  therapists,
  rooms = [],
  bookings,
  branchHours,
  attendanceMap,
  onBookingClick,
  onBookingResize,
  onMultiDrag,
  onEmptySlotClick,
  currentDate,
  viewMode = 'day',
  columnMode = 'therapist',
  activeDragId = null,
  gridRef, // Ref to get grid position for time calculation
  freezeUnassigned = true,
  onToggleFreezeUnassigned,
  onTherapistReorder,
  onRoomReorder,
}) => {
  const scrollRef = useRef(null);
  const headerScrollRef = useRef(null);
  const gridBodyRef = useRef(null);

  // Multi-select for shared booking cards (Cmd/Ctrl + click)
  const [selectedCardIds, setSelectedCardIds] = useState(new Set());

  const handleCardSelect = useCallback((booking, e) => {
    if (!booking.isShared) return false; // only shared cards are multi-selectable
    const cardKey = `${booking.id}__${booking._colTherapistId}`;
    if (e.metaKey || e.ctrlKey) {
      // Toggle selection
      setSelectedCardIds(prev => {
        const next = new Set(prev);
        if (next.has(cardKey)) next.delete(cardKey);
        else next.add(cardKey);
        return next;
      });
      return true; // consumed the click
    }
    // Normal click — clear selection
    if (selectedCardIds.size > 0) {
      setSelectedCardIds(new Set());
    }
    return false;
  }, [selectedCardIds]);

  // Clear selection when clicking empty grid area
  const handleGridClick = useCallback((e) => {
    if (selectedCardIds.size > 0 && !e.metaKey && !e.ctrlKey) {
      setSelectedCardIds(new Set());
    }
  }, [selectedCardIds]);

  // getSelectedBookings and onMultiDrag effect are below bookingsByDayAndCol

  // Expose grid body ref to parent for position calculation
  useEffect(() => {
    if (gridRef) {
      gridRef.current = gridBodyRef.current;
    }
  }, [gridRef]);

  const openHour = 9;  // 9am

  const closeHour = 23;  // last label 10pm (22), grid ends at 11pm

  const TOP_PAD = 12;  // breathing room above the first (9am) line

  const hours = useMemo(() => {
    const result = [];
    for (let h = openHour; h < closeHour; h++) result.push(h);
    return result;
  }, []);

  const totalHeight = hours.length * HOUR_HEIGHT + TOP_PAD;

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
      const bookingDate = b.date || (b.start_datetime ? b.start_datetime.split('T')[0] : null);
      if (!bookingDate || !map[bookingDate]) return;

      const startTime = b.start_time || (b.start_datetime ? b.start_datetime.split('T')[1]?.slice(0, 8) : null);
      const endTime = b.end_time || (b.end_datetime ? b.end_datetime.split('T')[1]?.slice(0, 8) : null);
      const therapistName = b.booking_therapists?.length > 0
        ? b.booking_therapists.map(bt => therapistMap[bt.therapist_id] || bt.therapist?.name).filter(Boolean).join(', ')
        : (therapistMap[b.therapist_id] || null);
      const isShared = columnMode === 'therapist' && b.booking_therapists?.length > 1;

      const baseEntry = {
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
        therapistName,
        roomName: b.room?.name || roomMap[b.room_id] || null,
        baseAmount: b.base_amount,
        discountAmount: b.discount_amount,
        finalAmount: b.final_amount,
        specialRequests: b.special_requests || null,
        createdByName: b.creator?.full_name || null,
        isShared,
        sharedCount: isShared ? b.booking_therapists.length : 0,
      };

      if (isShared) {
        // Place booking in each assigned therapist's column with per-therapist times
        // Leftmost column in current visual order = primary (unfaded), rest = faded
        const columnOrder = columns.map(c => c.id);
        const assignedIds = b.booking_therapists.map(bt => bt.therapist_id);
        const leftmostId = columnOrder.find(cid => assignedIds.includes(cid));

        b.booking_therapists.forEach(bt => {
          const colId = bt.therapist_id;
          if (!map[bookingDate][colId]) map[bookingDate][colId] = [];
          map[bookingDate][colId].push({
            ...baseEntry,
            _colTherapistId: colId,
            _isFaded: colId !== leftmostId,
            startTime: bt.start_time || startTime,
            endTime: bt.end_time || endTime,
            _bookingStartTime: startTime,
            _bookingEndTime: endTime,
          });
        });
      } else {
        const colId = columnMode === 'room'
          ? (b.room_id || 'unassigned')
          : (b.therapist_id || 'unassigned');
        if (!map[bookingDate][colId]) map[bookingDate][colId] = [];
        map[bookingDate][colId].push(baseEntry);
      }
    });

    return map;
  }, [bookings, columns, days, columnMode, therapists, rooms]);

  // Expose selected bookings to parent for multi-drag
  const getSelectedBookings = useCallback(() => {
    if (selectedCardIds.size === 0) return [];
    const allBookings = [];
    Object.values(bookingsByDayAndCol).forEach(cols => {
      Object.values(cols).forEach(bks => {
        bks.forEach(b => {
          const key = b._colTherapistId ? `${b.id}__${b._colTherapistId}` : b.id;
          if (selectedCardIds.has(key)) allBookings.push(b);
        });
      });
    });
    return allBookings;
  }, [selectedCardIds, bookingsByDayAndCol]);

  useEffect(() => {
    if (onMultiDrag) onMultiDrag(getSelectedBookings);
  }, [getSelectedBookings, onMultiDrag]);

  // ── Position helpers ──────────────────────────────────────
  const timeToTop = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return ((h - openHour) * 60 + m) / 60 * HOUR_HEIGHT + TOP_PAD;
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

  // Scroll the grid to the current time once, when the calendar opens on today.
  // Deferred via rAF so it runs after the flex layout has sized the scroll
  // container (setting scrollTop too early clamps it to 0). The ref guard keeps
  // it one-shot so later data refreshes don't yank the user's scroll position.
  const hasScrolledToNowRef = useRef(false);
  useEffect(() => {
    if (hasScrolledToNowRef.current || !days.includes(todayStr)) return;
    let raf1, raf2, timer;
    const tryScroll = () => {
      const el = scrollRef.current;
      if (!el || el.clientHeight === 0 || el.scrollHeight <= el.clientHeight) return false;
      el.scrollTop = Math.max(0, (nowTop || 0) - el.clientHeight / 2);
      hasScrolledToNowRef.current = true;
      return true;
    };
    if (!tryScroll()) {
      raf1 = requestAnimationFrame(() => {
        if (!tryScroll()) {
          raf2 = requestAnimationFrame(() => {
            if (!tryScroll()) timer = setTimeout(tryScroll, 200);
          });
        }
      });
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
  }, [days, todayStr, nowTop]);

  const minColWidth = isMultiDay ? 80 : 120;

  // ── Column header tooltip (fixed-position to escape overflow-hidden) ──
  const [headerTooltip, setHeaderTooltip] = useState(null);
  const [isHeaderDragging, setIsHeaderDragging] = useState(false);
  const showHeaderTooltip = useCallback((e, name) => {
    if (isHeaderDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHeaderTooltip({ name, x: rect.left + rect.width / 2, y: rect.bottom + 4 });
  }, [isHeaderDragging]);
  const hideHeaderTooltip = useCallback(() => setHeaderTooltip(null), []);

  // ── Header drag-to-reorder (nested DndContext) ────────────
  const headerSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // ── Column header renderer ────────────────────────────────
  const renderColumnHeader = (col) => {
    const isUnassigned = col.type === 'unassigned';
    return (
      <div
        key={col.id}
        className="relative flex-1 border-r border-border last:border-r-0 px-1 py-2 text-center"
        style={{ minWidth: minColWidth }}
        onMouseEnter={(e) => showHeaderTooltip(e, col.name)}
        onMouseLeave={hideHeaderTooltip}
      >
        <div className={`flex items-center justify-center gap-1 overflow-hidden min-w-0 ${isUnassigned ? 'text-warning' : 'text-text-primary'}`}>
          <Icon
            name={isUnassigned ? 'AlertCircle' : col.icon}
            size={12}
            className={`flex-shrink-0 ${isUnassigned ? 'text-warning' : 'text-text-secondary'}`}
          />
          <span
            className={`font-body text-[11px] truncate max-w-full block ${isUnassigned ? 'italic font-medium' : 'font-semibold'}`}
          >
            {col.name}
          </span>
          {isUnassigned && onToggleFreezeUnassigned && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFreezeUnassigned(); }}
              className={`p-0.5 rounded hover:bg-black/5 spa-transition-fast ${
                freezeUnassigned ? 'text-primary' : 'text-text-secondary'
              }`}
              title={freezeUnassigned ? 'Unpin column' : 'Pin column'}
            >
              <Icon name={freezeUnassigned ? 'Pin' : 'PinOff'} size={13} />
            </button>
          )}
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
    <div className="flex-shrink-0 border-r border-border relative bg-surface sticky left-0 z-header" style={{ width: TIME_COL_WIDTH }}>
      {hours.map((hour) => (
        <div key={hour} className="absolute w-full" style={{ top: (hour - openHour) * HOUR_HEIGHT + TOP_PAD }}>
          <span className="absolute -top-2.5 right-2 font-data text-[13px] text-text-secondary">
            {hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
          </span>
        </div>
      ))}
    </div>
  );

  // Solid lines only — rendered once per container, spans all columns
  const renderGridLines = () => (
    <>
      {hours.map((hour) => {
        const top = (hour - openHour) * HOUR_HEIGHT + TOP_PAD;
        return (
          <React.Fragment key={`lines-${hour}`}>
            <div className="absolute left-0 right-0 border-t-2 border-border" style={{ top }} />
            <div className="absolute left-0 right-0 border-t border-border/40" style={{ top: top + SLOT_HEIGHT }} />
          </React.Fragment>
        );
      })}
    </>
  );

  // Dashed interval lines with hover tooltips — rendered per-column
  const renderIntervalLines = () => {
    const TEN_MIN = HOUR_HEIGHT / 6;
    const renderIntervalLine = (hour, minuteOffset, topPos) => {
      const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const ampm = hour < 12 ? 'am' : 'pm';
      const label = `${h12}:${String(minuteOffset).padStart(2, '0')}${ampm}`;
      return (
        <div key={`${hour}-${minuteOffset}`} className="absolute left-0 right-0 group/line" style={{ top: topPos }}>
          <div className="absolute inset-x-0 top-0" style={{ borderTop: '1px dashed rgba(180, 180, 180, 0.35)' }} />
          <div className="absolute inset-x-0 -top-[6px] h-3 cursor-default" />
          <span className="absolute left-2 -top-5 hidden group-hover/line:block text-[10px] text-text-secondary bg-surface border border-border/50 px-1.5 py-0.5 rounded shadow-sm pointer-events-none font-data z-20">
            {label}
          </span>
        </div>
      );
    };

    return (
      <>
        {hours.map((hour) => {
          const top = (hour - openHour) * HOUR_HEIGHT + TOP_PAD;
          return (
            <React.Fragment key={`interval-${hour}`}>
              {renderIntervalLine(hour, 10, top + TEN_MIN)}
              {renderIntervalLine(hour, 20, top + TEN_MIN * 2)}
              {renderIntervalLine(hour, 40, top + TEN_MIN * 4)}
              {renderIntervalLine(hour, 50, top + TEN_MIN * 5)}
            </React.Fragment>
          );
        })}
      </>
    );
  };

  const renderNowIndicator = (day) => {
    if (day !== todayStr || nowTop < 0 || nowTop > totalHeight) return null;
    return (
      <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
        <div className="h-0.5 bg-primary" />
      </div>
    );
  };

  const handleBookingResize = useCallback((booking, pixelDelta, direction) => {
    if (!onBookingResize) return;
    // Convert pixel delta to minutes (HOUR_HEIGHT px = 60 min)
    const deltaMinutes = Math.round((pixelDelta / HOUR_HEIGHT) * 60 / 5) * 5; // snap to 5-min
    if (deltaMinutes === 0) return;
    onBookingResize(booking, deltaMinutes, direction);
  }, [onBookingResize]);

  const handleColumnClick = (e, day, col) => {
    if (activeDragId || !onEmptySlotClick) return;
    const relativeY = e.clientY - e.currentTarget.getBoundingClientRect().top - TOP_PAD;
    const minutesFromTop = (relativeY / HOUR_HEIGHT) * 60;
    const hour = Math.floor(minutesFromTop / 60) + openHour;
    const minute = Math.floor((minutesFromTop % 60) / 5) * 5;
    if (hour < openHour || hour >= closeHour) return;
    onEmptySlotClick({ day, colId: col.id, colName: col.name, colType: col.type, hour, minute });
  };

  const renderColumn = (col, day) => {
    const colBookings = (bookingsByDayAndCol[day] || {})[col.id] || [];
    const droppableId = `drop-col-${day}-${col.id}`;

    return (
      <div
        key={col.id}
        className="flex-1 relative border-r border-border/50 last:border-r-0 cursor-pointer"
        style={{ minWidth: minColWidth, height: totalHeight }}
        onClick={(e) => handleColumnClick(e, day, col)}
      >
        {/* Dashed interval lines with hover tooltips — per-column so hover works */}
        {renderIntervalLines()}

        {/* Single droppable zone for the entire column (sibling to booking cards) */}
        <DroppableColumn
          id={droppableId}
          data={{ day, colId: col.id, openHour, totalHeight }}
          height={totalHeight}
          isActive={!!activeDragId}
        />

        {/* Booking cards with overlap handling */}
        {(() => {
          const clusters = clusterOverlapping(colBookings);
          return clusters.map(cluster => {
            const layout = getOverlapLayout(cluster.length, minColWidth);
            return cluster.slice(0, MAX_VISIBLE_OVERLAP).map((booking, idx) => {
              const cardKey = booking._colTherapistId ? `${booking.id}__${booking._colTherapistId}` : booking.id;
              const pos = layout.cards[idx];
              return (
                <CalendarBookingCard
                  key={cardKey}
                  booking={booking}
                  columnMode={columnMode}
                  style={{
                    top: timeToTop(booking.startTime),
                    height: timeToHeight(booking.startTime, booking.endTime),
                    ...(pos ? { left: pos.left, width: pos.width, right: 'auto' } : {}),
                  }}
                  onClick={onBookingClick}
                  onResize={handleBookingResize}
                  isSelected={selectedCardIds.has(cardKey)}
                  onSelect={handleCardSelect}
                />
              );
            }).concat(
              layout.badge ? (
                <OverflowBadge
                  key={`badge-${cluster[0].id}`}
                  count={layout.badge.count}
                  style={{
                    top: timeToTop(cluster[0].startTime),
                    height: timeToHeight(cluster[0].startTime, cluster[0].endTime),
                    left: layout.badge.left,
                    width: layout.badge.width,
                    right: 'auto',
                  }}
                />
              ) : []
            );
          });
        })()}
      </div>
    );
  };

  // ── Single-day view ───────────────────────────────────────
  const columnsMinWidth = columns.length * minColWidth;
  const unassignedCol = columns.find(c => c.type === 'unassigned');
  const regularColumns = columns.filter(c => c.type !== 'unassigned');
  const regularMinWidth = regularColumns.length * minColWidth;
  const canSortHeaders = (columnMode === 'therapist' && !!onTherapistReorder)
    || (columnMode === 'room' && !!onRoomReorder);
  const regularColumnIds = useMemo(() => regularColumns.map(c => c.id), [regularColumns]);

  const handleHeaderDragStart = useCallback(() => {
    setIsHeaderDragging(true);
    setHeaderTooltip(null);
  }, []);

  const handleHeaderDragEnd = useCallback((event) => {
    setIsHeaderDragging(false);
    const { active, over } = event;
    const reorderFn = columnMode === 'room' ? onRoomReorder : onTherapistReorder;
    if (!over || active.id === over.id || !reorderFn) return;
    const oldIndex = regularColumns.findIndex(c => c.id === active.id);
    const newIndex = regularColumns.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(regularColumns, oldIndex, newIndex);
    reorderFn(reordered.map(c => c.id));
  }, [regularColumns, columnMode, onTherapistReorder, onRoomReorder]);

  const renderDayView = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Fixed header — outside scroll container */}
      <div
        ref={headerScrollRef}
        className="flex-shrink-0 z-header bg-background border-b-2 border-border overflow-hidden"
      >
        <div className="flex" style={{ width: '100%', minWidth: TIME_COL_WIDTH + columnsMinWidth }}>
          <div className="flex-shrink-0 border-r border-border px-2 py-3 flex items-center sticky left-0 z-header bg-background" style={{ width: TIME_COL_WIDTH }}>
            <Icon name="Clock" size={14} className="text-text-secondary" />
          </div>
          {unassignedCol && (
            <div
              className={`flex-shrink-0 border-r border-border bg-background ${
                freezeUnassigned ? 'sticky z-header' : ''
              }`}
              style={freezeUnassigned
                ? { left: TIME_COL_WIDTH, width: minColWidth }
                : { minWidth: minColWidth }
              }
            >
              {renderColumnHeader(unassignedCol)}
            </div>
          )}
          {canSortHeaders ? (
            <DndContext sensors={headerSensors} collisionDetection={closestCenter} onDragStart={handleHeaderDragStart} onDragEnd={handleHeaderDragEnd}>
              <SortableContext items={regularColumnIds} strategy={horizontalListSortingStrategy}>
                <div className="flex flex-1" style={{ minWidth: regularMinWidth }}>
                  {regularColumns.map(col => (
                    <SortableColumnHeader key={col.id} id={col.id} minWidth={minColWidth}>
                      {renderColumnHeader(col)}
                    </SortableColumnHeader>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="flex flex-1" style={{ minWidth: regularMinWidth }}>
              {regularColumns.map(col => renderColumnHeader(col))}
            </div>
          )}
        </div>
      </div>
      {/* Scrollable grid body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-scroll overflow-y-auto calendar-grid-scroll"
        onScroll={(e) => {
          if (headerScrollRef.current) {
            headerScrollRef.current.scrollLeft = e.target.scrollLeft;
          }
        }}
      >
        <div
          ref={gridBodyRef}
          className="flex relative"
          style={{ height: totalHeight, width: '100%', minWidth: TIME_COL_WIDTH + columnsMinWidth }}
          data-open-hour={openHour}
          data-hour-height={HOUR_HEIGHT}
        >
          <SharedBookingLines containerRef={gridBodyRef} bookings={bookings} />
          {renderTimeLabels()}
          {unassignedCol && (() => {
            const colBookings = (bookingsByDayAndCol[currentDate] || {})[unassignedCol.id] || [];
            const droppableId = `drop-col-${currentDate}-${unassignedCol.id}`;
            return (
              <div
                className={`flex-shrink-0 relative border-r border-border bg-surface overflow-hidden ${
                  freezeUnassigned ? 'sticky z-header' : ''
                }`}
                style={freezeUnassigned
                  ? { left: TIME_COL_WIDTH, width: minColWidth, height: totalHeight }
                  : { minWidth: minColWidth, height: totalHeight }
                }
                onClick={(e) => handleColumnClick(e, currentDate, unassignedCol)}
              >
                {renderGridLines()}
                {renderIntervalLines()}
                {renderNowIndicator(currentDate)}
                <DroppableColumn
                  id={droppableId}
                  data={{ day: currentDate, colId: unassignedCol.id, openHour, totalHeight }}
                  height={totalHeight}
                  isActive={!!activeDragId}
                />
                {/* Compact overlap rendering for unassigned column */}
                {(() => {
                  const clusters = clusterOverlapping(colBookings);
                  return clusters.map((cluster) => {
                    const layout = getOverlapLayout(cluster.length, minColWidth);
                    return cluster.slice(0, MAX_VISIBLE_OVERLAP).map((booking, idx) => {
                      const pos = layout.cards[idx];
                      return (
                        <CalendarBookingCard
                          key={booking.id}
                          booking={booking}
                          columnMode={columnMode}
                          style={{
                            top: timeToTop(booking.startTime),
                            height: timeToHeight(booking.startTime, booking.endTime),
                            ...(pos ? { left: pos.left, width: pos.width, right: 'auto' } : {}),
                          }}
                          onClick={onBookingClick}
                        />
                      );
                    }).concat(
                      layout.badge ? (
                        <OverflowBadge
                          key={`badge-${cluster[0].id}`}
                          count={layout.badge.count}
                          style={{
                            top: timeToTop(cluster[0].startTime),
                            height: timeToHeight(cluster[0].startTime, cluster[0].endTime),
                            left: layout.badge.left,
                            width: layout.badge.width,
                            right: 'auto',
                          }}
                        />
                      ) : []
                    );
                  });
                })()}
              </div>
            );
          })()}
          <div className="flex flex-1 relative overflow-hidden" style={{ minWidth: regularMinWidth }}>
            {renderGridLines()}
            {renderNowIndicator(currentDate)}
            {regularColumns.map(col => renderColumn(col, currentDate))}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Multi-day (4-day) view ────────────────────────────────
  const daysMinWidth = days.length * minColWidth;

  const renderMultiDayView = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Fixed header — outside scroll container */}
      <div
        ref={headerScrollRef}
        className="flex-shrink-0 z-header bg-background border-b-2 border-border overflow-hidden"
      >
        <div className="flex" style={{ width: '100%', minWidth: TIME_COL_WIDTH + daysMinWidth }}>
          <div className="flex-shrink-0 border-r border-border sticky left-0 bg-background" style={{ width: TIME_COL_WIDTH }} />
          <div className="flex flex-1" style={{ minWidth: daysMinWidth }}>
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
      {/* Scrollable grid body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-scroll overflow-y-auto calendar-grid-scroll"
        onScroll={(e) => {
          if (headerScrollRef.current) {
            headerScrollRef.current.scrollLeft = e.target.scrollLeft;
          }
        }}
      >
        <div
          ref={gridBodyRef}
          className="flex relative"
          style={{ height: totalHeight, width: '100%', minWidth: TIME_COL_WIDTH + daysMinWidth }}
          data-open-hour={openHour}
          data-hour-height={HOUR_HEIGHT}
        >
          {renderTimeLabels()}
          <div className="flex flex-1 relative" style={{ minWidth: daysMinWidth }}>
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
                  className={`flex-1 relative cursor-pointer ${di < days.length - 1 ? 'border-r-2 border-border' : ''} ${isCurrentDay ? 'bg-primary/[0.02]' : ''}`}
                  style={{ minWidth: minColWidth }}
                  onClick={(e) => {
                    if (activeDragId || !onEmptySlotClick) return;
                    const relativeY = e.clientY - e.currentTarget.getBoundingClientRect().top - TOP_PAD;
                    const minutesFromTop = (relativeY / HOUR_HEIGHT) * 60;
                    const hour = Math.floor(minutesFromTop / 60) + openHour;
                    const minute = Math.floor((minutesFromTop % 60) / 5) * 5;
                    if (hour < openHour || hour >= closeHour) return;
                    onEmptySlotClick({ day, colId: 'all', colName: formatShortDate(day), colType: 'day', hour, minute });
                  }}
                >
                  {/* Dashed interval lines with hover tooltips — per-column so hover works */}
                  {renderIntervalLines()}

                  {/* Single droppable zone for the entire day column (sibling to booking cards) */}
                  <DroppableColumn
                    id={droppableId}
                    data={{ day, colId: 'all', openHour, totalHeight }}
                    height={totalHeight}
                    isActive={!!activeDragId}
                  />

                  {/* Now indicator */}
                  {isCurrentDay && nowTop >= 0 && nowTop <= totalHeight && (
                    <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                      <div className="h-0.5 bg-primary" />
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

  return (
    <>
      {isMultiDay ? renderMultiDayView() : renderDayView()}
      {headerTooltip && (
        <div
          className="fixed px-2 py-1 bg-text-primary text-white text-[10px] font-body rounded whitespace-nowrap z-dropdown pointer-events-none"
          style={{ left: headerTooltip.x, top: headerTooltip.y, transform: 'translateX(-50%)' }}
        >
          {headerTooltip.name}
        </div>
      )}
    </>
  );
};

export default CalendarGrid;
