// Calendar shading for the staff-availability rule (ZNLY-100, V29c1). Pure mapping over the rows
// therapist_shifts_for_range returns; no shift logic lives here (the database owns the rule). The look of each kind is
// defined once in SHADE_STYLES so the calendar, the staff's own view and the profile Working hours reuse the same colours.
import { evaluateAvailability, hhmmToMinutes, minutesToHHMM } from './availability';
import { hoursFromShiftRow } from '../utils/staffDay';
import { todayStatusLine } from '../utils/todayStatusLine';

const stripes = (a, b) => `repeating-linear-gradient(135deg, ${a} 0 6px, ${b} 6px 7px)`;

// kind -> look. `off` is plain grey (no stripes); break / leave / branch are striped; block keeps the existing
// ManualBlockOverlay look and is only listed here so its colours have one home.
export const SHADE_STYLES = {
  off: { background: '#F4F4F2', color: '#8A8A85' },
  break: { background: stripes('#FBF6EC', '#F3E8D2'), color: '#B45309', solid: '#FBF6EC' },
  leave: { background: stripes('#F7F1F8', '#ECE0EF'), color: '#7A4B86', solid: '#F7F1F8' },
  branch: { background: stripes('#F4F4F6', '#E9E9EC'), color: '#6B6B73', solid: '#F4F4F6' },
  block: { background: stripes('#F4F4F6', '#E9E9EC'), color: '#6B6B73', solid: '#F4F4F6' },
};
export const OUTSIDE_HOURS_OUTLINE = '#D97706';   // amber outline on an existing booking the rule would now refuse

const endMinOf = (shiftDay) => {
  if (!shiftDay?.end_time) return null;
  const m = hhmmToMinutes(shiftDay.end_time);
  return m === 1439 && shiftDay.end_time === '23:59:59' ? 1440 : m;   // the RPC renders 24:00 as 23:59:59
};

// rows -> { [therapistId]: { [yyyy-mm-dd]: row } }
export function indexShifts(rows) {
  const out = {};
  (rows || []).forEach((r) => {
    if (!out[r.therapist_id]) out[r.therapist_id] = {};
    out[r.therapist_id][String(r.shift_date).slice(0, 10)] = r;
  });
  return out;
}

const range = (s, e, fmt) => `${fmt(minutesToHHMM(s))}–${fmt(minutesToHHMM(e))}`;

// One day's row -> shaded ranges [{ kind, startMin, endMin, label, reason, code }]. Blocks (BLOCKED) are NOT returned:
// the calendar already draws them, interactive, from its block layer. `fmt` formats an "HH:MM" for display.
export function buildShadeSegments(shiftDay, fmt = (t) => t) {
  if (!shiftDay) return [];
  const out = [];
  const s = shiftDay.start_time ? hhmmToMinutes(shiftDay.start_time) : null;
  const e = endMinOf(shiftDay);
  if (!shiftDay.works) out.push({ kind: 'off', startMin: 0, endMin: 1440, reason: 'day_off', code: 'OFF_SHIFT' });
  else if (s !== null && e !== null) {
    if (s > 0) out.push({ kind: 'off', startMin: 0, endMin: s, reason: 'before_shift', code: 'OFF_SHIFT' });
    if (e < 1440) out.push({ kind: 'off', startMin: e, endMin: 1440, reason: 'after_shift', code: 'OFF_SHIFT' });
  }
  if (shiftDay.works) {
    (shiftDay.breaks || []).forEach((b) => out.push({
      kind: 'break', startMin: b.start_min, endMin: b.end_min, code: 'ON_BREAK', reason: 'break',
      label: `${b.name || 'Break'} ${range(b.start_min, b.end_min, fmt)}`,
    }));
  }
  (shiftDay.off || []).forEach((o) => {
    if (o.code === 'ON_LEAVE') {
      const full = o.reason === 'leave_full';
      out.push({
        kind: 'leave', startMin: o.start_min, endMin: o.end_min, code: 'ON_LEAVE', reason: o.reason,
        label: full ? 'Leave' : `Leave · off ${range(o.start_min, o.end_min, fmt)}`,
      });
    } else if (o.code === 'OTHER_BRANCH') {
      out.push({
        kind: 'branch', startMin: o.start_min, endMin: o.end_min, code: 'OTHER_BRANCH', reason: o.reason,
        label: `At ${o.label || 'another branch'} ${range(o.start_min, o.end_min, fmt)}`,
      });
    }
  });
  return out;
}

// Column-header line for one day: the SHORT form of the shared status line (utils/todayStatusLine). Returns { text, full, dot, tone }.
// `ctx` only matters for today's column: { isToday, nowMin, attendance: { status, checkInTime, checkOutTime } }. Any other date reads
// as "before the shift", so it shows the plain range / day off / leave / no set hours.
export function shiftHeaderInfo(shiftDay, ctx = {}) {
  if (!shiftDay) return null;
  const line = todayStatusLine({
    hours: hoursFromShiftRow(shiftDay),
    attendance: ctx.isToday ? ctx.attendance || null : null,
    nowMin: ctx.isToday ? ctx.nowMin ?? 0 : (shiftDay.source === 'none' && shiftDay.start_time ? hhmmToMinutes(shiftDay.start_time) : -1),
    branchClosed: !!ctx.branchClosed,
  });
  return { text: line.short, full: line.full, dot: line.dot, tone: line.tone, key: line.key };
}

// Why this time can't take a booking for the therapist, or null when it can. Same verdict the pre-check and the
// database give (evaluateAvailability), minus overlaps with other bookings (those are not shading).
export function slotVerdict(shiftDay, startMin, endMin, opts = {}) {
  if (!shiftDay) return null;
  return evaluateAvailability({ shiftDay, bookings: [], startMin, endMin, therapistName: opts.therapistName, staffLabel: opts.staffLabel });
}

// An existing booking that the rule would now refuse (hours / break / leave changed after it was made).
export const isOutsideShift = (shiftDay, startMin, endMin) => !!slotVerdict(shiftDay, startMin, endMin);

// The short reason on an outlined booking card: names which rule it breaks, not always "outside hours".
export const OUTSIDE_REASON_TEXT = { ON_LEAVE: 'on leave', ON_BREAK: 'during a break', BLOCKED: 'in a block', OFF_SHIFT: 'outside hours' };
// "In a block 11:00–12:00 · booking kept": the amber line for the hover card and the side panel. `fmt` formats an "HH:MM".
export function outsideNote(verdict, fmt = (t) => t) {
  const text = outsideReasonText(verdict);
  if (!text) return null;
  const d = verdict.detail || {};
  const withRange = verdict.code !== 'OFF_SHIFT' && d.range_start && d.range_end ? ` ${fmt(d.range_start)}–${fmt(d.range_end)}` : '';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${withRange} · booking kept`;
}
export function outsideReasonText(verdict) {
  if (!verdict) return null;
  if (verdict.code === 'OTHER_BRANCH') return `at ${verdict.detail?.label || 'another branch'}`;
  return OUTSIDE_REASON_TEXT[verdict.code] || 'outside hours';
}
