// Pure helpers for the dashboard's floor and pulse (V36c). Times are minutes since midnight, Nepal day.

/** 90 -> '1h 30m', 45 -> '45m', 120 -> '2h'. */
export function fmtDuration(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** 930 -> '3:30 pm'. */
export function fmtClock(min) {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h = h24 % 12 || 12;
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 < 12 ? 'am' : 'pm'}`;
}

/** Gaps still ahead of `nowMin` (clipped to it) that are at least an hour. nowMin = null keeps every gap (Prep). */
export function upcomingGaps(gaps, nowMin = null) {
  return (gaps || [])
    .map((g) => ({ ...g, from_min: nowMin == null ? g.from_min : Math.max(g.from_min, nowMin) }))
    .filter((g) => g.to_min - g.from_min >= 60);
}

/** { total, biggest: {from_min,to_min,minutes}|null } of the free gaps across the floor. */
export function freeTime(therapists, nowMin = null) {
  let total = 0;
  let biggest = null;
  for (const t of therapists || []) {
    for (const g of upcomingGaps(t.gaps, nowMin)) {
      const minutes = g.to_min - g.from_min;
      total += minutes;
      if (!biggest || minutes > biggest.minutes) biggest = { from_min: g.from_min, to_min: g.to_min, minutes };
    }
  }
  return { total, biggest };
}

/** Axis bounds (whole hours) covering the branch hours and every shift. */
export function axisBounds(therapists, open = null, close = null) {
  const starts = (therapists || []).map((t) => t.shift_from_min).filter((n) => Number.isFinite(n));
  const ends = (therapists || []).map((t) => t.shift_to_min).filter((n) => Number.isFinite(n));
  if (Number.isFinite(open)) starts.push(open);
  if (Number.isFinite(close)) ends.push(close);
  if (!starts.length || !ends.length) return { start: 9 * 60, end: 21 * 60 };
  const start = Math.floor(Math.min(...starts) / 60) * 60;
  const end = Math.ceil(Math.max(...ends) / 60) * 60;
  return { start, end: end > start ? end : start + 60 };
}

/** Booking-state counts for the Bookings tile: done / now / still to come. */
export function bookingSplit(pulse) {
  const p = pulse || {};
  return { done: p.completed || 0, now: p.in_progress || 0, toCome: (p.confirmed || 0) + (p.pending || 0) };
}
