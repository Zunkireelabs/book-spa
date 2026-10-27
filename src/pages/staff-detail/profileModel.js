// Pure helpers for the therapist profile page: what changed (dirty tracking), the tri-state service checkboxes, and the
// service-list filters. No React, no network, so it is all unit-tested (profileModel.test.js).

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Keys (from `keys`) whose value differs between two form objects. Arrays/objects compare by value. */
export function changedKeys(initial, current, keys) {
  if (!initial || !current) return [];
  return keys.filter((k) => !same(initial[k], current[k]));
}

/** Weekly hours rows -> a stable comparable shape (ignores row ids, day labels and an unset start/end on a day off). */
export function normalizeHours(rows = []) {
  return rows.map((r) => ({
    d: r.dayOfWeek,
    off: !!r.isDayOff,
    s: r.isDayOff ? null : (r.startTime || '').slice(0, 5),
    e: r.isDayOff ? null : (r.endTime || '').slice(0, 5),
    b: r.isDayOff ? [] : (r.breaks || []).map((b) => ({ n: (b.name || '').trim(), s: (b.startTime || '').slice(0, 5), e: (b.endTime || '').slice(0, 5) })),
  }));
}
export const hoursChanged = (a, b) => !same(normalizeHours(a), normalizeHours(b));

/** Which day rows differ (db day_of_week numbers) -- used for the "n changes" text. */
export function changedHourDays(a = [], b = []) {
  const na = normalizeHours(a);
  const nb = normalizeHours(b);
  return nb.filter((row, i) => !same(row, na[i])).map((r) => r.d);
}

/** Pay inputs are text while typing; compare as numbers ('' counts as 0, like Payroll treats a missing row). */
export const payChanged = (a, b) => {
  if (!a || !b) return false;
  const n = (v) => (v === '' || v == null ? 0 : Number(v));
  return n(a.monthlySalary) !== n(b.monthlySalary) || n(a.commissionRate) !== n(b.commissionRate) || n(a.productCommissionRate) !== n(b.productCommissionRate);
};

/** Services (by id) added / removed relative to the saved selection. Locked ("open to everyone") services never appear here. */
export function diffServiceIds(initialIds, currentIds) {
  const a = new Set(initialIds);
  const b = new Set(currentIds);
  return { added: [...b].filter((x) => !a.has(x)), removed: [...a].filter((x) => !b.has(x)) };
}

/** Tri-state of a category: 'all' | 'some' | 'none'. Locked services count as ticked. */
export function categoryState(services, tickedSet) {
  if (!services.length) return 'none';
  const n = services.filter((s) => s.openToAll || tickedSet.has(s.id)).length;
  return n === services.length ? 'all' : n === 0 ? 'none' : 'some';
}

/** Clicking a category box: all ticked -> untick every editable service; otherwise tick every editable service. */
export function toggleCategory(services, tickedSet) {
  const next = new Set(tickedSet);
  const editable = services.filter((s) => !s.openToAll);
  const allTicked = editable.every((s) => next.has(s.id));
  editable.forEach((s) => (allTicked ? next.delete(s.id) : next.add(s.id)));
  return next;
}

/** Total/ticked counts across all categories (locked services count as ticked). */
export function serviceCounts(categories, tickedSet) {
  let total = 0;
  let ticked = 0;
  categories.forEach((c) => c.services.forEach((s) => { total += 1; if (s.openToAll || tickedSet.has(s.id)) ticked += 1; }));
  return { total, ticked, notTicked: total - ticked };
}

/** Search + All / Ticked / Not ticked filter; categories left empty are dropped. */
export function filterCategories(categories, { search = '', filter = 'all', tickedSet }) {
  const q = search.trim().toLowerCase();
  return categories
    .map((c) => ({
      ...c,
      services: c.services.filter((s) => {
        if (q && !s.name.toLowerCase().includes(q)) return false;
        const ticked = s.openToAll || tickedSet.has(s.id);
        return filter === 'all' || (filter === 'ticked' ? ticked : !ticked);
      }),
    }))
    .filter((c) => c.services.length > 0);
}

const TONES = ['on-time', 'late', 'leave', 'off', 'absent', 'none'];

/**
 * Attendance-strip colour key for one day: 'on-time' | 'late' | 'leave' | 'off' | 'absent' | 'none' (future / nothing to show).
 * fetchTherapistAttendanceMonth already classifies each day, so those keys pass straight through; a raw therapist_attendance
 * status ('Present', 'Sick Leave', ...) is also understood so the helper stays usable on its own.
 */
export function attendanceTone(row) {
  const st = row?.status;
  if (!st) return 'none';
  if (TONES.includes(st)) return st;
  if (st === 'Day Off') return 'off';
  if (st === 'Absent') return 'absent';
  if (st === 'Present') return row.late ? 'late' : 'on-time';
  return 'leave'; // Leave, Annual Leave, Sick Leave, 1st/2nd-Half Day
}

/** Summary line for the attendance strip: "24 of 25 shifts on time · 1 late · 1 day of leave". */
export function attendanceSummary(rows = []) {
  const tones = rows.map(attendanceTone);
  const count = (t) => tones.filter((x) => x === t).length;
  const onTime = count('on-time');
  const late = count('late');
  const leave = count('leave');
  const absent = count('absent');
  const shifts = onTime + late + absent;
  if (!shifts && !leave) return '';
  const parts = [`${onTime} of ${shifts} shifts on time`];
  if (late) parts.push(`${late} late`);
  if (absent) parts.push(`${absent} absent`);
  if (leave) parts.push(`${leave} day${leave === 1 ? '' : 's'} of leave`);
  return parts.join(' · ');
}

/** 'YYYY-MM' of a 'YYYY-MM-DD'. */
export const monthOf = (dateStr) => dateStr.slice(0, 7);

// ── Today timeline ──────────────────────────────────────────────────────────
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':'); return Number(h) * 60 + Number(m || 0); };
const DONE = ['Completed'];
const GONE = ['Cancelled', 'No Show'];

/**
 * Lay today's bookings on the shift track. The track spans the shift (or the bookings if they run outside it), rounded to whole hours.
 * Overlapping slices (companion / combo) go to lane 0 or 1; a third overlapping slice is not drawn but counted in `hidden`.
 */
export function buildTimeline({ bookings = [], shift = null, nowTime = '00:00', transfer = null }) {
  const list = bookings.filter((b) => !GONE.includes(b.status) && b.startTime && b.endTime)
    .map((b) => ({ ...b, s: toMin(b.startTime), e: Math.max(toMin(b.endTime), toMin(b.startTime) + 5) }))
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const working = shift && !shift.isDayOff && shift.startTime && shift.endTime;
  const starts = [...list.map((b) => b.s), ...(working ? [toMin(shift.startTime)] : [])];
  const ends = [...list.map((b) => b.e), ...(working ? [toMin(shift.endTime)] : [])];
  if (!starts.length) return null;
  const from = Math.floor(Math.min(...starts) / 60) * 60;
  const to = Math.max(from + 60, Math.ceil(Math.max(...ends) / 60) * 60);
  const span = to - from;

  const laneEnd = [-1, -1];
  const blocks = []; let hidden = 0;
  const next = list.find((b) => !DONE.includes(b.status));
  for (const b of list) {
    const lane = laneEnd[0] <= b.s ? 0 : laneEnd[1] <= b.s ? 1 : -1;
    if (lane < 0) { hidden += 1; continue; }
    laneEnd[lane] = b.e;
    blocks.push({ ...b, lane, left: ((b.s - from) / span) * 100, width: ((b.e - b.s) / span) * 100, kind: DONE.includes(b.status) ? 'done' : b === next ? 'next' : 'up', minutes: b.e - b.s });
  }
  const lanes = blocks.some((b) => b.lane === 1) ? 2 : 1;
  const breaks = working ? (shift.breaks || []).map((br) => ({ ...br, left: ((toMin(br.startTime) - from) / span) * 100, width: ((toMin(br.endTime) - toMin(br.startTime)) / span) * 100 })) : [];

  // Next free gap: the first stretch of 30+ minutes from now (or the shift start) to the shift end with no booking or break in it.
  let gap = null;
  if (working) {
    // bookings, breaks and today's transfer window (away from this branch) all take the person out of the free time
    const busy = [...list.map((b) => [b.s, b.e]), ...(shift.breaks || []).map((br) => [toMin(br.startTime), toMin(br.endTime)]), ...(transfer ? [[transfer.startMin, transfer.endMin]] : [])].sort((a, b) => a[0] - b[0]);
    let cursor = Math.max(toMin(shift.startTime), toMin(nowTime)); const end = toMin(shift.endTime);
    for (const [bs, be] of busy) {
      if (be <= cursor) continue;
      if (bs - cursor >= 30) { gap = { from: cursor, to: bs }; break; }
      cursor = Math.max(cursor, be);
    }
    if (!gap && end - cursor >= 30) gap = { from: cursor, to: end };
  }
  // Today's transfer window (minutes of the day) clamped to the track: { startMin, endMin, label }
  const transferSlot = transfer && transfer.endMin > from && transfer.startMin < to
    ? { label: transfer.label, title: transfer.title, left: ((Math.max(transfer.startMin, from) - from) / span) * 100, width: ((Math.min(transfer.endMin, to) - Math.max(transfer.startMin, from)) / span) * 100 }
    : null;
  const nowPct = toMin(nowTime) >= from && toMin(nowTime) <= to ? ((toMin(nowTime) - from) / span) * 100 : null;
  const bookedMinutes = list.reduce((n, b) => n + (b.e - b.s), 0);
  return {
    from, to, blocks, hidden, lanes, breaks, gap, nowPct, bookedMinutes, transferSlot,
    done: list.filter((b) => DONE.includes(b.status)).length,
    toCome: list.filter((b) => !DONE.includes(b.status)).length,
    next: next ? { startTime: next.startTime } : null,
    ticks: Array.from({ length: span / 60 + 1 }, (_, i) => from + i * 60),
  };
}
