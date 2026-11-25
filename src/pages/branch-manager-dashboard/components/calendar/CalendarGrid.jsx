import { buildClientIndex, customerIdOf, isSameClient, clientDayInfo } from './sameClient';
import { buildVisitIndex, bookingOf, highlightLevel, visitDayInfo } from './sameVisit';
import { useOrg } from '../../../../contexts/OrgContext';
import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import Icon from '../../../../components/AppIcon';
import CalendarBookingCard from './CalendarBookingCard';
import { BookingHoverLayer, useHoverCardBookingId } from './BookingHoverCard';
import { toKathmanduParts, addDays } from './calendarDates';
import { formatClockTime, formatHourLabel, formatClockRange } from '../../../../utils/clockTime';
import SharedBookingLines from './SharedBookingLines';
import { STATUS_DOT_COLOR, isClosedByBlocks } from '../../../../utils/todayStatusLine';
import OverflowBadge from './OverflowBadge';
import { useViewportWidth, PHONE_MAX } from '../../../../hooks/useViewportWidth';
import { transferShadeSegments, dedupeAgainst } from '../../../../utils/transferShade';
import { pickTouchAxis, createWheelBurst, snapTarget, coastTarget } from './scrollAxisLock';
import TransferHeaderLine, { describeColumnTransfer, describeTransferOnDay } from './TransferHeaderLine';
import { useIndustry } from '../../../../hooks/useIndustry';
import ManualBlockOverlay from './ManualBlockOverlay';
import {
  MAX_VISIBLE_OVERLAP,
  OVERLAP_PADDING,
  BADGE_MIN_HEIGHT,
  clusterOverlapping,
  clusterEndTime,
  earliestStartTime,
  getOverlapLayout,
} from './calendarLayout';
import { bookingPanelPx } from '../../../../components/ui/SidePanel';
import { scrollIntoTopBand } from '../../../../utils/gestures';
import { findBlockOverlap, formatBlockRange } from '../../../../utils/blockOverlap';
import { SHADE_STYLES, buildShadeSegments, shiftHeaderInfo, slotVerdict, outsideReasonText, outsideNote } from '../../../../services/availabilityShading';
import { hhmmToMinutes } from '../../../../services/availability';
import { staffWord, wordBranch } from '../../../../utils/industryTerms';
import BottomSheet from '../../../../components/ui/BottomSheet';
import {
  PHONE_HOUR_BASE, PHONE_MAX_LANES, phoneColumnCount, phoneColumnWidth, clampPhoneZoom, assignPhoneLanes, coupleName, shortName, avatarColor,
} from './phoneCalendarLayout';

// Export these constants for time calculation in parent
export const SLOT_HEIGHT = 36; // px per 30-min slot (72px per hour) - for visual grid lines
export const HOUR_HEIGHT = SLOT_HEIGHT * 2; // 72px per hour
const TIME_COL_WIDTH_DESKTOP = 44; // one gutter width for phone and desktop (see PHONE_TIME_COL)
// Phone (< md): 100px-minimum staff columns (3 at 360-430), taller hours, Unassigned becomes a bar above the grid (ZNLY-299, phoneCalendarLayout.js).
const PHONE_TIME_COL = 44; // keep equal to TIME_COL_WIDTH_DESKTOP
const PINNED_SHADOW = '6px 0 8px -6px rgba(14,13,12,0.16)'; // right shadow on the pinned Unassigned column while the grid is scrolled

// Pinch-to-zoom bounds (mobile/touch only) — effective hour height 40px–320px
export const MIN_ZOOM = 40 / HOUR_HEIGHT;
export const MAX_ZOOM = 320 / HOUR_HEIGHT;
export const clampZoom = (v) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));
const touchDistance = (t0, t1) => Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Single source of truth for resolving a non-shared booking's assigned
// therapist for display and column-bucketing. Two storage representations
// exist for the same fact — the flat bookings.therapist_id column (primary)
// and the booking_therapists junction table (secondary/legacy source, also
// used for shared/multi-therapist bookings via a separate path) — plus a
// third, independent axis: whether that therapist is visible under the
// CURRENT view filter (All Positions / attendance-absent / service-only).
// Every call site that needs "which therapist does this booking belong to"
// must go through this function. Do not re-derive this inline at a new call
// site — extend the truth table this function encodes instead.
function resolveSingleTherapist(booking, therapistMap) {
  const junctionRow = booking.booking_therapists?.length === 1 ? booking.booking_therapists[0] : null;

  // Priority order: flat column first (primary), junction row second.
  const candidates = [
    booking.therapist_id ? { id: booking.therapist_id, name: booking.therapist?.name || null } : null,
    junctionRow ? { id: junctionRow.therapist_id, name: junctionRow.therapist?.name || null } : null,
  ].filter(Boolean);

  // First candidate that's actually visible in the current filtered view wins.
  const visible = candidates.find(c => isTherapistVisible(c.id, therapistMap));

  // Display name is always populated if ANY candidate exists — prefer the
  // resolved-visible candidate's live name (reflects renames), else fall
  // back to the highest-priority (flat) candidate's embedded snapshot name
  // so the card never goes blank just because the therapist is currently
  // absent/filtered.
  const displayName = visible
    ? (therapistMap[visible.id] || visible.name)
    : (candidates[0]?.name || null);

  return {
    id: visible ? visible.id : null,   // colId / baseEntry.therapistId — null means treat as unassigned
    name: displayName,                  // baseEntry.therapistName — always populated if any assignment exists
  };
}

// Shared visibility check, used by resolveSingleTherapist above AND by the
// isShared (multi-therapist) per-entry loop below — do not duplicate this
// check inline at either site.
function isTherapistVisible(therapistId, therapistMap) {
  return therapistMap[therapistId] !== undefined;
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

// Per-view differences in the inside of a grid column (see renderColumnBody in CalendarGrid). Each flag is one
// explicit difference, so unifying a view later is a one-line change here:
//   gridLines         draw the hour/half-hour hairlines inside the column (otherwise the parent row draws them once)
//   nowLine           draw the now-line inside the column, before or after the droppable zone (null: the parent row draws it)
//   shading           per-therapist availability shading (off shift / break / leave / other branch), see renderShadeOverlays
//   checkoutOverlay   grey "Checked out" shading for a therapist who has clocked out for the day
//   cardInteractions  shared-booking card resize + Cmd/Ctrl multi-select on the cards
const COLUMN_BODY = {
  // Day view: therapist or room column
  column: { gridLines: false, nowLine: null, shading: true, checkoutOverlay: true, cardInteractions: true },
  // Day view: pinned Unassigned column
  unassigned: { gridLines: true, nowLine: 'before-droppable', shading: false, checkoutOverlay: false, cardInteractions: false },
  // 4-Day view: one column per day, all therapists/rooms merged
  multiDay: { gridLines: false, nowLine: 'after-droppable', shading: false, checkoutOverlay: false, cardInteractions: false },
};

// Black tooltip under a column header: centred on the cell, wrapped at 420px, and kept 8px inside the window on both sides.
const HeaderTooltip = ({ tip }) => {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    el.style.left = `${Math.max(8, Math.min(tip.x - w / 2, window.innerWidth - 8 - w))}px`;
  }, [tip]);
  return (
    <div
      ref={ref}
      className="fixed px-2 py-1 bg-text-primary text-white text-[10px] font-body rounded z-dropdown pointer-events-none"
      style={{ left: tip.x, top: tip.y, maxWidth: 'min(420px, calc(100vw - 16px))', width: 'max-content' }}
    >
      {tip.name}
    </div>
  );
};

const CalendarGrid = ({
  therapists,
  rooms = [],
  bookings,
  branchHours,
  attendanceMap,
  attendanceByTherapist,
  shiftsByTherapist = {},
  checkedOutByTherapistAndDate,
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
  hideUnassigned = false, // own-only login (ZNLY-278): no Unassigned column, it would show colleagues' work
  onToggleFreezeUnassigned,
  onTherapistReorder,
  onRoomReorder,
  blockOccurrences,
  onDeleteManualBlock,
  onResizeManualBlock,
  onEditManualBlock,
  pickMode = false,
  draftGhost,
  selectedBookingId,
  onDragCreate,
  overlapOccurrences,
  onEditTransfer,
  hideSensitive = false,
  startHour,
  endHour,
  showFullDay = false,
  intervalMinutes = 30,
  use24h = false,
  zoomScale: zoomScaleProp,
  onZoomScaleChange,
  onOpenUnassigned, // phone Unassigned bar: opens the Assign list (undefined = this login cannot assign: no bar)
  assignCount = null, // therapist view: the Assign list's first-group count for the day shown (needsStaff), so bar, link and list agree
  onOpenAssignList, // desktop: "Assign ›" link under the count in the Unassigned column header
}) => {
  const { locationLabel } = useIndustry();
  const scrollRef = useRef(null);
  const gridBodyRef = useRef(null);

  // Linked highlight for shared bookings: the booking under the pointer/focus (cleared after a short delay so moving
  // between its copies doesn't flicker), falling back to the one open in the side panel.
  const [hoverSharedId, setHoverSharedId] = useState(null);
  const sharedClearTimer = useRef(null);
  const activateShared = useCallback((id) => {
    clearTimeout(sharedClearTimer.current);
    setHoverSharedId(id);
  }, []);
  const deactivateShared = useCallback(() => {
    clearTimeout(sharedClearTimer.current);
    sharedClearTimer.current = setTimeout(() => setHoverSharedId(null), 100);
  }, []);
  useEffect(() => () => clearTimeout(sharedClearTimer.current), []);
  // ZNLY-281: same-client highlight. Any card under the pointer/focus (or open in a popover / the panel) lights up that client's other cards on screen.
  const [hoverClientId, setHoverClientId] = useState(null);
  const clientClearTimer = useRef(null);
  const activateClient = useCallback((id) => { clearTimeout(clientClearTimer.current); setHoverClientId(id); }, []);
  const deactivateClient = useCallback(() => { clearTimeout(clientClearTimer.current); clientClearTimer.current = setTimeout(() => setHoverClientId(null), 100); }, []);
  useEffect(() => () => clearTimeout(clientClearTimer.current), []);
  const popoverBookingId = useHoverCardBookingId();
  const activeSharedId = hoverSharedId || popoverBookingId || selectedBookingId || null;
  // ZNLY-402: the visit rules (sameVisit.js) only for orgs with "Several services in one booking" ON; every other org keeps the same-client rules (sameClient.js) exactly as before.
  const { multiServiceBookings } = useOrg();
  const clientIndex = useMemo(() => (multiServiceBookings ? buildVisitIndex(bookings) : buildClientIndex(bookings)), [bookings, multiServiceBookings]); // one map for the whole render, no per-card scans
  const activeKey = hoverClientId || popoverBookingId || selectedBookingId || null;
  const activeBooking = useMemo(() => (multiServiceBookings ? bookingOf(bookings, activeKey) : null), [bookings, activeKey, multiServiceBookings]);
  const activeCustomerId = useMemo(() => (multiServiceBookings ? null : customerIdOf(bookings, activeKey)), [bookings, activeKey, multiServiceBookings]);
  // Hide the connector of the booking being dragged (its copies are mid-move); it redraws from fresh data on drop.
  const draggingSharedId = activeDragId ? String(activeDragId).split('__')[0] : null;

  const days = useMemo(() => {
    if (viewMode === '4day') return [0, 1, 2, 3].map(i => addDays(currentDate, i));
    if (viewMode === 'week') {
      // Sunday-first, must match calendar/index.jsx's own startOfWeek so the fetched range and rendered columns agree.
      const start = addDays(currentDate, -new Date(currentDate + 'T00:00:00').getDay());
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    return [currentDate];
  }, [currentDate, viewMode]);

  const isMultiDay = days.length > 1;
  const viewportW = useViewportWidth();
  const isPhone = viewportW <= PHONE_MAX;
  const TIME_COL_WIDTH = isPhone ? PHONE_TIME_COL : TIME_COL_WIDTH_DESKTOP;
  const phoneDay = isPhone && !isMultiDay; // single-day phone grid: 100px-min staff columns, 96px hours, Unassigned as a bar

  // ── Pinch-to-zoom (mobile/touch only) ──────────────────────
  // Relayouts the grid at a scaled HOUR_HEIGHT/column width rather than a CSS
  // transform, so drag/tap hit-testing (which reads real DOM pixel positions)
  // stays correct at any zoom level.
  // Controlled by the parent toolbar's zoom buttons when onZoomScaleChange is passed; local state otherwise.
  const [zoomScaleState, setZoomScaleState] = useState(1);
  const zoomScaleRaw = zoomScaleProp != null ? zoomScaleProp : zoomScaleState;
  const zoomScale = isPhone ? clampPhoneZoom(zoomScaleRaw) : zoomScaleRaw; // phones: zoom only goes up (a saved 55% reads as 100%)
  const isPhoneRef = useRef(isPhone);
  isPhoneRef.current = isPhone;
  const zoomScaleRef = useRef(zoomScale);
  useEffect(() => { zoomScaleRef.current = zoomScale; }, [zoomScale]);
  const setZoomScale = useCallback((v) => {
    const clamped = isPhoneRef.current ? clampPhoneZoom(clampZoom(v)) : clampZoom(v);
    zoomScaleRef.current = clamped;
    if (onZoomScaleChange) onZoomScaleChange(clamped);
    else setZoomScaleState(clamped);
  }, [onZoomScaleChange]);
  const pinchStateRef = useRef(null); // { startDist, startScale }
  const pinchAnchorRef = useRef(null); // { viewportX, viewportY, contentX, contentY }
  const pinchRAFRef = useRef(null);

  // ZNLY-302 axis lock, built so nothing fights the browser:
  //  - Phone: the body is `touch-action: pan-y`, so vertical is 100% native and can never drift sideways. A horizontal-dominant
  //    drag is ours: it moves scrollLeft with the finger (header and gutter live in the same scroller, so nothing can lag),
  //    and on release eases to the nearest staff column (or the next one on a flick; Week / 4-day coast instead of snapping).
  //  - Desktop wheel / trackpad: events pass through untouched unless clearly diagonal; those get the minor axis dropped and
  //    are applied once per animation frame. Shift+wheel is left to the browser.
  // The values it needs live in a ref (assigned each render, after they are declared) so this effect never reads them early.
  const lockCfgRef = useRef({ phoneDay: false, colW: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const st = { touching: false, x0: 0, y0: 0, sl: 0, axis: null, dragging: false, multi: false, lastLeft: 0, lastT: 0, v: 0, raf: null };
    const cancelAnim = () => { if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; } };
    const maxLeft = () => Math.max(0, el.scrollWidth - el.clientWidth);
    const animateTo = (target) => {
      const from = el.scrollLeft;
      if (Math.abs(target - from) < 1) { el.scrollLeft = target; return; }
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 220);
        el.scrollLeft = from + (target - from) * (1 - Math.pow(1 - k, 3));
        st.raf = k < 1 ? requestAnimationFrame(step) : null;
      };
      st.raf = requestAnimationFrame(step);
    };
    // Phone Day: after any scroll that wasn't a finger drag (Assign scroll-to-card, retarget...) settle on a whole column.
    let settleT = null;
    const onScrollSettle = () => {
      const cfg = lockCfgRef.current;
      if (!cfg.phoneDay || st.touching || st.raf) return;
      clearTimeout(settleT);
      settleT = setTimeout(() => {
        if (st.touching || st.raf) return;
        const target = snapTarget({ left: el.scrollLeft, velocity: 0, colW: cfg.colW, max: maxLeft() });
        if (Math.abs(target - el.scrollLeft) > 1) animateTo(target);
      }, 140);
    };
    const onStart = (e) => {
      st.touching = true;
      cancelAnim();
      if (e.touches.length > 1) { st.multi = true; st.axis = null; st.dragging = false; return; }
      st.multi = false; st.axis = null; st.dragging = false; st.v = 0;
      st.x0 = e.touches[0].clientX; st.y0 = e.touches[0].clientY; st.sl = el.scrollLeft;
      st.lastLeft = st.sl; st.lastT = e.timeStamp;
    };
    const onMove = (e) => {
      if (st.multi || e.touches.length > 1) return;
      const x = e.touches[0].clientX;
      if (!st.axis) st.axis = pickTouchAxis(st.x0 - x, st.y0 - e.touches[0].clientY);
      if (st.axis !== 'x' || el.closest('.scroll-locked')) return;
      st.dragging = true;
      const left = Math.max(0, Math.min(maxLeft(), st.sl + (st.x0 - x)));
      el.scrollLeft = left;
      const dt = e.timeStamp - st.lastT;
      if (dt > 0) { st.v = 0.7 * ((left - st.lastLeft) / dt) + 0.3 * st.v; st.lastLeft = left; st.lastT = e.timeStamp; }
    };
    const onEnd = (e) => {
      if (e.touches.length > 0) return;
      st.touching = false;
      if (st.multi) { st.multi = false; return; }
      if (!st.dragging) return;
      st.dragging = false;
      // the finger that dragged must not also "tap" the card it lifted from
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener('click', swallow, true);
      setTimeout(() => el.removeEventListener('click', swallow, true), 350);
      const cfg = lockCfgRef.current;
      const quiet = e.timeStamp - st.lastT > 100; // finger rested before lifting: no flick
      const v = quiet ? 0 : st.v;
      animateTo(cfg.phoneDay
        ? snapTarget({ left: el.scrollLeft, velocity: v, colW: cfg.colW, max: maxLeft() })
        : coastTarget({ left: el.scrollLeft, velocity: v, max: maxLeft() }));
    };
    let wx = 0; let wy = 0; let wraf = null;
    const burst = createWheelBurst();
    const onWheel = (e) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.deltaMode !== 0) return;
      const r = burst.feed(e.timeStamp, e.deltaX, e.deltaY);
      if (!r.changed) return;
      e.preventDefault();
      wx += r.dx; wy += r.dy;
      if (wraf) return;
      wraf = requestAnimationFrame(() => { wraf = null; el.scrollBy(wx, wy); wx = 0; wy = 0; });
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onScrollSettle, { passive: true });
    return () => {
      cancelAnim(); clearTimeout(settleT); el.removeEventListener('scroll', onScrollSettle); if (wraf) cancelAnimationFrame(wraf);
      el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, [viewMode]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleTouchStart = (e) => {
      if (e.touches.length !== 2) return;
      pinchStateRef.current = {
        startDist: touchDistance(e.touches[0], e.touches[1]),
        startScale: zoomScaleRef.current,
      };
    };

    const handleTouchMove = (e) => {
      if (e.touches.length !== 2 || !pinchStateRef.current) return;
      e.preventDefault();
      if (pinchRAFRef.current) return;
      const touches = e.touches;
      pinchRAFRef.current = requestAnimationFrame(() => {
        pinchRAFRef.current = null;
        const { startDist, startScale } = pinchStateRef.current || {};
        if (!startDist) return;
        const dist = touchDistance(touches[0], touches[1]);
        const nextScale = clampZoom(startScale * (dist / startDist));

        const midX = (touches[0].clientX + touches[1].clientX) / 2;
        const midY = (touches[0].clientY + touches[1].clientY) / 2;
        const rect = el.getBoundingClientRect();
        const viewportX = midX - rect.left;
        const viewportY = midY - rect.top;
        const prevScale = zoomScaleRef.current;
        pinchAnchorRef.current = {
          viewportX,
          viewportY,
          contentX: (el.scrollLeft + viewportX) / prevScale,
          contentY: (el.scrollTop + viewportY) / prevScale,
        };
        setZoomScale(nextScale);
      });
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length < 2) pinchStateRef.current = null;
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
      if (pinchRAFRef.current) cancelAnimationFrame(pinchRAFRef.current);
    };
  }, [setZoomScale, viewMode]);

  // Re-anchor scroll under the pinch midpoint once the zoomed layout has committed
  useLayoutEffect(() => {
    const anchor = pinchAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el) return;
    el.scrollLeft = anchor.contentX * zoomScale - anchor.viewportX;
    el.scrollTop = anchor.contentY * zoomScale - anchor.viewportY;
    pinchAnchorRef.current = null;
  }, [zoomScale]);

  // Effective hour height. Phone day view: 96px at 100% (desktop and phone multi-day stay 72px); zoom scales both the same way.
  const eHH = (phoneDay ? PHONE_HOUR_BASE : HOUR_HEIGHT) * zoomScale;
  const eSlot = eHH / 2; // effective 30-min slot height

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

  // Visible hour range: branch hours padded by 1h each side, extended to include
  // any booking on a displayed day that falls outside it. Falls back to 9–21.
  // Calendar settings: startHour/endHour are the configured business hours (override the branch-hours default); showFullDay
  // renders 00:00-24:00 with the hours outside business hours shaded.
  const { openHour, closeHour, businessStartHour, businessEndHour } = useMemo(() => {
    const hourOf = (t, fallback) => {
      const n = parseInt(String(t || '').split(':')[0], 10);
      return Number.isNaN(n) ? fallback : n;
    };
    const minsOf = (t) => {
      const [h, m] = String(t || '').split(':').map(Number);
      return Number.isNaN(h) ? null : h * 60 + (m || 0);
    };
    let open = hourOf(branchHours?.openTime, 9);
    let closeMins = minsOf(branchHours?.closeTime);
    let close = closeMins == null ? 21 : Math.ceil(closeMins / 60);
    open = Math.max(0, open - 1);
    close = Math.min(24, close + 1);
    (bookings || []).forEach(b => {
      const date = b.date || (b.start_datetime ? b.start_datetime.split('T')[0] : null);
      if (!date || !days.includes(date)) return;
      const st = b.start_time || (b.start_datetime ? b.start_datetime.split('T')[1]?.slice(0, 8) : null);
      const et = b.end_time || (b.end_datetime ? b.end_datetime.split('T')[1]?.slice(0, 8) : null);
      const sm = minsOf(st);
      const em = minsOf(et);
      if (sm != null) open = Math.min(open, Math.floor(sm / 60));
      if (em != null) close = Math.max(close, Math.min(24, Math.ceil(em / 60)));
    });
    if (close <= open) close = Math.min(24, open + 1);
    if (Number.isInteger(startHour) && Number.isInteger(endHour) && endHour > startHour) {
      // configured hours replace the branch-hours padding but never hide a booking that falls outside them
      let o = startHour; let c = endHour;
      (bookings || []).forEach(b => {
        const date = b.date || (b.start_datetime ? b.start_datetime.split('T')[0] : null);
        if (!date || !days.includes(date)) return;
        const st = b.start_time || (b.start_datetime ? b.start_datetime.split('T')[1]?.slice(0, 8) : null);
        const et = b.end_time || (b.end_datetime ? b.end_datetime.split('T')[1]?.slice(0, 8) : null);
        const sm = minsOf(st); const em = minsOf(et);
        if (sm != null) o = Math.min(o, Math.floor(sm / 60));
        if (em != null) c = Math.max(c, Math.min(24, Math.ceil(em / 60)));
      });
      open = o; close = c;
    }
    const bizStart = Number.isInteger(startHour) ? startHour : hourOf(branchHours?.openTime, 9);
    const bizEnd = Number.isInteger(endHour) && endHour > bizStart ? endHour : (closeMins == null ? 21 : Math.ceil(closeMins / 60));
    if (showFullDay) return { openHour: 0, closeHour: 24, businessStartHour: bizStart, businessEndHour: bizEnd };
    return { openHour: open, closeHour: close, businessStartHour: bizStart, businessEndHour: bizEnd };
  }, [branchHours, bookings, days, startHour, endHour, showFullDay]);

  const TOP_PAD = 12;  // breathing room above the first hour line

  const hours = useMemo(() => {
    const result = [];
    for (let h = openHour; h < closeHour; h++) result.push(h);
    return result;
  }, [openHour, closeHour]);

  const totalHeight = hours.length * eHH + TOP_PAD;

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
      if (!phoneDay) cols.push({ id: 'unassigned', name: 'No Room', type: 'unassigned', icon: 'AlertCircle', subtitle: null, attendance: null });
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
      transferredOut: t.transferredOut,
      transferredIn: t.transferredIn,
      transferId: t.transferId,
      returnsAt: t.returnsAt,
      transferStartAt: t.transferStartAt,
      fromBranch: t.fromBranch,
      scheduledTransfer: t.scheduledTransfer,
      plannedRevertAt: t.plannedRevertAt,
      transferReverted: t.transferReverted,
      transferRevertedAt: t.transferRevertedAt,
      transferFromBranch: t.transferFromBranch,
      transferToBranch: t.transferToBranch,
    }));
    if (!hideUnassigned && !phoneDay) cols.push({ id: 'unassigned', name: 'Unassigned', type: 'unassigned', icon: 'AlertCircle', subtitle: null, attendance: null });
    return cols;
  }, [therapists, rooms, attendanceMap, columnMode, hideUnassigned, phoneDay]);

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
      // Combo service: booking_combo_items carries one row per bundled service, each with its own therapist/time slice.
      // Takes priority over isShared (a combo's primary therapist_id/booking_therapists must not render a second overlapping card).
      const isCombo = b.booking_combo_items?.length > 0;
      const isShared = !isCombo && columnMode === 'therapist' && b.booking_therapists?.length > 1;
      // Couple in separate rooms: each therapist's effective room is their own booking_therapists.room_id override,
      // falling back to the booking's primary room. >1 distinct effective room means the booking needs a card in each.
      const effectiveRoomIds = !isCombo && columnMode === 'room' && b.booking_therapists?.length > 0
        ? [...new Set(b.booking_therapists.map(bt => bt.room_id || b.room_id).filter(Boolean))]
        : [];
      const isRoomShared = !isCombo && columnMode === 'room' && effectiveRoomIds.length > 1;
      const { id: visibleTherapistId, name: therapistName } = isShared
        ? { id: null, name: b.booking_therapists.map(bt => therapistMap[bt.therapist_id] || bt.therapist?.name).filter(Boolean).join(', ') }
        : isCombo
          ? { id: null, name: b.booking_combo_items.map(ci => therapistMap[ci.therapist_id] || ci.therapist?.name).filter(Boolean).join(', ') }
          : resolveSingleTherapist(b, therapistMap);

      const baseEntry = {
        id: b.id,
        bookingId: b.id,
        bookingNumber: b.booking_number,
        customerName: b.customer_name,
        customerPhone: b.customer_phone || null,
        companionName: b.companion_name || null, // couple: the second guest's name
        isWalkIn: !!b.is_walk_in, // ZNLY-327: customerName already reads "Walk-in · <label>"
        customerId: b.customer_id || null, // ZNLY-281: same-client highlight matches on this id only
        visitId: b.visit_id || null, // ZNLY-402: same-visit link (NULL = its own visit); utils/visit.js
        serviceName: b.service?.name || 'Service',
        serviceDuration: b.service?.duration_minutes || null,
        status: b.status,
        paymentStatus: b.payment_status,
        isLocked: b.is_locked || false,
        startTime,
        endTime,
        createdAt: b.created_at || null,
        date: bookingDate,
        therapistId: visibleTherapistId,
        roomId: b.room_id,
        therapistName,
        roomName: b.room?.name || roomMap[b.room_id] || null,
        baseAmount: b.base_amount,
        discountAmount: b.discount_amount,
        finalAmount: b.final_amount,
        // Set by the API when this account isn't permitted to see money, so the
        // card can show ••• rather than the "—" it uses for a genuinely absent amount.
        pricesWithheld: b.pricesWithheld === true,
        specialRequests: b.special_requests || null,
        customerNotes: b.customerNotes,   // customers.notes (undefined if the lookup failed)
        referredBy: b.referred_by || null,
        previousDue: b.previousDue,     // { count, amount } | null | undefined
        isNewCustomer: !!b.isNewCustomer,
        createdByName: b.creator?.full_name || null,
        // Booked through the public online flow (no staff creator), and whether the service needs a therapist at all.
        isOnline: !b.created_by,
        // Payment rows (only when this account may see money): drives the half-filled payment tag and the package/voucher icon.
        payments: Array.isArray(b.payments) ? b.payments.map(pm => ({ amount: Number(pm.amount || 0), paymentMode: pm.payment_mode })) : [],
        amountPaid: Array.isArray(b.payments) ? b.payments.reduce((t, pm) => t + Number(pm.amount || 0), 0) : undefined,
        requiresTherapist: b.service?.requires_therapist !== false,
        isShared,
        sharedCount: isShared ? b.booking_therapists.length : 0,
        isCombo,
        comboCount: isCombo ? b.booking_combo_items.length : 0,
      };

      if (isCombo) {
        // One card per component, each in its own therapist's (or room's) column at the component's own start/end time.
        // An unassigned component lands in the 'unassigned' column rather than being dropped.
        const columnOrder = columns.map(c => c.id);
        const orderedItems = [...b.booking_combo_items].sort((a, c) => (a.display_order ?? 0) - (c.display_order ?? 0));
        const resolvedColIds = orderedItems.map(ci => {
          if (columnMode === 'room') return (ci.room_id || b.room_id) || 'unassigned';
          return ci.therapist_id && isTherapistVisible(ci.therapist_id, therapistMap) ? ci.therapist_id : 'unassigned';
        });
        const leftmostId = columnOrder.find(cid => resolvedColIds.includes(cid)) ?? 'unassigned';
        orderedItems.forEach((ci, index) => {
          const colId = resolvedColIds[index];
          if (!map[bookingDate][colId]) map[bookingDate][colId] = [];
          map[bookingDate][colId].push({
            ...baseEntry,
            serviceName: ci.service?.name || baseEntry.serviceName,
            serviceDuration: ci.service?.duration_minutes || null,
            roomId: ci.room_id || b.room_id,
            roomName: roomMap[ci.room_id] || baseEntry.roomName,
            _colTherapistId: columnMode === 'room' ? baseEntry.therapistId : colId,
            _colRoomId: columnMode === 'room' ? colId : undefined,
            _isFaded: colId !== leftmostId,
            _comboIndex: index,
            startTime: ci.start_time || startTime,
            endTime: ci.end_time || endTime,
            _bookingStartTime: startTime,
            _bookingEndTime: endTime,
          });
        });
      } else if (isShared) {
        // Place booking in each assigned therapist's column with per-therapist times
        // Leftmost column in current visual order = primary (unfaded), rest = faded
        const columnOrder = columns.map(c => c.id);
        const assignedIds = b.booking_therapists.map(bt => bt.therapist_id);
        const leftmostId = columnOrder.find(cid => assignedIds.includes(cid));

        b.booking_therapists.forEach(bt => {
          const colId = bt.therapist_id;
          // Skip co-therapists currently filtered out of view — same reasoning as
          // resolveSingleTherapist: an id with no rendered column must not create
          // a silent orphan bucket.
          if (!isTherapistVisible(colId, therapistMap)) return;
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
      } else if (isRoomShared) {
        // One card per distinct room the couple's therapists are in (companions sharing a room render as one card).
        // Reuses the shared-card connector (data-shared / data-booking-id); drag is locked on these cards.
        const columnOrder = columns.map(c => c.id);
        const leftmostRoomId = columnOrder.find(cid => effectiveRoomIds.includes(cid));
        effectiveRoomIds.forEach(rid => {
          if (!map[bookingDate][rid]) map[bookingDate][rid] = [];
          map[bookingDate][rid].push({
            ...baseEntry,
            _colRoomId: rid,
            _isFaded: rid !== leftmostRoomId,
            isRoomShared: true,
            roomName: roomMap[rid] || null,
          });
        });
      } else {
        const colId = columnMode === 'room'
          ? (b.room_id || 'unassigned')
          : (visibleTherapistId || 'unassigned');
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
    return ((h - openHour) * 60 + m) / 60 * eHH + TOP_PAD;
  };

  const timeToHeight = (startStr, endStr) => {
    if (!startStr || !endStr) return eSlot;
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    let rawMinutes = (eh * 60 + em) - (sh * 60 + sm);
    // A manual block spanning exactly 1440 minutes (whole-day holiday from 00:00) has identical start/end clock times:
    // treat 0 like a negative (wrapped past midnight) so it renders full-day, not as a sliver.
    if (rawMinutes <= 0) rawMinutes += 1440;
    return Math.max(rawMinutes / 60 * eHH, 24);
  };

  const openHourStr = `${String(openHour).padStart(2, '0')}:00`;
  const closeHourStr = `${String(closeHour).padStart(2, '0')}:00`;

  // ── Keep the draft ghost fully visible beside the open side panel ─────────────────────────────
  // The panel overlays the right ~420px of the screen (nothing underneath moves). When it opens, and whenever the draft
  // retargets, scroll the grid's OWN scroll container so the draft column sits fully inside [grid left, viewport − panel]
  // (~24px margin), vertically too if the time is off screen; a column that is already visible isn't scrolled. While the
  // panel is open a trailing spacer (= panel width) gives even the last column room to scroll clear of the panel; it covers
  // the header row and the body so their scroll positions stay in sync. On close the previous scroll position is restored
  // first and the spacer removed afterwards.
  const draftScrollRestoreRef = useRef(null);
  const [spacerActive, setSpacerActive] = useState(false);
  // Focus target: the quick-create ghost, or the booking card open in the details panel.
  const draftKey = draftGhost
    ? (draftGhost.kind === 'transfer'
      ? `tr|${draftGhost.therapistId}|${draftGhost.date}|${draftGhost.startTime}`
      : `${draftGhost.kind || 'bk'}|${draftGhost.date}|${draftGhost.therapistId || ''}|${draftGhost.roomId || ''}|${draftGhost.startTime}|${draftGhost.durationMinutes}`)
    : (selectedBookingId ? `booking|${selectedBookingId}` : null);
  const focusSelector = draftGhost ? '[data-draft-ghost]' : `[data-booking-key="${selectedBookingId}"]`;
  // The panel's real width (it differs per content: every booking panel shares PANEL_WIDTH_BOOKING); falls back to defaults.
  const panelWidthNow = () => {
    if (window.innerWidth < 768) return 0; // phones: the booking bottom sheet (no side panel)
    const el = document.querySelector('[data-side-panel]');
    if (el && el.getBoundingClientRect().width > 0) return Math.round(el.getBoundingClientRect().width);
    return window.innerWidth >= 1024 ? bookingPanelPx(window.innerWidth) : 400;
  };
  const [spacerW, setSpacerW] = useState(0);
  const gridScrolledRef = useRef(false);
  const [gridScrolled, setGridScrolled] = useState(false); // drives the pinned Unassigned column's right shadow
  const draftSpacer = spacerActive ? spacerW : 0;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = smooth ? 'smooth' : 'auto';
    if (!draftKey) {
      const saved = draftScrollRestoreRef.current;
      draftScrollRestoreRef.current = null;
      scroller.style.paddingBottom = '';
      if (saved) scroller.scrollTo({ left: saved.left, top: saved.top ?? scroller.scrollTop, behavior });
      const t = setTimeout(() => setSpacerActive(false), saved && smooth ? 450 : 0);
      return () => clearTimeout(t);
    }
    if (!draftScrollRestoreRef.current) draftScrollRestoreRef.current = { left: scroller.scrollLeft };
    setSpacerActive(true);
    if (window.innerWidth < 768) {
      // ZNLY-285 phone: the open booking sits in a bottom sheet. A bottom spacer (= sheet height) lets any card scroll clear of it,
      // and the card is scrolled into the visible top 38%. Quick-create / block drafts have their own full-screen sheet: untouched.
      if (draftGhost || !selectedBookingId) return undefined;
      if (draftScrollRestoreRef.current && draftScrollRestoreRef.current.top == null) draftScrollRestoreRef.current.top = scroller.scrollTop;
      const sheetEl = () => document.querySelector('[data-detent-sheet]');
      const applyPad = () => {
        const el = sheetEl();
        const h = el && el.getAttribute('data-detent-sheet') === 'half' ? Math.round(el.getBoundingClientRect().height) : 0;
        scroller.style.paddingBottom = h ? `${h}px` : '';
        return h;
      };
      const ensureVisibleY = () => {
        const h = applyPad();
        const card = gridBodyRef.current?.querySelector(focusSelector);
        if (!card || !h) return;
        const g = card.getBoundingClientRect();
        const sr = scroller.getBoundingClientRect();
        const visTop = sr.top + 48; // sticky column header
        const visBottom = Math.min(sr.bottom, window.innerHeight - h);
        const dy = scrollIntoTopBand(g.top, visTop, visBottom);
        let dx = 0;
        const stickyLeft = TIME_COL_WIDTH + (!isMultiDay && pinUnassigned ? unassignedW : 0);
        if (g.left < sr.left + stickyLeft + 12) dx = g.left - (sr.left + stickyLeft + 12);
        else if (g.right > sr.right - 12) dx = g.right - (sr.right - 12);
        if (dx || dy) scroller.scrollBy({ left: dx, top: dy, behavior });
      };
      const t1 = setTimeout(ensureVisibleY, 260); // after the sheet has slid in and settled at its fixed 62% height
      const el0 = sheetEl();
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(applyPad) : null;
      if (el0 && ro) ro.observe(el0);
      return () => { clearTimeout(t1); ro?.disconnect(); };
    }
    const ensureVisible = () => {
      const panelW = panelWidthNow();
      const ghost = gridBodyRef.current?.querySelector(focusSelector);
      if (!ghost) return;
      const g = ghost.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      const stickyLeft = TIME_COL_WIDTH + (!isMultiDay && pinUnassigned ? unassignedW : 0);
      const visLeft = sr.left + stickyLeft + 24;
      const visRight = Math.min(sr.right, window.innerWidth - panelW) - 24;
      let dx = 0;
      if (g.left < visLeft) dx = g.left - visLeft;
      else if (g.right > visRight) dx = g.right - visRight;
      let dy = 0;
      if (g.top < sr.top + 12) dy = g.top - sr.top - 48;
      else if (g.bottom > sr.bottom - 12) dy = g.bottom - sr.bottom + 48;
      if (dx || dy) scroller.scrollBy({ left: dx, top: dy, behavior });
    };
    // Measure the real panel, size the spacer to it, then (after the spacer rendered) scroll into view.
    let timer2;
    const timer = setTimeout(() => {
      setSpacerW(panelWidthNow());
      timer2 = setTimeout(ensureVisible, 60);
    }, 80);
    return () => { clearTimeout(timer); clearTimeout(timer2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Live preview of the block being added/edited, in its final hatched neutral style; the edge turns red when it sits on
  // existing bookings. Whole-location blocks show on every column; therapist/room blocks only on their own column (therapist /
  // room view respectively), mirroring getManualBlockRanges.
  const renderBlockPreview = (colId, day, colType) => {
    const g = draftGhost;
    const visible = g.wholeBranch
      || (colType === 'therapist' && g.therapistId === colId)
      || (colType === 'room' && g.roomId === colId);
    if (!visible) return null;
    const startMin = Number(g.startTime.slice(0, 2)) * 60 + Number(g.startTime.slice(3, 5));
    const endMin = startMin + (g.durationMinutes || 30);
    const pad = (n) => String(n).padStart(2, '0');
    const endStr = `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
    const h = Math.max(timeToHeight(g.startTime, endStr), 20);
    return (
      <div
        key={`block-preview-${colId}-${day}`}
        data-draft-ghost="true"
        data-block-preview="true"
        className={`absolute inset-x-0.5 rounded-spa pointer-events-none overflow-hidden px-2 py-1 z-0 ${g.overlap ? 'border-[1.5px] border-error' : 'border border-text-tertiary/60'}`}
        style={{
          top: timeToTop(g.startTime),
          height: h,
          // Translucent and below booking cards (DOM order, z-0) so any booking it sits on stays visible and clickable.
          backgroundColor: 'rgba(244,244,246,0.45)',
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(14,13,12,0.025) 0, rgba(14,13,12,0.025) 1px, transparent 1px, transparent 7px)',
        }}
      >
        <div className={`font-body text-[11px] leading-tight truncate ${g.overlap ? 'text-error' : 'text-text-secondary'}`}>{g.label || 'Blocked'}</div>
        {h >= 36 && <div className={`font-body text-[11px] leading-tight truncate ${g.overlap ? 'text-error/80' : 'text-text-tertiary'}`}>{formatClockTime(g.startTime, use24h)}–{formatClockTime(endStr, use24h)}</div>}
      </div>
    );
  };

  // Preview of the transfer window on the therapist's column: shaded from the start moment to the estimated return
  // (or to the end of the open day for a permanent / not-yet-complete transfer).
  const renderTransferPreview = (colId, day, colType) => {
    const g = draftGhost;
    if (colType !== 'therapist' || colId !== g.therapistId || !g.date || !g.startTime || day < g.date) return null;
    if (g.endDate && day > g.endDate) return null;
    if (!g.endDate && !g.permanent && day > g.date) return null;
    const from = day === g.date ? (g.startTime > openHourStr ? g.startTime : openHourStr) : openHourStr;
    let to = closeHourStr;
    if (g.endDate && day === g.endDate && g.endTime) to = g.endTime < closeHourStr ? g.endTime : closeHourStr;
    if (to <= from) return null;
    const h = Math.max(timeToHeight(from, to), 20);
    const back = g.endDate ? `back ${formatBackLabel(g.endDate, g.endTime)}` : g.permanent ? 'permanently' : '';
    return (
      <div
        key={`transfer-preview-${colId}-${day}`}
        data-draft-ghost="true"
        data-transfer-preview="true"
        className="absolute inset-x-0.5 rounded-spa pointer-events-none overflow-hidden px-2 py-1 z-[4] border-[1.5px] border-dashed border-primary/50"
        style={{ top: timeToTop(from), height: h, backgroundColor: 'rgba(45,90,39,0.07)' }}
      >
        <div className="font-body text-[11px] leading-tight text-primary/80 truncate">Transferred{back ? ` · ${back}` : ''}</div>
      </div>
    );
  };
  const formatBackLabel = (ymd, hm) => {
    const [h, m] = (hm || '00:00').split(':').map(Number);
    const t = formatClockTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, use24h);
    if (ymd === todayStr) return t;
    return `${new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${t}`;
  };

  // Dashed "New booking" ghost for the quick-create draft (follows the panel's date / time / therapist / service).
  const renderDraftGhost = (colId, day, colType) => {
    if (!draftGhost) return null;
    if (draftGhost.kind === 'transfer') return renderTransferPreview(colId, day, colType);
    if (!draftGhost.startTime || draftGhost.date !== day) return null;
    if (draftGhost.kind === 'block') return renderBlockPreview(colId, day, colType);
    const ghostColId = colId === 'all'
      ? 'all'
      : (columnMode === 'room' ? (draftGhost.roomId || 'unassigned') : (draftGhost.therapistId || 'unassigned'));
    if (ghostColId !== colId) return null;
    const startMin = Number(draftGhost.startTime.slice(0, 2)) * 60 + Number(draftGhost.startTime.slice(3, 5));
    const endMin = startMin + (draftGhost.durationMinutes || 30);
    const pad = (n) => String(n).padStart(2, '0');
    const endStr = `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
    const range = `${formatClockTime(draftGhost.startTime, use24h)}–${formatClockTime(endStr, use24h)}`;
    const ghostHeight = Math.max(timeToHeight(draftGhost.startTime, endStr), 22);
    const tone = draftGhost.overlap ? 'text-error' : 'text-primary';
    return (
      <div
        data-draft-ghost="true"
        className={`absolute inset-x-0.5 rounded-spa pointer-events-none px-2 py-1 overflow-hidden z-[4] border-[1.5px] border-dashed ${
          draftGhost.overlap ? 'border-error bg-error/[0.06]' : 'border-primary bg-primary/[0.06]'
        }`}
        style={{ top: timeToTop(draftGhost.startTime), height: ghostHeight }}
      >
        {ghostHeight >= 36 ? (
          <>
            <span className={`font-body text-[11px] font-medium leading-tight truncate block ${tone}`}>New booking</span>
            <span className={`font-body text-[11px] leading-tight truncate block ${tone}`}>{range}</span>
          </>
        ) : (
          <span className={`font-body text-[11px] leading-tight truncate block ${tone}`}>{range}</span>
        )}
      </div>
    );
  };

  // Manual-block occurrences covering this column/day as renderable ranges. A block with neither
  // therapistId nor roomId is a whole-branch block and applies to every column (including
  // Unassigned and the 4-day day columns). Therapist/room-scoped blocks only show in the matching
  // view: therapist blocks in therapist mode, room blocks in room mode.
  const getManualBlockRanges = (col, day, occurrences) => {
    if (!occurrences?.length) return [];
    return occurrences
      .filter(occ => {
        if (occ.date !== day) return false;
        if (!occ.therapistId && !occ.roomId) return true;
        if (col.type === 'therapist') return occ.therapistId === col.id;
        if (col.type === 'room') return occ.roomId === col.id;
        return false;
      })
      .map(occ => ({
        fromTime: occ.startTime,
        toTime: occ.endTime,
        description: occ.description,
        blockId: occ.blockId,
        seriesId: occ.seriesId,
        day: occ.date,
        // Column this occurrence is rendered under — drag-to-move uses it to detect a column change.
        colId: occ.therapistId || occ.roomId || col.id,
        // Whole-branch blocks render one copy per column; moving one must not narrow it to a single column.
        isWholeBranch: !occ.therapistId && !occ.roomId,
      }));
  };

  // Resize a manual block by dragging its bottom edge: live preview via `resizingBlock`
  // state, snapped to 10 minutes and persisted on mouseup (scoped to this occurrence).
  const [resizingBlock, setResizingBlock] = useState(null); // { blockId, day, previewHeight }
  const blockResizeRef = useRef(null);
  const handleBlockResizeStart = useCallback((e, block, day) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = Math.max(timeToHeight(block.fromTime, block.toTime), 20);
    blockResizeRef.current = { blockId: block.blockId, day, startY, startHeight };
    setResizingBlock({ blockId: block.blockId, day, previewHeight: startHeight });

    const handleMouseMove = (moveEvent) => {
      const ref = blockResizeRef.current;
      if (!ref) return;
      const newHeight = Math.max(20, ref.startHeight + (moveEvent.clientY - ref.startY));
      setResizingBlock({ blockId: ref.blockId, day: ref.day, previewHeight: newHeight });
    };

    const handleMouseUp = (upEvent) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      const ref = blockResizeRef.current;
      blockResizeRef.current = null;
      setResizingBlock(null);
      if (!ref) return;
      // A plain click (no real drag) must never commit a resize.
      if (Math.abs(upEvent.clientY - ref.startY) < 5) return;
      const rawHeight = Math.max(20, ref.startHeight + (upEvent.clientY - ref.startY));
      const snappedMinutes = Math.max(10, Math.round((rawHeight / eHH * 60) / 10) * 10);
      const originalMinutes = Math.round(ref.startHeight / eHH * 60);
      if (snappedMinutes === originalMinutes) return;
      onResizeManualBlock?.({ blockId: ref.blockId, day: ref.day, durationMinutes: snappedMinutes });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [eHH, onResizeManualBlock]);

  const handleDeleteBlockClick = useCallback((e, block, day) => {
    e.stopPropagation();
    onDeleteManualBlock?.({ blockId: block.blockId, day, seriesId: block.seriesId, description: block.description });
  }, [onDeleteManualBlock]);

  const renderManualBlocks = (col, day) =>
    getManualBlockRanges(col, day, blockOccurrences)
      .filter((range) => !(draftGhost?.hideBlock && draftGhost.hideBlock.blockId === range.blockId && draftGhost.hideBlock.day === range.day))
      .map((range, i) => {
      const isResizingThis = resizingBlock?.blockId === range.blockId && resizingBlock?.day === range.day;
      const blockHeight = isResizingThis
        ? resizingBlock.previewHeight
        : Math.max(timeToHeight(range.fromTime, range.toTime), 20);
      return (
        <ManualBlockOverlay
          key={`manual-block-${range.blockId}-${range.day}-${col.id}-${i}`}
          range={{ ...range, colId: range.isWholeBranch ? col.id : range.colId }}
          blockTop={timeToTop(range.fromTime)}
          blockHeight={blockHeight}
          onDeleteClick={(e) => handleDeleteBlockClick(e, range, range.day)}
          onResizeStart={(e) => handleBlockResizeStart(e, range, range.day)}
          onClick={() => onEditManualBlock?.(range)}
          passThrough={pickMode}
          use24h={use24h}
        />
      );
    });

  // A therapist who's already checked out is blocked from their check-out time through
  // the rest of THAT specific day only — other days on the same column stay bookable.
  const getCheckoutBlockRange = (col, day) => {
    const checkOutTime = checkedOutByTherapistAndDate?.[`${col.id}_${day}`];
    if (!checkOutTime) return null;
    const parts = toKathmanduParts(checkOutTime);
    if (!parts || parts.date !== day) return null;
    if (parts.time <= openHourStr) return { fromTime: openHourStr, toTime: closeHourStr };
    return { fromTime: parts.time, toTime: closeHourStr };
  };

  // Current time
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const nowParts = toKathmanduParts(now.toISOString());
  const todayStr = nowParts?.date;
  const nowTime = (nowParts?.time || '00:00').replace(/^24:/, '00:');
  const nowTop = timeToTop(`${nowTime}:00`);
  const nowLabel = (() => {
    const [h, m] = nowTime.split(':').map(Number);
    if (use24h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
  })();

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
      // The sticky header sits inside the scroller: centre the now-line in the part of the view below it.
      const headerH = el.firstElementChild?.offsetHeight || 0;
      el.scrollTop = Math.max(0, (nowTop || 0) - (el.clientHeight - headerH) / 2);
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

  // Phone day: columns fill the screen in whole units (3 at 360-430) and zoom never changes their width.
  const minColWidth = phoneDay ? phoneColumnWidth(viewportW) : Math.round((isMultiDay ? 80 : 200) * zoomScale);
  const pinUnassigned = !hideUnassigned && !phoneDay && freezeUnassigned;
  lockCfgRef.current = { phoneDay, colW: minColWidth };
  const unassignedW = minColWidth;

  // Phone "+N" tile: the bookings it hides, listed in a bottom sheet (each row opens the booking).
  const [overflowSheet, setOverflowSheet] = useState(null);

  // Phone: soft shadow on the right edge while more columns lie off-screen.
  const [moreRight, setMoreRight] = useState(false);
  const updateMoreRight = useCallback(() => {
    const el = scrollRef.current;
    setMoreRight(!!el && el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  }, []);

  // ── Column header tooltip (fixed-position to escape overflow-hidden) ──
  const [headerTooltip, setHeaderTooltip] = useState(null);
  const [isHeaderDragging, setIsHeaderDragging] = useState(false);
  const showHeaderTooltip = useCallback((e, name) => {
    if (isHeaderDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHeaderTooltip({ name, x: rect.left + rect.width / 2, y: rect.bottom + 4 });
  }, [isHeaderDragging]);
  const hideHeaderTooltip = useCallback(() => setHeaderTooltip(null), []);
  const headerTipTimer = useRef(null);
  useEffect(() => () => clearTimeout(headerTipTimer.current), []);

  // ── Header drag-to-reorder (nested DndContext) ────────────
  const headerSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // ── Column header renderer ────────────────────────────────
  const stackedHeader = !isMultiDay; // Day view (phone and desktop) uses the stacked avatar / name / status header
  const renderColumnHeader = (col) => {
    const isUnassigned = col.type === 'unassigned';
    const activeBlock = col.type !== 'unassigned' && days.includes(todayStr)
      ? getManualBlockRanges(col, todayStr, blockOccurrences)
          .find(r => nowTime >= r.fromTime.slice(0, 5) && nowTime < r.toTime.slice(0, 5))
      : null;
    // Online-unassigned copy only applies to the synthetic Unassigned/No Room column and only when there is something to flag.
    const onlineUnassignedTooltip = isUnassigned && col.onlineUnassignedCount > 0
      ? (col.allSelfService
          ? `Please allocate the customer to a dedicated ${locationLabel.toLowerCase()}`
          : `${col.onlineUnassignedCount} new online booking${col.onlineUnassignedCount > 1 ? 's' : ''} — please assign to a ${staffWord()} and allocate the ${locationLabel.toLowerCase()}`)
      : null;
    const hdrShift = col.type === 'therapist' && viewMode === 'day' ? shiftHeaderInfo(shiftOf(col.id, currentDate), { isToday: currentDate === todayStr, nowMin: hhmmToMinutes(nowTime), attendance: attendanceByTherapist?.[col.id], branchClosed: isClosedByBlocks(blockOccurrences, currentDate) }) : null;
    const trDesc = col.type === 'therapist' ? describeColumnTransfer(col, { day: currentDate, use24h, labels: { branch: (locationLabel || 'branch').toLowerCase() } }) : null;
    // The one status line under the name: transfer, else "back at", else the shift. Desktop and phone share this (phone only gets a larger size).
    const statusLine = (phone) => (trDesc ? (
      <TransferHeaderLine desc={trDesc} onOpen={() => onEditTransfer?.(col)} phone={phone} />
    ) : activeBlock ? (
      <span className={`font-body ${phone ? `${phoneDay ? 'text-[10.5px]' : 'text-[11px]'} max-w-full` : 'text-[10px]'} leading-tight text-text-tertiary truncate`}>
        back at {formatClockTime(activeBlock.toTime, use24h)}
      </span>
    ) : hdrShift && (
      <span
        data-shift-line={hdrShift.tone}
        className={`font-data ${phone ? `${phoneDay ? 'text-[10.5px]' : 'text-[11px]'} max-w-full` : 'text-[10px]'} leading-tight truncate text-text-tertiary`}
        style={{ color: hdrShift.tone === 'leave' ? SHADE_STYLES.leave.color : hdrShift.tone === 'alert' ? '#B45309' : hdrShift.tone === 'shift' ? undefined : SHADE_STYLES.off.color }}
      >
        <i className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: STATUS_DOT_COLOR[hdrShift.dot] }} />
        {hdrShift.text}
      </span>
    ));
    const initials = col.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return (
      <div
        key={col.id}
        data-col-header
        className={`relative flex-1 border-r border-border last:border-r-0 ${phoneDay ? 'h-[76px]' : stackedHeader ? 'h-[72px]' : 'h-10'} flex items-center justify-center px-2 ${stackedHeader && isUnassigned && columnMode !== 'room' && assignCount > 0 ? 'bg-warning/10' : ''}`}
        style={{ minWidth: minColWidth }}
        onMouseEnter={(e) => showHeaderTooltip(e, onlineUnassignedTooltip || [col.name, hdrShift?.full, trDesc?.sentence].filter(Boolean).join(' · '))}
        onMouseLeave={hideHeaderTooltip}
        onClick={phoneDay && col.type === 'therapist' ? (e) => {
          // Touch: a tap shows the same full-sentence tooltip desktop shows on hover; it clears itself after a few seconds.
          showHeaderTooltip(e, [col.name, hdrShift?.full, trDesc?.sentence].filter(Boolean).join(' · '));
          clearTimeout(headerTipTimer.current);
          headerTipTimer.current = setTimeout(hideHeaderTooltip, 4000);
        } : undefined}
      >
        {stackedHeader ? (
          <div className="flex flex-col items-center justify-center gap-[2px] min-w-0 w-full" title={phoneDay ? col.name : undefined}>
            {isUnassigned && col.onlineUnassignedCount > 0 && (
              <span
                className="absolute left-1.5 top-1.5 min-w-[16px] h-4 px-1 bg-warning text-white rounded-full text-[10px] font-medium flex items-center justify-center"
                title={onlineUnassignedTooltip}
                aria-label={onlineUnassignedTooltip}
              >
                {col.onlineUnassignedCount}
              </span>
            )}
            {isUnassigned && onToggleFreezeUnassigned && !phoneDay && (
              <button
                data-no-drag-create
                onClick={(e) => { e.stopPropagation(); onToggleFreezeUnassigned(); }}
                className={`absolute right-1.5 top-1.5 p-0.5 rounded hover:bg-black/5 spa-transition-fast ${freezeUnassigned ? 'text-primary' : 'text-text-tertiary'}`}
                title={freezeUnassigned ? 'Unpin column' : 'Pin column'}
              >
                <Icon name={freezeUnassigned ? 'Pin' : 'PinOff'} size={13} />
              </button>
            )}
            {isUnassigned && columnMode !== 'room' ? (
              <>
                <span className={`flex items-center gap-1.5 font-body text-[13px] leading-tight ${assignCount > 0 ? 'font-semibold text-[#B45309]' : 'italic text-text-tertiary'}`}>
                  {assignCount > 0 && <Icon name="AlertTriangle" size={13} />}
                  {col.name}
                  {assignCount > 0 && <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-warning text-white text-[11px] font-bold flex items-center justify-center">{assignCount}</span>}
                </span>
                {assignCount > 0 && onOpenAssignList && (
                  <button
                    type="button"
                    data-no-drag-create
                    onClick={(e) => { e.stopPropagation(); onOpenAssignList(); }}
                    className="mt-0.5 min-h-[32px] px-3 rounded-full border border-[#E9C46A] bg-white font-body text-[12px] font-semibold text-[#B45309] hover:bg-warning/10"
                  >
                    Assign ›
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="relative flex items-center">
                  <span className={`${phoneDay ? 'w-7 h-7' : 'w-[30px] h-[30px]'} rounded-full text-white flex items-center justify-center text-[11px] font-semibold`} style={{ background: isUnassigned ? '#9CA3AF' : avatarColor(col.id) }}>
                    {col.type === 'therapist' ? initials : <Icon name={col.icon} size={14} />}
                  </span>
                  {col.type === 'therapist' && (
                    <span
                      className={`absolute -right-px -top-px w-[9px] h-[9px] rounded-full border-2 border-white ${col.attendance ? 'bg-gray-300' : 'bg-success'}`}
                      title={col.attendance === 'Absent' ? 'Absent' : col.attendance === 'Leave' ? 'On leave' : 'Present'}
                    />
                  )}
                </span>
                <span className={`font-body ${phoneDay ? 'text-[12px] max-w-[94%]' : 'text-[13px] max-w-full'} font-medium leading-tight text-text-primary truncate`}>
                  {col.type === 'therapist' && phoneDay ? shortName(col.name) : col.name}
                </span>
                {col.type === 'therapist' && statusLine(true)}
              </>
            )}
          </div>
        ) : (
        <div className="flex items-center gap-2 overflow-hidden min-w-0">
          <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center flex-shrink-0 text-[10px] font-medium">
            {col.type === 'therapist' ? initials : <Icon name={isUnassigned ? 'AlertCircle' : col.icon} size={12} />}
          </span>
          <span className="min-w-0 flex flex-col">
            <span
              className={`font-body text-[13px] font-medium truncate block leading-tight ${isUnassigned ? 'text-text-secondary italic' : 'text-text-primary'}`}
            >
              {col.name}
            </span>
            {statusLine(false)}
            {isUnassigned && columnMode !== 'room' && onOpenAssignList && assignCount > 0 && (
              <button
                type="button"
                data-no-drag-create
                onClick={(e) => { e.stopPropagation(); onOpenAssignList(); }}
                className="self-start font-body text-[11px] font-semibold leading-tight text-warning hover:underline"
              >
                Assign ›
              </button>
            )}
          </span>
          {isUnassigned && col.onlineUnassignedCount > 0 && (
            <span
              className="flex-shrink-0 min-w-[16px] h-4 px-1 bg-warning text-white rounded-full text-[10px] font-medium flex items-center justify-center"
              title={onlineUnassignedTooltip}
              aria-label={onlineUnassignedTooltip}
            >
              {col.onlineUnassignedCount}
            </span>
          )}
          {col.type === 'therapist' && (
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${col.attendance ? 'bg-gray-300' : 'bg-success'}`}
              title={col.attendance === 'Absent' ? 'Absent' : col.attendance === 'Leave' ? 'On leave' : 'Present'}
            />
          )}
          {isUnassigned && onToggleFreezeUnassigned && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFreezeUnassigned(); }}
              className={`p-0.5 rounded hover:bg-black/5 spa-transition-fast ${
                freezeUnassigned ? 'text-primary' : 'text-text-tertiary'
              }`}
              title={freezeUnassigned ? 'Unpin column' : 'Pin column'}
            >
              <Icon name={freezeUnassigned ? 'Pin' : 'PinOff'} size={13} />
            </button>
          )}
        </div>
        )}
      </div>
    );
  };

  // ── Shared renderers ──────────────────────────────────────
  // Identity changes whenever card positions can have changed; SharedBookingLines re-measures on it (plus its ResizeObserver).
  const sharedLayoutKey = useMemo(() => ({}), [bookingsByDayAndCol, columns, viewMode, currentDate, eHH]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderTimeLabels = () => {
    const showNow = days.includes(todayStr) && nowTop >= 0 && nowTop <= totalHeight;
    return (
      <div className="flex-shrink-0 border-r border-border relative bg-surface sticky left-0 z-header" style={{ width: TIME_COL_WIDTH }}>
        {hours.map((hour) => {
          const top = (hour - openHour) * eHH + TOP_PAD;
          if (showNow && Math.abs(top - nowTop) < 14) return null; // the now pill replaces the hour label it would collide with
          return (
            <div key={hour} className="absolute w-full" style={{ top }}>
              <span className="absolute -top-2.5 inset-x-0 text-center font-data text-[11px] font-medium text-text-secondary">
                {formatHourLabel(hour, use24h)}
              </span>
            </div>
          );
        })}
        {showNow && (
          <div className="absolute w-full pointer-events-none" style={{ top: nowTop }}>
            <span className="absolute right-0 top-0 w-1.5 h-px bg-error" aria-hidden="true" />
            <span className="absolute left-1/2 -translate-x-1/2 -top-[9px] h-[18px] min-w-[34px] px-1 rounded-full bg-error flex items-center justify-center font-data text-[11px] font-semibold leading-none text-white" aria-label={`Now ${nowLabel}`}>
              {nowLabel}
            </span>
          </div>
        )}
      </div>
    );
  };

  // Light sub-hour lines, purely visual ("Calendar interval" setting) — position math below is hour-based and unaffected.
  const subLineFractions = intervalMinutes >= 60 ? [] : intervalMinutes <= 15 ? [0.25, 0.5, 0.75] : [0.5];

  // Hatched shading over the hours outside business hours; only non-empty when showFullDay renders those hours. Visual only.
  const renderClosedHoursShading = () => {
    const beforeHeight = Math.max(0, businessStartHour - openHour) * eHH;
    const afterTop = (Math.max(businessEndHour, openHour) - openHour) * eHH + TOP_PAD;
    const afterHeight = Math.max(0, closeHour - businessEndHour) * eHH;
    const stripeStyle = { background: SHADE_STYLES.off.background };   // plain off-hours grey; stripes are for blocks only
    return (
      <>
        {beforeHeight > 0 && <div className="absolute left-0 right-0 pointer-events-none" style={{ top: TOP_PAD, height: beforeHeight, ...stripeStyle }} />}
        {afterHeight > 0 && <div className="absolute left-0 right-0 pointer-events-none" style={{ top: afterTop, height: afterHeight, ...stripeStyle }} />}
      </>
    );
  };

  // Hour + sub-hour hairlines — rendered once per container, spans all columns
  const renderGridLines = () => (
    <>
      {hours.map((hour) => {
        const top = (hour - openHour) * eHH + TOP_PAD;
        return (
          <React.Fragment key={`lines-${hour}`}>
            <div className="absolute left-0 right-0 border-t border-border" style={{ top }} />
            {subLineFractions.map((frac) => (
              <div key={frac} className="absolute left-0 right-0 border-t border-border/50" style={{ top: top + eHH * frac }} />
            ))}
          </React.Fragment>
        );
      })}
    </>
  );

  const renderNowIndicator = (day, showDot = false) => {
    if (day !== todayStr || nowTop < 0 || nowTop > totalHeight) return null;
    return (
      <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
        <div className="h-px bg-error" />
        {showDot && <span className="absolute -left-[3px] -top-[2.5px] w-1.5 h-1.5 rounded-full bg-error" />}
      </div>
    );
  };

  // ── Hover time label ──────────────────────────────────────
  // One pill + one dashed hairline per grid container, moved by direct style
  // updates (no React state) so mousemove never re-renders the grid.
  const HOVER_SNAP_MIN = 10;
  const hoverLineRef = useRef(null);
  const hoverPillRef = useRef(null);
  const dragCreateRef = useRef(null); // drag-to-create session (see handleGridPointerDown)

  const hideHoverTime = useCallback(() => {
    if (hoverLineRef.current) hoverLineRef.current.style.display = 'none';
    if (hoverPillRef.current) hoverPillRef.current.style.display = 'none';
  }, []);

  // A dnd-kit drag (booking/block) hides the label immediately, not just on the next mousemove.
  useEffect(() => { if (activeDragId) hideHoverTime(); }, [activeDragId, hideHoverTime]);

  const handleGridMouseMove = (e) => {
    const line = hoverLineRef.current;
    const pill = hoverPillRef.current;
    if (!line || !pill) return;
    const col = e.target.closest ? e.target.closest('[data-cal-column]') : null;
    if (activeDragId || dragCreateRef.current?.dragging || !col || e.target.closest('[data-booking-card]') || e.target.closest('[data-block-overlay]')) {
      hideHoverTime();
      return;
    }
    const body = e.currentTarget.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    const minutesFromTop = ((e.clientY - body.top - TOP_PAD) / eHH) * 60;
    const snapped = Math.floor(minutesFromTop / HOVER_SNAP_MIN) * HOVER_SNAP_MIN;
    const hour = openHour + Math.floor(snapped / 60);
    if (snapped < 0 || hour >= closeHour) {
      hideHoverTime();
      return;
    }
    const minute = snapped % 60;
    const top = TOP_PAD + (snapped / 60) * eHH;
    const left = colRect.left - body.left;
    line.style.display = 'block';
    line.style.top = `${top}px`;
    line.style.left = `${left}px`;
    line.style.width = `${colRect.width}px`;
    pill.style.display = 'block';
    pill.style.top = `${top - 9}px`;
    pill.style.left = `${left + 3}px`;
    pill.textContent = formatClockTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, use24h);
  };

  const renderHoverTime = () => (
    <>
      <div
        ref={hoverLineRef}
        className="absolute pointer-events-none z-[5]"
        style={{ display: 'none', borderTop: '1px dashed #C9C9CF' }}
      />
      <div
        ref={hoverPillRef}
        className="absolute pointer-events-none z-[6] px-1.5 h-[18px] leading-[16px] rounded-spa bg-surface border border-border font-data text-[11px] text-text-secondary"
        style={{ display: 'none' }}
      />
    </>
  );

  const handleBookingResize = useCallback((booking, pixelDelta, direction) => {
    if (!onBookingResize) return;
    // Convert pixel delta to minutes (eHH px = 60 min at current zoom)
    const deltaMinutes = Math.round((pixelDelta / eHH) * 60 / 5) * 5; // snap to 5-min
    if (deltaMinutes === 0) return;
    onBookingResize(booking, deltaMinutes, direction);
  }, [onBookingResize, eHH]);

  // ── Drag-to-create ────────────────────────────────────────
  // Press on empty column space and drag vertically: a live dashed ghost (snapped to 10 min) is drawn straight into the
  // column's DOM (no React state, so no re-render per move). On release `onDragCreate` opens quick-create there.
  // < 5px of movement stays a plain click (existing menu / retarget behaviour). Mouse only; Esc cancels.
  const handleGridPointerDown = (e) => {
    if (!onDragCreate || activeDragId || e.button !== 0 || e.pointerType !== 'mouse' || dragCreateRef.current) return;
    const t = e.target;
    if (!t.closest) return;
    const colEl = t.closest('[data-cal-column]');
    if (!colEl || t.closest('[data-booking-card],[data-block-overlay],button,a,input,textarea,select,[data-no-drag-create]')) return;
    dragCreateRef.current = { colEl, startY: e.clientY, dragging: false };
    const st = dragCreateRef.current;

    const toMinutes = (clientY) => openHour * 60 + ((clientY - colEl.getBoundingClientRect().top - TOP_PAD) / eHH) * 60;
    const range = (clientY) => {
      const lo = openHour * 60;
      const hi = closeHour * 60;
      const a = Math.floor(toMinutes(st.startY) / HOVER_SNAP_MIN) * HOVER_SNAP_MIN;
      const b = Math.floor(toMinutes(clientY) / HOVER_SNAP_MIN) * HOVER_SNAP_MIN;
      let s0 = clientY >= st.startY ? a : b;
      let e0 = (clientY >= st.startY ? b : a) + HOVER_SNAP_MIN;
      s0 = Math.max(lo, Math.min(s0, hi - HOVER_SNAP_MIN));
      e0 = Math.max(s0 + HOVER_SNAP_MIN, Math.min(e0, hi));
      return { s0, e0 };
    };
    const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const day = colEl.dataset.day;
    const colId = colEl.dataset.colId;
    const colType = colEl.dataset.colType;

    const paint = (clientY) => {
      const { s0, e0 } = range(clientY);
      st.range = { s0, e0 };
      if (!st.ghost) {
        st.ghost = document.createElement('div');
        st.ghost.setAttribute('data-drag-create-ghost', 'true');
        st.ghost.className = 'absolute inset-x-0.5 rounded-spa pointer-events-none px-2 py-1 overflow-hidden border-[1.5px] border-dashed';
        st.ghost.style.zIndex = '7';
        colEl.appendChild(st.ghost);
      }
      const overlap = findBlockOverlap(overlapOccurrences || [], {
        date: day, startTime: hhmm(s0), durationMinutes: e0 - s0,
        therapistId: colType === 'therapist' ? colId : null, roomId: colType === 'room' ? colId : null,
      });
      const color = overlap ? '#C0392B' : '#2D5A27';
      const g = st.ghost;
      g.style.top = `${TOP_PAD + ((s0 - openHour * 60) / 60) * eHH}px`;
      g.style.height = `${Math.max(((e0 - s0) / 60) * eHH, 16)}px`;
      g.style.borderColor = color;
      g.style.backgroundColor = overlap ? 'rgba(192,57,43,0.06)' : 'rgba(45,90,39,0.06)';
      g.style.color = color;
      g.innerHTML = '';
      const label = document.createElement('span');
      label.className = 'font-body text-[11px] leading-tight truncate block';
      label.textContent = formatBlockRange(hhmm(s0), hhmm(e0));
      g.appendChild(label);
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointercancel', onCancel, true);
      if (st.ghost) st.ghost.remove();
      document.body.style.userSelect = st.prevUserSelect ?? '';
      dragCreateRef.current = null;
    };
    const swallowNextClick = () => {
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', stop, true);
      setTimeout(() => document.removeEventListener('click', stop, true), 0);
    };
    function onMove(ev) {
      if (!st.dragging) {
        if (Math.abs(ev.clientY - st.startY) < 5) return;
        st.dragging = true;
        st.prevUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';
        window.getSelection?.()?.removeAllRanges?.();
        hideHoverTime();
      }
      hideHoverTime();
      paint(ev.clientY);
    }
    function onUp() {
      const dragged = st.dragging;
      const r = st.range;
      cleanup();
      if (!dragged || !r) return; // a click: normal handlers run
      swallowNextClick();
      onDragCreate({
        day, colId, colName: colEl.dataset.colName, colType,
        hour: Math.floor(r.s0 / 60), minute: r.s0 % 60, dragMinutes: r.e0 - r.s0,
      });
    }
    function onCancel() { const d = st.dragging; cleanup(); if (d) swallowNextClick(); }
    function onKey(ev) {
      if (ev.key !== 'Escape') return;
      ev.preventDefault(); ev.stopPropagation();
      const d = st.dragging;
      cleanup();
      // The button is still down: swallow the click its release will generate.
      if (d) document.addEventListener('pointerup', swallowNextClick, { once: true, capture: true });
    }
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    document.addEventListener('keydown', onKey, true);
  };

  // ── Availability shading (ZNLY-100) ─────────────────────────
  // Rows come from therapist_shifts_for_range; nothing here works out a shift. The 4-Day / Week columns are days with every
  // therapist's bookings merged, so there is no per-therapist time axis to shade there: Day view only.
  const shiftOf = (thId, day) => (thId ? shiftsByTherapist?.[thId]?.[day] || null : null);
  // Why an existing booking now breaks the availability rule (null when it doesn't): { text: 'in a block', note: 'In a block 11:00–12:00 · booking kept' }.
  const outsideOf = (col, day, booking) => {
    const row = shiftOf(viewMode === 'day' ? shadeTherapistId(col) : null, day);
    if (!row || !booking.startTime || !booking.endTime) return null;
    const verdict = slotVerdict(row, hhmmToMinutes(booking.startTime), hhmmToMinutes(booking.endTime));
    return verdict ? { text: outsideReasonText(verdict), note: outsideNote(verdict, fmtHHMM) } : null;
  };
  const shadeTherapistId = (col) => (viewMode === 'day' && col.type === 'therapist' ? col.id : null);
  const minToTop = (min) => (min - openHour * 60) / 60 * eHH + TOP_PAD;
  const fmtHHMM = (t) => formatClockTime(t, use24h);
  const openSlot = (info) => {
    const start = info.hour * 60 + info.minute;
    const v = info.colType === 'therapist' ? slotVerdict(shiftOf(info.colId, info.day), start, start + 30, { therapistName: info.colName }) : null;
    onEmptySlotClick?.({ ...info, reason: v?.message || null, reasonOverridable: v ? v.overridable : null });
  };

  const handleColumnClick = (e, day, col) => {
    if (activeDragId || !onEmptySlotClick) return;
    const relativeY = e.clientY - e.currentTarget.getBoundingClientRect().top - TOP_PAD;
    const minutesFromTop = (relativeY / eHH) * 60;
    const hour = Math.floor(minutesFromTop / 60) + openHour;
    const minute = Math.floor((minutesFromTop % 60) / HOVER_SNAP_MIN) * HOVER_SNAP_MIN;
    if (hour < openHour || hour >= closeHour) return;
    openSlot({ day, colId: col.id, colName: col.name, colType: col.type, hour, minute, clientX: e.clientX, clientY: e.clientY });
  };

  // Checked-out overlay: therapist has already clocked out for this specific day,
  // so the rest of that day's column is blocked. pointer-events-none so clicks
  // still reach the column's own onClick, separately blocked in
  // onEmptySlotClick/handleDragEnd. Sits below the booking cards (rendered
  // after) so cards stay visible.
  // Plain grey = off shift, amber stripes = break, purple stripes = leave, grey stripes + label = at another branch.
  // Blocks keep their own interactive layer (renderManualBlocks). Pointer-events stay on so the title tooltip works;
  // clicks bubble to the column, so an empty-slot click on shaded time still reaches the menu (which explains why).
  const renderShadeOverlays = (col, day) => {
    const thId = shadeTherapistId(col);
    const row = shiftOf(thId, day);
    const name = (therapists.find((t) => t.id === thId) || {}).name;
    const lo = openHour * 60;
    const hi = closeHour * 60;
    const rpcSegs = row ? buildShadeSegments(row, fmtHHMM) : [];
    // An applied transfer moves branch_id, so the availability RPC no longer shades the branch they left: draw that window in the
    // same 'branch' look, unless the RPC already did (upcoming transfer).
    const transferSegs = thId ? dedupeAgainst(
      transferShadeSegments(col, day, { openMin: lo, closeMin: hi, fmt: fmtHHMM }),
      rpcSegs.filter((x) => x.kind === 'branch'),
    ).map((x) => ({ ...x, kind: 'branch', code: 'OTHER_BRANCH' })) : [];
    if (!rpcSegs.length && !transferSegs.length) return null;
    // ZNLY-113: a visitor's column is shaded outside their window here: "Not at <this branch>" before it, "Back at <home>" after it.
    const winStart = col.transferredIn ? toKathmanduParts(col.transferStartAt) : null;
    const visitorLabel = (seg) => {
      if (!winStart || seg.kind !== 'branch') return seg;
      const startMin = (Number(winStart.time.slice(0, 2)) * 60) + Number(winStart.time.slice(3, 5));
      const sameDay = winStart.date === day;
      const before = sameDay && seg.startMin < startMin;
      return { ...seg, label: before ? `Not at ${col.transferToBranch || `this ${wordBranch()}`}` : `Back at ${col.transferFromBranch || col.fromBranch || 'home'}` };
    };
    return [...rpcSegs, ...transferSegs].map(visitorLabel).map((seg, i) => {
      const s0 = Math.max(seg.startMin, lo);
      const e0 = Math.min(seg.endMin, hi);
      if (e0 <= s0) return null;
      const height = (e0 - s0) / 60 * eHH;
      const look = SHADE_STYLES[seg.kind];
      const tip = seg.label || (row && slotVerdict(row, seg.startMin, seg.endMin, { therapistName: name })?.message) || undefined;
      return (
        <div
          key={`shade-${seg.kind}-${seg.startMin}-${i}`}
          data-shade={seg.kind}
          title={selectedBookingId || draftGhost ? undefined : tip}
          onClick={seg.kind === 'branch' && onEditTransfer && (col.transferredOut || col.transferredIn || col.scheduledTransfer)
            ? (e) => { e.stopPropagation(); onEditTransfer(col); }
            : undefined}
          className={`absolute inset-x-0 overflow-hidden${seg.kind === 'branch' && onEditTransfer && (col.transferredOut || col.transferredIn || col.scheduledTransfer) ? ' cursor-pointer' : ''}`}
          style={{ top: minToTop(s0), height, background: look.background }}
        >
          {seg.label && height >= 28 && (
            <span className="absolute left-2 top-1 font-body text-[11px] leading-tight truncate pr-2" style={{ color: look.color, maxWidth: '100%' }}>{seg.label}</span>
          )}
        </div>
      );
    });
  };

  const renderCheckoutOverlay = (col, day) => {
    const range = getCheckoutBlockRange(col, day);
    if (!range) return null;
    const blockTop = timeToTop(range.fromTime);
    const blockHeight = Math.max(timeToHeight(range.fromTime, range.toTime), 20);
    return (
      <div
        className="absolute inset-x-0 pointer-events-none flex items-start justify-center pt-1.5 overflow-hidden"
        style={{
          top: blockTop,
          height: blockHeight,
          backgroundColor: 'rgba(100,116,139,0.35)',
        }}
      >
        <span className="text-[9px] font-caption font-caption-semibold text-white uppercase tracking-wider bg-slate-600 border border-slate-700/60 px-1.5 py-0.5 rounded-spa shadow-spa-resting">
          Checked out
        </span>
      </div>
    );
  };

  // Booking cards for a column with overlap handling: overlapping bookings are clustered side by side, with a
  // "+N" overflow badge past MAX_VISIBLE_OVERLAP and a hover "+" to add a booking at the cluster's start.
  const renderClusteredCards = (col, day, colBookings, v) => {
    const clusters = clusterOverlapping(colBookings, (24 / eHH) * 60); // 24px = the shortest a card is drawn (timeToHeight)
    return clusters.map(cluster => {
      // Phone: at most 2 lanes; a 3rd+ overlapping booking collapses into a "+N" tile that opens the list (ZNLY-299).
      const phoneLanes = phoneDay ? assignPhoneLanes(cluster, (24 / eHH) * 60) : null;
      const layout = phoneLanes ? { cards: [], badge: null } : getOverlapLayout(cluster.length);
      const clusterTop = timeToTop(cluster[0].startTime);
      const clusterHeight = Math.max(
        timeToHeight(cluster[0].startTime, clusterEndTime(cluster)),
        layout.badge ? BADGE_MIN_HEIGHT : 0,
        phoneLanes && phoneLanes.hidden.length ? 28 : 0
      );
      const cardsToDraw = phoneLanes ? phoneLanes.placed : cluster.slice(0, MAX_VISIBLE_OVERLAP).map((booking, idx) => ({ booking, idx }));
      const laneW = `calc((100% - ${OVERLAP_PADDING * 2 + 2}px) / ${PHONE_MAX_LANES})`;
      return (
        <div
          key={`cluster-${cluster[0].id}${cluster[0]._comboIndex != null ? `-c${cluster[0]._comboIndex}` : ''}`}
          className="group absolute inset-x-0"
          style={{ top: clusterTop, height: clusterHeight }}
        >
          {cardsToDraw.map(({ booking, idx, lane }) => {
            const cardKey = (booking._colTherapistId || booking._colRoomId) ? `${booking.id}__${booking._colTherapistId || booking._colRoomId}${booking._comboIndex != null ? `__c${booking._comboIndex}` : ''}` : booking.id;
            const pos = phoneLanes
              ? (phoneLanes.lanes > 1 ? { left: `calc(${OVERLAP_PADDING}px + ${lane} * (${laneW} + 2px))`, width: laneW } : null)
              : layout.cards[idx];
            return (
              <CalendarBookingCard
                isPanelSelected={!!selectedBookingId && (booking.bookingId || booking.id) === selectedBookingId}
                isLinkedActive={!!(booking.isShared || booking.isRoomShared || booking.isCombo) && !!activeSharedId && booking.bookingId === activeSharedId}
                onSharedActivate={activateShared}
                onSharedDeactivate={deactivateShared}
                onClientActivate={activateClient}
                onClientDeactivate={deactivateClient}
                sameClient={multiServiceBookings ? highlightLevel(clientIndex, activeBooking, booking) : isSameClient(clientIndex, activeCustomerId, booking)}
                key={cardKey}
                booking={(() => {
                  const info = multiServiceBookings ? visitDayInfo(clientIndex, booking) : clientDayInfo(clientIndex, booking);
                  const o = outsideOf(col, day, booking);
                  return o || info ? { ...booking, ...(o ? { availabilityNote: o.note } : {}), ...(info ? { _clientDay: info } : {}) } : booking;
                })()}
                columnMode={columnMode}
                phone={phoneDay}
                narrow={!!phoneLanes && phoneLanes.lanes > 1}
                chipWidth={phoneLanes && phoneLanes.lanes > 1 ? (minColWidth - OVERLAP_PADDING * 2 - 2) / PHONE_MAX_LANES : minColWidth - OVERLAP_PADDING * 2}
                hideSensitive={hideSensitive}
                use24h={use24h}
                outsideHours={outsideOf(col, day, booking)?.text || null}
                style={{
                  top: timeToTop(booking.startTime) - clusterTop,
                  height: timeToHeight(booking.startTime, booking.endTime),
                  ...(pos ? { left: pos.left, width: pos.width, right: 'auto' } : {}),
                }}
                onClick={onBookingClick}
                {...(v.cardInteractions ? {
                  onResize: handleBookingResize,
                  isSelected: selectedCardIds.has(cardKey),
                  onSelect: handleCardSelect,
                } : {})}
              />
            );
          })}
          {phoneLanes && phoneLanes.hidden.length > 0 && (() => {
            const hiddenTop = Math.max(0, Math.min(timeToTop(earliestStartTime(phoneLanes.hidden)) - clusterTop, clusterHeight - 28));
            return (
              <button
                type="button"
                data-overflow-tile="true"
                aria-label={`${phoneLanes.hidden.length} more booking${phoneLanes.hidden.length === 1 ? '' : 's'}, open the list`}
                className="absolute z-[4] h-7 min-w-[30px] px-1.5 rounded-spa bg-surface border border-border text-[12px] font-semibold text-text-secondary flex items-center justify-center shadow-spa-resting"
                style={{ top: hiddenTop, right: 6 }}
                onClick={(e) => { e.stopPropagation(); if (!activeDragId) setOverflowSheet(phoneLanes.hidden); }}
              >
                +{phoneLanes.hidden.length}
              </button>
            );
          })()}
          {layout.badge && (() => {
            const hidden = cluster.slice(MAX_VISIBLE_OVERLAP);
            const hiddenTopRaw = hidden.length ? timeToTop(earliestStartTime(hidden)) - clusterTop : 0;
            const hiddenHeight = hidden.length
              ? Math.max(timeToHeight(earliestStartTime(hidden), clusterEndTime(hidden)), BADGE_MIN_HEIGHT)
              : clusterHeight;
            // Clamp upward so the BADGE_MIN_HEIGHT floor can never push the box past the
            // cluster's own bottom edge — shift the top up instead of letting it overflow.
            const hiddenTop = Math.max(0, Math.min(hiddenTopRaw, clusterHeight - hiddenHeight));
            return (
            <OverflowBadge
              key={`badge-${cluster[0].id}${cluster[0]._comboIndex != null ? `-c${cluster[0]._comboIndex}` : ''}`}
              count={layout.badge.count}
              bookings={hidden}
              use24h={use24h}
              hideSensitive={hideSensitive}
              onBookingClick={onBookingClick}
              onAdd={onEmptySlotClick ? () => {
                if (activeDragId) return;
                // Target the hidden segment's own start time, matching where this button
                // now visually sits (see earliestStartTime/hiddenTop above) — not the
                // cluster's overall start. Falls back to cluster[0] only if hidden is
                // somehow empty (shouldn't happen: layout.badge is only ever truthy when
                // cluster.length > MAX_VISIBLE_OVERLAP, so hidden always has ≥1 item).
                const anchorTime = hidden.length ? earliestStartTime(hidden) : cluster[0].startTime;
                const [h, m] = anchorTime.split(':').map(Number);
                openSlot({ day, colId: col.id, colName: col.name, colType: col.type, hour: h, minute: m });
              } : null}
              style={{
                top: hiddenTop,
                height: hiddenHeight,
                left: layout.badge.left,
                width: layout.badge.width,
                right: 'auto',
              }}
              expandedStyle={{
                top: 0,
                height: clusterHeight,
                left: OVERLAP_PADDING,
                width: `calc(100% - ${OVERLAP_PADDING * 2}px)`,
                right: 'auto',
              }}
            />
            );
          })()}
          {!layout.badge && !phoneDay && !!onEmptySlotClick && (
            <button
              type="button"
              title="Add booking at this time"
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-primary text-white shadow-spa-resting flex items-center justify-center opacity-0 group-hover:opacity-100 spa-transition-fast z-dropdown hover:bg-primary/90"
              onClick={(e) => {
                e.stopPropagation();
                if (activeDragId) return;
                const [h, m] = cluster[0].startTime.split(':').map(Number);
                openSlot({ day, colId: col.id, colName: col.name, colType: col.type, hour: h, minute: m, clientX: e.clientX, clientY: e.clientY });
              }}
            >
              <Icon name="Plus" size={12} />
            </button>
          )}
        </div>
      );
    });
  };

  // The inside of a grid column, shared by the Day-view therapist/room columns, the pinned Unassigned column and the
  // 4-Day day columns. `v` is one of COLUMN_BODY (the per-view differences, see the table above the component);
  // the column frame (classes, sticky/pinned style, click handler) stays with each caller.
  const renderColumnBody = (col, day, colBookings, v, nowDot = false) => (
    <>
      {v.gridLines && renderClosedHoursShading()}
      {v.gridLines && renderGridLines()}
      {v.nowLine === 'before-droppable' && renderNowIndicator(day, nowDot)}
      {/* Single droppable zone for the entire column (sibling to booking cards) */}
      <DroppableColumn
        id={`drop-col-${day}-${col.id}`}
        data={{ day, colId: col.id, openHour, totalHeight }}
        height={totalHeight}
        isActive={!!activeDragId}
      />
      {v.nowLine === 'after-droppable' && renderNowIndicator(day, nowDot)}
      {v.shading && renderShadeOverlays(col, day)}
      {v.checkoutOverlay && renderCheckoutOverlay(col, day)}
      {renderManualBlocks(col, day)}
      {renderDraftGhost(col.id, day, col.type)}
      {renderClusteredCards(col, day, colBookings, v)}
    </>
  );

  const renderColumn = (col, day) => (
    <div
      key={col.id}
      className="flex-1 relative border-r border-border last:border-r-0 cursor-pointer"
      style={{ minWidth: minColWidth, height: totalHeight, ...(!isMultiDay ? { scrollSnapAlign: 'start' } : null) }}
      data-cal-column="true"
      data-day={day} data-col-id={col.id} data-col-type={col.type} data-col-name={col.name}
      onClick={(e) => handleColumnClick(e, day, col)}
    >
      {renderColumnBody(col, day, (bookingsByDayAndCol[day] || {})[col.id] || [], COLUMN_BODY.column)}
    </div>
  );


  // Stats for the synthetic "Unassigned"/"No Room" column's header badge + tooltip: only bookings that came from the public online
  // flow (isOnline), not e.g. a staff-created walk-in deliberately left unassigned. Single-day view only (the only place this
  // column's header renders). allSelfService: every counted booking is for a service that needs no therapist, so the copy asks
  // for a room only.
  const unassignedOnlineStats = useMemo(() => {
    const online = ((bookingsByDayAndCol[currentDate] || {}).unassigned || []).filter(b => b.isOnline);
    return { count: online.length, allSelfService: online.length > 0 && online.every(b => b.requiresTherapist === false) };
  }, [bookingsByDayAndCol, currentDate]);

  // ── Phone extras: Unassigned bar + empty / closed day card (ZNLY-299) ──
  // The bar counts the open bookings of the shown day that have no one (or, in the rooms view, no room) assigned.
  const phoneUnassigned = useMemo(() => {
    if (!phoneDay || hideUnassigned) return [];
    const seen = new Set();
    return ((bookingsByDayAndCol[currentDate] || {}).unassigned || [])
      .filter((b) => !['Completed', 'Cancelled', 'No Show'].includes(b.status) && !seen.has(b.bookingId) && seen.add(b.bookingId))
      .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  }, [phoneDay, hideUnassigned, bookingsByDayAndCol, currentDate]);
  const barCount = columnMode === 'room' || assignCount == null ? phoneUnassigned.length : assignCount;
  const dayHasBookings = useMemo(
    () => Object.values(bookingsByDayAndCol[currentDate] || {}).some((arr) => arr.length > 0),
    [bookingsByDayAndCol, currentDate],
  );
  const closedBlock = useMemo(
    () => (blockOccurrences || []).find((o) => o.date === currentDate && !o.therapistId && !o.roomId
      && String(o.startTime).slice(0, 5) === '00:00' && ['00:00', '24:00'].includes(String(o.endTime).slice(0, 5))) || null,
    [blockOccurrences, currentDate],
  );
  const dayLabel = new Date(`${currentDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const phoneDayNote = !phoneDay ? null : closedBlock
    ? { title: `Closed${closedBlock.description ? ` · ${closedBlock.description}` : ''}`, sub: 'Staff can still book after a warning.' }
    : !dayHasBookings ? { title: `No bookings on ${dayLabel}`, sub: 'Tap any free slot, or use + to add a booking.' } : null;
  useEffect(() => { if (phoneDay) updateMoreRight(); }, [phoneDay, updateMoreRight, columns.length, viewportW]);

  // ── Single-day view ───────────────────────────────────────
  const columnsMinWidth = columns.length * minColWidth - (columns.some(c => c.type === 'unassigned') ? minColWidth - unassignedW : 0);
  const unassignedCol = useMemo(() => {
    const base = columns.find(c => c.type === 'unassigned');
    return base ? { ...base, onlineUnassignedCount: unassignedOnlineStats.count, allSelfService: unassignedOnlineStats.allSelfService } : base;
  }, [columns, unassignedOnlineStats]);
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
    <div className="flex flex-col h-full overflow-hidden isolate">
      {phoneDay && barCount > 0 && onOpenUnassigned && (
        <button
          type="button"
          data-unassigned-bar="true"
          onClick={() => onOpenUnassigned(columnMode === 'room' ? phoneUnassigned[0] : undefined)}
          className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 min-h-[36px] border-b border-border bg-warning/10 text-left font-body text-[12px] text-warning"
        >
          <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-warning text-white text-[11px] font-semibold flex items-center justify-center">{barCount}</span>
          <span className="truncate">Unassigned booking{barCount === 1 ? '' : 's'} {currentDate === todayStr ? 'today' : `on ${dayLabel}`}{columnMode === 'room' ? ` · no ${locationLabel.toLowerCase()}` : ''}</span>
          <span className="ml-auto font-semibold flex-shrink-0">Assign ›</span>
        </button>
      )}
      {/* Fixed header — outside scroll container */}

      {/* Scrollable grid body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-scroll overflow-y-auto calendar-grid-scroll"
        style={{ ...(isPhone ? { touchAction: 'pan-y' } : null), ...(!isMultiDay ? { scrollPaddingLeft: TIME_COL_WIDTH + (pinUnassigned ? unassignedW : 0), scrollPaddingTop: phoneDay ? 76 : 72 } : null) }}
        onScroll={(e) => {
          const scrolled = e.target.scrollLeft > 0;
          if (scrolled !== gridScrolledRef.current) { gridScrolledRef.current = scrolled; setGridScrolled(scrolled); }
          if (phoneDay) updateMoreRight();
        }}
      >
      <div
        className="sticky top-0 z-sidebar bg-background border-b border-border"
        style={{ width: '100%', minWidth: TIME_COL_WIDTH + columnsMinWidth }}
      >
        <div className="flex relative" style={{ width: '100%', minWidth: TIME_COL_WIDTH + columnsMinWidth }}>
          {draftSpacer > 0 && <div aria-hidden="true" data-draft-spacer="true" style={{ position: 'absolute', top: 0, left: `calc(100% + ${draftSpacer}px)`, width: 1, height: 1 }} />}
          <div className={`flex-shrink-0 border-r border-border px-2 ${phoneDay ? 'h-[76px]' : !isMultiDay ? 'h-[72px]' : 'h-10'} flex items-center sticky left-0 z-header bg-background`} style={{ width: TIME_COL_WIDTH }}>
            <Icon name="Clock" size={14} className="text-text-secondary" />
          </div>
          {unassignedCol && (
            <div
              className={`flex-shrink-0 border-r border-border bg-surface ${
                pinUnassigned ? 'sticky z-header' : ''
              }`}
              style={pinUnassigned
                ? { left: TIME_COL_WIDTH, width: unassignedW, boxShadow: gridScrolled ? PINNED_SHADOW : undefined }
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
        <div
          ref={gridBodyRef}
          className="flex relative"
          style={{ height: totalHeight, width: '100%', minWidth: TIME_COL_WIDTH + columnsMinWidth }}
          data-open-hour={openHour}
          data-hour-height={eHH}
          onMouseMove={handleGridMouseMove}
          onPointerDown={handleGridPointerDown}
          onMouseLeave={hideHoverTime}
        >
          {draftSpacer > 0 && <div aria-hidden="true" data-draft-spacer="true" style={{ position: 'absolute', top: 0, left: `calc(100% + ${draftSpacer}px)`, width: 1, height: 1 }} />}
          {renderHoverTime()}
          <SharedBookingLines containerRef={gridBodyRef} activeId={activeSharedId} hiddenId={draggingSharedId} layoutKey={sharedLayoutKey} />
          {renderTimeLabels()}
          {unassignedCol && (
            <div
              className={`flex-shrink-0 relative border-r border-border bg-surface overflow-hidden cursor-pointer ${
                pinUnassigned ? 'sticky z-header' : ''
              }`}
              style={pinUnassigned
                ? { left: TIME_COL_WIDTH, width: unassignedW, height: totalHeight, boxShadow: gridScrolled ? PINNED_SHADOW : undefined }
                : { minWidth: minColWidth, height: totalHeight }
              }
              data-cal-column="true"
              data-day={currentDate} data-col-id={unassignedCol.id} data-col-type={unassignedCol.type} data-col-name={unassignedCol.name}
              onClick={(e) => handleColumnClick(e, currentDate, unassignedCol)}
            >
              {renderColumnBody(unassignedCol, currentDate, (bookingsByDayAndCol[currentDate] || {})[unassignedCol.id] || [], COLUMN_BODY.unassigned, true)}
            </div>
          )}
          <div className="flex flex-1 relative overflow-hidden" style={{ minWidth: regularMinWidth }}>
            {renderClosedHoursShading()}
            {renderGridLines()}
            {renderNowIndicator(currentDate, !unassignedCol)}
            {regularColumns.map(col => renderColumn(col, currentDate))}
          </div>
          {phoneDay && moreRight && (
            <div aria-hidden="true" data-more-right="true" className="sticky right-0 flex-shrink-0 pointer-events-none z-[5]"
              style={{ width: 14, marginLeft: -14, height: totalHeight, background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(0,0,0,0.07))' }} />
          )}
        </div>
        {phoneDayNote && (
          <div className="sticky left-0 pointer-events-none flex justify-center px-3 z-[5]" style={{ width: viewportW, top: 96, marginTop: -totalHeight + 96, height: 0 }}>
            <div data-day-note="true" className="pointer-events-none max-w-[300px] text-center rounded-spa-lg border border-border bg-surface shadow-spa-resting px-4 py-3 font-body" style={{ marginLeft: TIME_COL_WIDTH }}>
              <div className="text-[13px] font-semibold text-text-primary">{phoneDayNote.title}</div>
              <div className="text-[12px] text-text-secondary mt-0.5">{phoneDayNote.sub}</div>
            </div>
          </div>
        )}
      </div>
      <BottomSheet isOpen={!!overflowSheet} title={`${overflowSheet ? overflowSheet.length : 0} more booking${overflowSheet && overflowSheet.length === 1 ? '' : 's'}`} onClose={() => setOverflowSheet(null)}>
        <div className="divide-y divide-border">
          {(overflowSheet || []).map((b) => (
            <button key={`${b.id}-${b._comboIndex ?? ''}`} type="button" className="w-full text-left py-3 px-1 min-h-[56px]"
              onClick={() => { setOverflowSheet(null); onBookingClick?.(b); }}>
              <div className="font-data text-[12px] text-text-secondary">{formatClockRange(b.startTime, b.endTime, use24h)}</div>
              <div className="font-body text-[14px] font-semibold text-text-primary truncate">{hideSensitive ? '•••••' : coupleName(b.customerName || 'Guest', b.companionName)}</div>
              <div className="font-body text-[12px] text-text-secondary truncate">{b.serviceName}</div>
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );

  // ── Multi-day (4-day) view ────────────────────────────────
  const daysMinWidth = days.length * minColWidth;

  const renderMultiDayView = () => (
    <div className="flex flex-col h-full overflow-hidden isolate">
      {/* Fixed header — outside scroll container */}

      {/* Scrollable grid body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-scroll overflow-y-auto calendar-grid-scroll"
        style={isPhone ? { touchAction: 'pan-y' } : undefined}
        onScroll={(e) => {
          const scrolled = e.target.scrollLeft > 0;
          if (scrolled !== gridScrolledRef.current) { gridScrolledRef.current = scrolled; setGridScrolled(scrolled); }
        }}
      >
      <div
        className="sticky top-0 z-sidebar bg-background border-b border-border"
        style={{ width: '100%', minWidth: TIME_COL_WIDTH + daysMinWidth }}
      >
        <div className="flex relative" style={{ width: '100%', minWidth: TIME_COL_WIDTH + daysMinWidth }}>
          {draftSpacer > 0 && <div aria-hidden="true" data-draft-spacer="true" style={{ position: 'absolute', top: 0, left: `calc(100% + ${draftSpacer}px)`, width: 1, height: 1 }} />}
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
                  {(() => {
                    // One person on show: mark the days their transfer touches (the full sentence is in the tooltip).
                    const only = therapists.length === 1 ? therapists[0] : null;
                    const desc = only ? describeTransferOnDay(columns.find((c) => c.id === only.id) || only, day, { use24h, labels: { branch: (locationLabel || 'branch').toLowerCase() } }) : null;
                    return desc ? (
                      <button type="button" data-transfer-day-icon={desc.state} title={desc.sentence} aria-label={desc.sentence}
                        onClick={(e) => { e.stopPropagation(); onEditTransfer?.(only); }}
                        className={`ml-1 align-middle ${desc.state === 'now' ? 'text-primary' : 'text-text-tertiary'}`}>
                        <Icon name="ArrowRightLeft" size={11} />
                      </button>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>
        <div
          ref={gridBodyRef}
          className="flex relative"
          style={{ height: totalHeight, width: '100%', minWidth: TIME_COL_WIDTH + daysMinWidth }}
          data-open-hour={openHour}
          data-hour-height={eHH}
          onMouseMove={handleGridMouseMove}
          onPointerDown={handleGridPointerDown}
          onMouseLeave={hideHoverTime}
        >
          {draftSpacer > 0 && <div aria-hidden="true" data-draft-spacer="true" style={{ position: 'absolute', top: 0, left: `calc(100% + ${draftSpacer}px)`, width: 1, height: 1 }} />}
          {renderHoverTime()}
          {renderTimeLabels()}
          <div className="flex flex-1 relative" style={{ minWidth: daysMinWidth }}>
            {renderClosedHoursShading()}
            {renderGridLines()}
            {days.map((day, di) => {
              const isCurrentDay = day === todayStr;
              const dayBookings = [];
              const dayMap = bookingsByDayAndCol[day] || {};
              Object.values(dayMap).forEach(arr => dayBookings.push(...arr));
              const dayCol = { id: 'all', type: 'day', name: formatShortDate(day) };

              return (
                <div
                  key={day}
                  className={`flex-1 relative cursor-pointer ${di < days.length - 1 ? 'border-r border-border' : ''} ${isCurrentDay ? 'bg-primary/[0.02]' : ''}`}
                  style={{ minWidth: minColWidth }}
                  data-cal-column="true"
                  data-day={day} data-col-id={dayCol.id} data-col-type={dayCol.type} data-col-name={dayCol.name}
                  onClick={(e) => handleColumnClick(e, day, dayCol)}
                >
                  {renderColumnBody(dayCol, day, dayBookings, COLUMN_BODY.multiDay, di === 0)}
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
      <BookingHoverLayer />
      {headerTooltip && <HeaderTooltip tip={headerTooltip} />}
    </>
  );
};

export default CalendarGrid;
