// "Falls outside" check (ZNLY-100, V29c2): before a manager changes hours, adds a block, marks leave or transfers a
// staff member out, availability_affected_bookings (migration-355) lists the upcoming bookings the change would strand.
// This module is the pure half: build the change payload, turn rows into display lines, and the half-day rules.
// Bookings are never moved or cancelled by any of this; the manager only gets to see them before saving.
import { hhmmToMinutes, minutesToHHMM } from './availability';
import { wordBranch } from '../utils/industryTerms';

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

// Reason codes returned by availability_affected_bookings -> short phrase shown beside each booking.
export function conflictReasonLabel(reason) {
  switch (reason) {
    case 'before_shift': return 'before the new hours';
    case 'after_shift': return 'after the new hours';
    case 'day_off': return 'on a day off';
    case 'break': return 'during a break';
    case 'block': return 'inside the block';
    case 'leave': return 'during leave';
    case 'other_branch': return `while at another ${wordBranch()}`;
    default: return 'outside availability';
  }
}

// rows (RPC) -> [{ id, number, date, time, customer, service, reason, text }]
export function toConflictList(rows = []) {
  return (rows || []).map((r) => ({
    id: r.booking_id,
    number: r.booking_number,
    date: r.booking_date,
    time: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    customer: r.customer_name || 'Guest',
    service: r.service || '',
    who: r.who || null,
    therapistId: r.therapist_id || null,
    reason: r.reason,
    text: conflictReasonLabel(r.reason),
  }));
}

// ---- change payloads (the `p_change` argument) ---------------------------------------------------------------------
const breaksOf = (breaks = []) => (breaks || [])
  .filter((b) => b && b.start && b.end)
  .map((b) => ({ start: hhmm(b.start), end: hhmm(b.end) }));

export const hoursChange = ({ dayOfWeek, isDayOff, start, end, breaks }) => (
  isDayOff
    ? { type: 'hours', day_of_week: dayOfWeek, is_day_off: true }
    : { type: 'hours', day_of_week: dayOfWeek, is_day_off: false, start: hhmm(start), end: hhmm(end), breaks: breaksOf(breaks) }
);

export const rosterChange = ({ date, isDayOff, start, end, breaks }) => (
  isDayOff
    ? { type: 'roster', date, is_day_off: true }
    : { type: 'roster', date, is_day_off: false, start: hhmm(start), end: hhmm(end), breaks: breaksOf(breaks) }
);

export const blockChange = ({ date, start, durationMinutes }) => ({ type: 'block', date, start: hhmm(start), duration_minutes: durationMinutes });

export const leaveChange = ({ from, to, offStart, offEnd }) => (
  offStart && offEnd
    ? { type: 'leave', from, to: to || from, off_start: hhmm(offStart), off_end: hhmm(offEnd) }
    : { type: 'leave', from, to: to || from }
);

export const transferChange = ({ fromTs, toTs, toBranchId }) => (
  { type: 'transfer', from_ts: fromTs, to_ts: toTs || null, to_branch_id: toBranchId }
);

// ---- half-day --------------------------------------------------------------------------------------------------------
// Mirrors the split rule in therapist_shift_for (migration-351): the half boundary is the start of the longest break,
// else the shift midpoint rounded down to 30 minutes, clamped inside the shift. 1st half = shift start..split, 2nd = split..shift end.
// shift: { start: 'HH:MM', end: 'HH:MM', breaks: [{ start_min, end_min }] } (the RPC row). Returns { start, end } 'HH:MM' or null.
export function defaultHalfDayOff({ status, shift }) {
  const s = hhmmToMinutes(shift?.start);
  let e = hhmmToMinutes(shift?.end);
  if (s == null || e == null) return null;
  if (shift.end === '23:59:59' || shift.end === '23:59') e = 1440;
  const longest = [...(shift.breaks || [])].sort((a, b) => ((b.end_min - b.start_min) - (a.end_min - a.start_min)) || (a.start_min - b.start_min))[0];
  let split = longest ? longest.start_min : Math.floor((s + e) / 2 / 30) * 30;
  split = Math.min(Math.max(split, s), e);
  if (status === '1st-Half Day') return { start: minutesToHHMM(s), end: minutesToHHMM(split) };
  if (status === '2nd-Half Day') return { start: minutesToHHMM(split), end: minutesToHHMM(e) };
  return null;
}

// Off times must be a real range inside that day's shift. Returns an inline error string, or null when valid.
export function validateHalfDay({ offStart, offEnd, shift }) {
  const a = hhmmToMinutes(offStart);
  const b = hhmmToMinutes(offEnd);
  if (a == null || b == null) return 'Enter both times.';
  if (a >= b) return 'Off start must be before off end.';
  const s = hhmmToMinutes(shift?.start);
  let e = hhmmToMinutes(shift?.end);
  if (s == null || e == null) return null;   // no shift to check against
  if (shift.end === '23:59:59' || shift.end === '23:59') e = 1440;
  if (a < s || b > e) return `Must be inside the shift (${hhmm(shift.start)}–${minutesToHHMM(e)}).`;
  return null;
}
