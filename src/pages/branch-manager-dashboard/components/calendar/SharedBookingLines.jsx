import React, { useLayoutEffect, useRef, useState } from 'react';

// Always-on connectors between the copies of each shared booking: an edge-to-edge cubic Bézier at the name row in the
// booking's colour (soft at rest, full strength for the active booking) with a dot on each card edge and a white
// casing so crossings read as an overpass. Drawn above the cards but below the hover card, side panel and drag overlay.
//
// Measuring: once per layout change (`layoutKey`) plus a single rAF-debounced ResizeObserver on the container. The SVG
// lives inside the scroll content, so scrolling needs no listeners; changing `activeId` / `hiddenId` only restyles.
const ANCHOR_MAX = 12;   // anchor on the name row: top + min(12, height / 2)
const NUDGE = 4;         // px; segments of different bookings sharing a gap closer than this are pushed apart
const REST_OPACITY = 0.45;

const cubic = (a, b) => {
  if (Math.abs(a.y - b.y) < 0.5) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
};

function measure(container) {
  const t0 = performance.now();
  const origin = container.getBoundingClientRect();
  const groups = new Map();
  const add = (id, color, el, sortKey) => {
    const r = el.getBoundingClientRect();
    if (!groups.has(id)) groups.set(id, { id, color: null, ends: [] });
    const g = groups.get(id);
    if (color) g.color = color;
    g.ends.push({ left: r.left - origin.left, right: r.right - origin.left, y: r.top - origin.top + Math.min(ANCHOR_MAX, r.height / 2), sortKey });
  };
  container.querySelectorAll('[data-shared="true"][data-booking-id]').forEach((el) => add(el.dataset.bookingId, el.dataset.bar, el));
  // A copy folded into a "+N" cluster has no card: anchor to that cluster's badge instead.
  container.querySelectorAll('[data-overflow-booking-ids]').forEach((el) => {
    (el.dataset.overflowBookingIds || '').split(' ').filter(Boolean).forEach((id) => { if (groups.has(id)) add(id, null, el); });
  });

  const segments = [];
  groups.forEach((g) => {
    if (g.ends.length < 2 || !g.color) return;
    const ends = g.ends.sort((a, b) => a.left - b.left);
    for (let i = 0; i < ends.length - 1; i += 1) {
      segments.push({ id: g.id, color: g.color, a: { x: ends[i].right, y: ends[i].y }, b: { x: ends[i + 1].left, y: ends[i + 1].y } });
    }
  });
  // Collisions: a later segment that overlaps an earlier one's x-range at nearly the same y moves down.
  segments.forEach((s, i) => {
    for (let guard = 0; guard < 6; guard += 1) {
      const clash = segments.slice(0, i).some((o) => o.id !== s.id
        && Math.min(o.b.x, s.b.x) > Math.max(o.a.x, s.a.x)
        && (Math.abs(o.a.y - s.a.y) < NUDGE || Math.abs(o.b.y - s.b.y) < NUDGE));
      if (!clash) break;
      s.a.y += NUDGE; s.b.y += NUDGE;
    }
  });
  const out = segments.map((s) => ({ id: s.id, color: s.color, d: cubic(s.a, s.b), a: s.a, b: s.b }));
  performance.measure?.('shared-lines-measure', { start: t0, end: performance.now() });
  return out;
}

export const SharedBookingLines = ({ containerRef, activeId, hiddenId, layoutKey }) => {
  const [segments, setSegments] = useState([]);
  const rafRef = useRef(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const run = () => { rafRef.current = null; setSegments(measure(container)); };
    setSegments(measure(container));
    const ro = new ResizeObserver(() => { if (rafRef.current == null) rafRef.current = requestAnimationFrame(run); });
    ro.observe(container);
    return () => { ro.disconnect(); if (rafRef.current != null) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [containerRef, layoutKey]);

  const visible = segments.filter((s) => s.id !== hiddenId);
  if (visible.length === 0) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 4, overflow: 'visible' }} aria-hidden="true">
      {visible.map((s, i) => {
        const active = s.id === activeId;
        const w = active ? 2 : 1.5;
        const style = { transition: 'stroke-opacity 120ms ease-out, stroke-width 120ms ease-out' };
        return (
          <g key={`${s.id}-${i}`}>
            <path d={s.d} fill="none" stroke="#fff" strokeWidth={w + 3} strokeLinecap="round" style={style} />
            <path d={s.d} fill="none" stroke={s.color} strokeWidth={w} strokeLinecap="round" strokeOpacity={active ? 1 : REST_OPACITY} style={style} />
            <circle cx={s.a.x} cy={s.a.y} r={3} fill={s.color} />
            <circle cx={s.b.x} cy={s.b.y} r={3} fill={s.color} />
          </g>
        );
      })}
    </svg>
  );
};

export default SharedBookingLines;
