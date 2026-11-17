// Shared pure helpers for a staff member's day: day-of-week mapping, hours minus breaks, which hours apply on a date,
import { wordBranchCap } from './industryTerms';
// and today's status. Used by the Therapists list and the therapist profile so they agree with each other.
//
// DAY-OF-WEEK: the database (therapist_working_hours.day_of_week, migration-275) uses 0 = MONDAY .. 6 = SUNDAY, while
// JavaScript's Date#getDay() uses 0 = SUNDAY. ALWAYS go through these two helpers; never index by getDay() directly.

/** JS getDay() (0 = Sun) -> DB day_of_week (0 = Mon). */
export const jsDayToDbDow = (jsDay) => (jsDay + 6) % 7;

/** DB day_of_week (0 = Mon) -> JS getDay() (0 = Sun). */
export const dbDowToJsDay = (dbDow) => (dbDow + 1) % 7;

/** 'YYYY-MM-DD' -> DB day_of_week (0 = Mon). Calendar-date maths in UTC so the viewer's timezone never shifts the day. */
export function dbDowOfDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return jsDayToDbDow(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

/** Shown wherever today's hours are "nothing set": bookable, but only inside branch hours. */
export const NO_HOURS_LABEL = 'No hours set';

export const DB_DOW_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** 'HH:MM' or 'HH:MM:SS' -> minutes since midnight (null for empty/invalid). */
export function timeToMinutes(t) {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/**
 * Working minutes in a day: (end - start) minus the breaks that fall inside it. Breaks are clipped to the shift, overlapping
 * breaks are merged (so overlap isn't taken off twice), and a day off / missing times is 0.
 */
export function dayWorkingMinutes({ startTime, endTime, isDayOff = false, breaks = [] } = {}) {
  if (isDayOff) return 0;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start == null || end == null || end <= start) return 0;
  const spans = (breaks || [])
    .map((b) => [Math.max(start, timeToMinutes(b.startTime) ?? start), Math.min(end, timeToMinutes(b.endTime) ?? start)])
    .filter(([a, z]) => z > a)
    .sort((x, y) => x[0] - y[0]);
  let taken = 0;
  let cursor = start;
  for (const [a, z] of spans) {
    const from = Math.max(a, cursor);
    if (z > from) { taken += z - from; cursor = z; }
  }
  return end - start - taken;
}

/** Sum of dayWorkingMinutes over a week's rows. */
export const weekWorkingMinutes = (rows = []) => rows.reduce((sum, r) => sum + dayWorkingMinutes(r), 0);

/** 150 -> '2h 30m', 120 -> '2h', 45 -> '45m', 0 -> '0h'. */
export function formatMinutes(mins) {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return r ? `${r}m` : '0h';
}

/**
 * The hours that apply on `dateStr`: a roster override for that exact date wins, otherwise the weekly row for that weekday.
 * weeklyRows: [{ dayOfWeek (DB, 0=Mon), startTime, endTime, isDayOff, breaks }]; overrides: [{ date, startTime, endTime, isDayOff }].
 * Returns { source: 'override' | 'weekly' | 'none', startTime, endTime, isDayOff, breaks } -- 'none' when nothing is configured.
 * An override carries no breaks of its own.
 */
export function effectiveHoursForDate(dateStr, weeklyRows = [], overrides = []) {
  const o = (overrides || []).find((x) => x.date === dateStr);
  if (o) return { source: 'override', startTime: o.startTime, endTime: o.endTime, isDayOff: !!o.isDayOff, breaks: [] };
  const w = (weeklyRows || []).find((x) => x.dayOfWeek === dbDowOfDate(dateStr));
  if (w) return { source: 'weekly', startTime: w.startTime, endTime: w.endTime, isDayOff: !!w.isDayOff, breaks: w.breaks || [] };
  return { source: 'none', startTime: null, endTime: null, isDayOff: false, breaks: [] };
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

/**
 * One therapist_shifts_for_range row (the staff-availability rule, migration-354) -> the hours object the "today" surfaces read.
 * THE one place "what are this person's hours on that date" comes from: weekly row, roster date change, branch-hours clamp and
 * breaks are all already resolved in the database. `source`: 'override' (roster date change) | 'weekly' | 'none' (nothing set:
 * open, but only inside branch hours -> `openNoHours`). A missing row (no access / RPC unavailable) is `missing`.
 */
export function hoursFromShiftRow(row) {
  if (!row) return { source: 'none', startTime: null, endTime: null, isDayOff: false, breaks: [], openNoHours: false, off: [], missing: true };
  const source = row.source === 'roster' ? 'override' : row.source === 'weekly' ? 'weekly' : row.source === 'window' ? 'window' : 'none';
  const works = row.works === true && !!row.start_time;
  return {
    source,
    startTime: works ? hhmm(row.start_time) : null,
    endTime: works ? (String(row.end_time) === '23:59:59' ? '24:00' : hhmm(row.end_time)) : null,
    isDayOff: !works,
    breaks: (row.breaks || []).map((b) => ({ name: b.name || '', startTime: b.start, endTime: b.end })),
    openNoHours: source === 'none' && works,
    off: row.off || [],   // leave / block / other-branch ranges of that day (start_min / end_min), as the rule returns them
    missing: false,
  };
}

const LEAVE_STATUSES = new Set(['Leave', 'Annual Leave', 'Sick Leave', '1st-Half Day', '2nd-Half Day']);

/**
 * Today's status for one staff member.
 *   attendance: the therapist_attendance row for today ({ status, checkInTime }) or null
 *   hours: effectiveHoursForDate() for today;  nowTime: 'HH:MM' Nepal time
 * Returns { key, checkedInAt?, shift? } where key is one of:
 *   'checked-in' | 'not-checked-in' (shift started, no check-in) | 'upcoming' (shift later today) |
 *   'leave' | 'off' (day off / marked Day Off / Absent) | 'no-hours-open' (no hours set, open inside branch hours) |
 *   'no-roster' (hours can't be read at all)
 */
export function todayStatus({ attendance = null, hours = null, nowTime = '00:00' } = {}) {
  const shift = hours && hours.startTime && hours.endTime && !hours.isDayOff ? { start: hours.startTime.slice(0, 5), end: hours.endTime.slice(0, 5) } : null;
  const st = attendance?.status;
  if (st && LEAVE_STATUSES.has(st) && !attendance.checkInTime) return { key: 'leave', shift };
  if (st === 'Day Off' || st === 'Absent') return { key: 'off', shift };
  if (attendance?.checkInTime) return { key: 'checked-in', checkedInAt: attendance.checkInTime, shift };
  if (!hours || hours.missing) return { key: 'no-roster', shift: null };
  // Nothing set for today: bookable inside branch hours (the rule's own answer), shown as "No hours set · open".
  if (hours.openNoHours) return { key: 'no-hours-open', shift };
  if (hours.isDayOff || !shift) return { key: 'off', shift: null };
  const now = timeToMinutes(nowTime);
  const start = timeToMinutes(shift.start);
  const end = timeToMinutes(shift.end);
  if (now < start) return { key: 'upcoming', shift };
  if (now >= end) return { key: 'off', shift }; // shift is over and nobody checked in: nothing to chase
  return { key: 'not-checked-in', shift };
}

/**
 * { title, sub } for today's status of one person. THE one place the wording lives: the list cell, the peek pill, the profile header
 * and the Overview all call it. `t` = { status (from todayStatus, checkedInAt already a Nepal 'HH:MM' string), attendance: { status }, hours, worksTomorrow }.
 */
export function todayLabels(t) {
  // The shared status line (utils/todayStatusLine) wins when the caller built one; the branches below are the fallback.
  if (t.statusLine) return { title: t.statusLine.parts[0], sub: t.statusLine.parts.slice(1).join(' · ') || null };
  const s = t.status;
  const shift = s.shift ? `Shift ${s.shift.start} – ${s.shift.end}` : null;
  switch (s.key) {
    case 'checked-in': return { title: `Checked in ${s.checkedInAt || ''}`.trim(), sub: shift };
    case 'not-checked-in': return { title: 'Not checked in', sub: `Shift started ${s.shift?.start}` };
    case 'upcoming': return { title: `Starts ${s.shift?.start}`, sub: shift };
    case 'leave': return { title: 'On leave', sub: t.attendance?.status && t.attendance.status !== 'Leave' ? t.attendance.status : null };
    case 'off': {
      if (t.attendance?.status === 'Absent') return { title: 'Absent today', sub: 'Marked absent' };
      if (t.attendance?.status === 'Day Off') return { title: 'Off today', sub: 'Marked day off' };
      if (t.hours.source === 'override' && t.hours.isDayOff) return { title: 'Off today', sub: 'Day off in the roster' };
      if (t.hours.source === 'weekly' && t.hours.isDayOff) return { title: 'Off today', sub: t.worksTomorrow ? 'Weekly day off · back tomorrow' : 'Weekly day off' };
      return { title: 'Off today', sub: shift ? `Shift ended ${s.shift.end}` : null };
    }
    case 'no-hours-open': return { title: NO_HOURS_LABEL, sub: shift ? `${wordBranchCap()} hours ${s.shift.start} – ${s.shift.end}` : 'Set hours in their profile' };
    default: return { title: 'No shift set', sub: 'Set hours in their profile' };
  }
}

