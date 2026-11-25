// Pure rules for "who is free" on the Bookings page (V15b): Free-now card, suggested therapist, "Needs you now" line.
// Everything is in Nepal-local minutes since midnight for ONE day (`ctx.date`); callers pass already-fetched data.
//
// On-shift source: attendance check-in when the branch actually records it for the day (some therapist has a Present/half-day
// row or a check-in time), otherwise the rule's own shift for the day (`ctx.shiftById`, built from therapist_shifts_for_range
// with utils/staffDay#hoursFromShiftRow: weekly row, roster date change, breaks, branch-hours clamp). A therapist with no hours
// set is open inside branch hours (the clamp is already in the shift), shown as "No hours set · open".
import { lateMinutes } from './bookingsList';
import { todayStatusLine } from './todayStatusLine';
import { wordBranchCap, localizeTerms } from './industryTerms';
import { isOwed } from '../lib/dashboardMoney';
import { formatClockNow } from './clockTime';

export const toMin = (t) => { if (t == null || t === '') return null; const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };
export const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** 15:00 → "3:00pm" */
export const clock = (min) => formatClockNow(fromMin(min % 1440));

const LEAVE = ['Leave', 'Annual Leave', 'Sick Leave', 'Day Off'];
const ACTIVE = ['pending', 'confirmed', 'in-progress'];
const dbStatus = (b) => String(b?.status || '').toLowerCase();

/** 'attendance' when check-in is actually recorded for the day, else 'roster'. */
export function shiftSource(attendance = []) {
  return attendance.some((a) => a.checkInTime || a.status === 'Present' || a.status === '1st-Half Day' || a.status === '2nd-Half Day') ? 'attendance' : 'roster';
}

/** { on, from, to, reason } — `from`/`to` null = open ended. Leave/absent always win. */
function shiftOf(t, ctx) {
  if (ctx.branchClosed) return { on: false, reason: `${wordBranchCap()} closed` };
  const att = ctx.attendanceById?.[t.id];
  if (att?.status === 'Absent') return { on: false, reason: 'Absent today' };
  if (att && LEAVE.includes(att.status)) return { on: false, reason: att.status === 'Day Off' ? 'Day off' : 'On leave' };
  const wh = ctx.shiftById?.[t.id];
  const known = !!wh && !wh.missing;
  const cap = (m) => (m != null && m >= 1440 ? null : m); // a shift "until 24:00" is open ended
  const roster = known ? (wh.isDayOff ? null : { from: toMin(wh.startTime), to: cap(toMin(wh.endTime)) }) : { from: null, to: null };
  if (known && wh.isDayOff) return { on: false, reason: wh.source === 'none' ? 'Closed' : 'Day off' };
  if (ctx.source === 'attendance') {
    if (!att || !att.status) return { on: false, reason: 'Not checked in' };
    const inAt = toMin(att.checkInTime);
    const outAt = toMin(att.checkOutTime);
    return { on: true, from: inAt ?? roster?.from ?? null, to: outAt ?? roster?.to ?? null, reason: '' };
  }
  // Shift mode. Only when the shift can't be read at all (no access / rule unavailable) do we fall back to counting people who have
  // an assigned (non-cancelled) booking today; otherwise every active service staffer would look "free".
  if (!known && !worksToday(t, ctx)) return { on: false, reason: 'No shift or bookings today' };
  return { on: true, from: roster?.from ?? null, to: roster?.to ?? null, reason: '' };
}

const VOID = ['cancelled', 'no show'];
function worksToday(t, ctx) {
  if (!ctx._works) {
    ctx._works = new Set();
    for (const b of ctx.bookings || []) {
      if (VOID.includes(dbStatus(b))) continue;
      for (const x of b.therapists || []) ctx._works.add(x.id);
      if (b.therapist?.id) ctx._works.add(b.therapist.id);
    }
  }
  return ctx._works.has(t.id);
}

/** How "on shift" was decided for the Free-now count: 'attendance' | 'roster' (the rule's shift is known for everyone) | 'bookings' (shifts unreadable: people with a booking today). */
export function shiftBasis(therapists, ctx) {
  if (ctx.source === 'attendance') return 'attendance';
  return therapists.every((t) => ctx.shiftById?.[t.id] && !ctx.shiftById[t.id].missing) ? 'roster' : 'bookings';
}

/** Everything that occupies the therapist: active bookings, manual blocks, transfer windows, roster breaks. */
function intervalsOf(t, ctx, { excludeBookingId } = {}) {
  const out = [];
  for (const b of ctx.bookings || []) {
    if (b.bookingId === excludeBookingId || !ACTIVE.includes(dbStatus(b))) continue;
    const mine = (b.therapists || []).find((x) => x.id === t.id) || (b.therapist?.id === t.id ? b.therapist : null);
    if (!mine) continue;
    const from = toMin(mine.startTime || b.startTime || b.time);
    let to = toMin(mine.endTime || b.endTime);
    if (to == null && from != null) to = from + (parseInt(b.duration, 10) || 60);
    if (from == null || to == null) continue;
    const overrun = dbStatus(b) === 'in-progress' && to <= ctx.nowMin;
    out.push({ from, to: overrun ? 1440 : to, kind: 'booking', status: dbStatus(b), overrun, bookingId: b.bookingId });
  }
  for (const k of ctx.blocks || []) if (k.therapistId === t.id) out.push({ from: toMin(k.startTime), to: k.endTime === '24:00' ? 1440 : toMin(k.endTime), kind: 'block', label: k.description });
  for (const k of ctx.transfers || []) if (k.therapistId === t.id) out.push({ from: toMin(k.startTime), to: k.endTime === '24:00' ? 1440 : toMin(k.endTime), kind: 'transfer', label: k.description });
  const wh = ctx.shiftById?.[t.id];
  for (const br of wh?.breaks || []) out.push({ from: toMin(br.startTime), to: toMin(br.endTime), kind: 'break', label: br.name || 'Break' });
  // a half day of leave takes that part of the shift off
  for (const o of wh?.off || []) if (o.code === 'ON_LEAVE' && o.reason === 'leave_half') out.push({ from: o.start_min, to: o.end_min, kind: 'leave', label: 'Half day off' });
  return out.filter((i) => i.from != null && i.to != null).sort((a, b) => a.from - b.from);
}

/** State of one therapist at `ctx.nowMin`. */
export function therapistState(t, ctx) {
  const shift = shiftOf(t, ctx);
  if (!shift.on) return { state: 'off', reason: shift.reason };
  const now = ctx.nowMin;
  if (shift.from != null && now < shift.from) return { state: 'off', reason: `Starts at ${clock(shift.from)}` };
  if (shift.to != null && now >= shift.to) return { state: 'off', reason: 'Shift ended' };
  const iv = intervalsOf(t, ctx);
  const cover = iv.find((i) => i.from <= now && now < i.to);
  if (cover) {
    let at = cover.to;
    for (const i of iv) if (i.from <= at && i.to > at) at = i.to; // back-to-back chains
    const freeAt = cover.overrun || at >= 1440 || (shift.to != null && at >= shift.to) ? null : at;
    return { state: 'busy', kind: cover.kind, status: cover.status, freeAt, overrun: !!cover.overrun, label: cover.label || null };
  }
  const next = iv.find((i) => i.from > now);
  let until = next ? next.from : null;
  if (shift.to != null && (until == null || shift.to < until)) until = shift.to;
  return { state: 'free', freeUntil: until };
}

/** "free until 3:00pm", "free until 2:30pm (35 min)", "free all afternoon". */
export function freeUntilLabel(freeUntil, nowMin) {
  if (freeUntil == null) return nowMin < 720 ? 'free all day' : nowMin < 1020 ? 'free all afternoon' : 'free all evening';
  const gap = freeUntil - nowMin;
  return `free until ${clock(freeUntil)}${gap < 60 ? ` (${gap} min)` : ''}`;
}

/** The Free-now card: who is free (with how long) and who is in session (with when they free up). */
export function availabilityNow(therapists, ctx) {
  const free = [];
  const inSession = [];
  for (const t of therapists) {
    const s = therapistState(t, ctx);
    if (s.state === 'free') {
      // `status` is the shared "today" line (same wording as the Therapists list, the profile and the calendar header); `label` is the free-for part.
      const noHours = !!ctx.shiftById?.[t.id]?.openNoHours;
      const att = ctx.attendanceById?.[t.id];
      const status = todayStatusLine({
        hours: ctx.shiftById?.[t.id], nowMin: ctx.nowMin, branchClosed: !!ctx.branchClosed,
        attendance: att?.status ? { status: att.status, checkInTime: att.checkInTime || null, checkOutTime: att.checkOutTime || null } : null,
      }).full;
      free.push({ therapist: t, freeUntil: s.freeUntil, noHours, status, label: freeUntilLabel(s.freeUntil, ctx.nowMin) });
    }
    else if (s.state === 'busy' && s.kind === 'booking') inSession.push({ therapist: t, freeAt: s.freeAt, overrun: s.overrun, label: s.freeAt != null ? `free at ${clock(s.freeAt)}` : 'running over' });
  }
  free.sort((a, b) => (a.freeUntil ?? 1e9) - (b.freeUntil ?? 1e9) || a.therapist.name.localeCompare(b.therapist.name));
  inSession.sort((a, b) => (a.freeAt ?? 1e9) - (b.freeAt ?? 1e9));
  return { free, inSession, source: ctx.source, basis: shiftBasis(therapists, ctx) };
}

/** Next 10-minute slot at or after `nowMin`, e.g. 13:52 → 14:00. */
export const nextSlot10 = (nowMin) => Math.min(Math.ceil(nowMin / 10) * 10, 1430);

/** Is the therapist on shift for the whole [start, end) and unoccupied (optionally ignoring one booking)? */
export function freeForSlot(t, startMin, endMin, ctx, opts = {}) {
  const shift = shiftOf(t, ctx);
  if (!shift.on) return false;
  if (shift.from != null && startMin < shift.from) return false;
  if (shift.to != null && endMin > shift.to) return false;
  return !intervalsOf(t, ctx, opts).some((i) => i.from < endMin && startMin < i.to);
}

/** Usual therapist: top therapist across a guest's rendered visits, only when ≥2 visits AND ≥ half of them (the V11 rule). */
export function usualTherapistId(visits = []) {
  const counts = new Map();
  for (const v of visits) if (v.therapistId) counts.set(v.therapistId, (counts.get(v.therapistId) || 0) + 1);
  let best = null;
  for (const [id, n] of counts) if (!best || n > best.n) best = { id, n };
  return best && best.n >= 2 && best.n / visits.length >= 0.5 ? best.id : null;
}

const bookingsToday = (t, ctx) => (ctx.bookings || []).filter((b) => ACTIVE.includes(dbStatus(b)) && ((b.therapists || []).some((x) => x.id === t.id) || b.therapist?.id === t.id)).length;

/**
 * Suggest a therapist for an unassigned booking: free for its slot AND does the service (only when that service has an
 * eligibility list) → the guest's usual therapist → the least busy today. Returns null when nobody qualifies.
 */
export function suggestTherapist(booking, therapists, ctx, { eligibility = new Map(), usualId = null } = {}) {
  const start0 = toMin(booking.time || booking.startTime);
  if (start0 == null) return null;
  const dur = (toMin(booking.endTime) != null ? toMin(booking.endTime) - start0 : parseInt(booking.duration, 10)) || 60;
  // Judged on the booking's own slot (that is what the server checks when assigning), even when it is already running late.
  const start = start0;
  const end = start0 + dur;
  const allowed = booking.serviceId ? eligibility.get(booking.serviceId) : null;
  const restricted = !!(allowed && allowed.size > 0);
  const pool = therapists
    .filter((t) => (!restricted || allowed.has(t.id)) && freeForSlot(t, start, end, ctx, { excludeBookingId: booking.bookingId }))
    .map((t) => ({ t, load: bookingsToday(t, ctx), usual: t.id === usualId }));
  if (!pool.length) return null;
  pool.sort((a, b) => (b.usual - a.usual) || (a.load - b.load) || a.t.name.localeCompare(b.t.name));
  const top = pool[0];
  const reasons = [`Free ${clock(start)}–${clock(end)}`];
  if (restricted) reasons.push(`does ${booking.service}`);
  if (top.usual) reasons.push('usual therapist for this guest');
  else reasons.push(top.load === 0 ? 'no bookings yet today' : `${top.load} booking${top.load === 1 ? '' : 's'} today (least busy)`);
  return { therapist: top.t, reasons, label: reasons.join(' · '), start, end };
}

// ── Highlight + "Needs you now" ─────────────────────────────────────────────────────────────────────────────────────────
/** The ONE place that decides "nobody has opened this online booking yet" (team-level, migration-335): online (created_by IS NULL), not acknowledged, still live. */
export const isNewOnline = (b) => b.createdBy == null && !b.acknowledgedAt && !['cancelled', 'no show', 'completed'].includes(dbStatus(b));
/** Row highlight (dot, bold name, tint). Kept as a function of the booking alone — a personal unread notification is no longer a trigger. */
export const isUnseen = (b) => isNewOnline(b);

const isToday = (b, ctx) => String(b.date).slice(0, 10) === ctx.date;
export const needsTherapist = (b, ctx) => isToday(b, ctx) && (dbStatus(b) === 'pending' || dbStatus(b) === 'confirmed') && !((b.therapists || []).length || b.therapist);

/** Finished (Completed) today with money still owed. Reuses the dashboard's loose-ends rule (lib/dashboardMoney isOwed) on this row's fields: no second rule. */
export const owedToday = (b, ctx) => isToday(b, ctx) && isOwed({
  status: dbStatus(b) === 'completed' ? 'Completed' : b.status,
  payment_status: b.paymentStatus,
  final_amount: b.finalAmount,
  ...(Array.isArray(b.payments) ? { payments: b.payments } : { amount_paid: b.amountPaid }),
});

/** Rows behind each "Needs you now" item (for the Review / View / Assign filters). */
export function matchesNeed(b, need, ctx) {
  if (!isToday(b, ctx)) return false;
  if (need === 'online') return isNewOnline(b);
  if (need === 'late') return lateMinutes(b, { today: ctx.date, nowHM: fromMin(ctx.nowMin) }) != null;
  if (need === 'assign') return needsTherapist(b, ctx);
  if (need === 'unpaid') return owedToday(b, ctx);
  return true;
}

/**
 * @returns {{ id:'online'|'late'|'unpaid'|'assign', count:number, text:string, action:string, tel?:string }[]}  only items with count > 0.
 */
export function needsYouNow(rows, ctx) {
  const today = rows.filter((b) => isToday(b, ctx));
  const nowHM = fromMin(ctx.nowMin);
  const items = [];
  const online = today.filter(isNewOnline);
  if (online.length) items.push({ id: 'online', count: online.length, text: `${online.length} new online booking${online.length === 1 ? '' : 's'}`, action: 'Review' });
  const late = today.map((b) => ({ b, m: lateMinutes(b, { today: ctx.date, nowHM }) })).filter((x) => x.m != null).sort((a, b) => b.m - a.m);
  if (late.length === 1) {
    const { b, m } = late[0];
    const h = Math.floor(m / 60);
    const span = h > 0 ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`;
    items.push({ id: 'late', count: 1, text: `${String(b.customerName || 'A guest').split(' ')[0]} is ${span} late`, action: b.customerPhone ? 'Call' : 'View', tel: b.customerPhone || undefined });
  } else if (late.length > 1) {
    items.push({ id: 'late', count: late.length, text: `${late.length} bookings are running late`, action: 'View' });
  }
  const unpaid = today.filter((b) => owedToday(b, ctx));
  if (unpaid.length) items.push({ id: 'unpaid', count: unpaid.length, text: `${unpaid.length} finished but not paid`, action: 'Collect' });
  const assign = today.filter((b) => needsTherapist(b, ctx));
  if (assign.length) items.push({ id: 'assign', count: assign.length, text: localizeTerms(`${assign.length} booking${assign.length === 1 ? '' : 's'} need${assign.length === 1 ? 's' : ''} a therapist`), action: 'Assign' });
  return items;
}
