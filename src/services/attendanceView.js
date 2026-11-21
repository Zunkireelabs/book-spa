// Pure logic for the Attendance page (ZNLY-123 / V34b): what state a person's day is in, who needs attention, what a bulk "Mark
// present" may do, what a change costs in pay (the SAME formula as Payroll), and when a reason is required (mirrors migration 364).
// Times are 'HH:MM' (Kathmandu); dates 'YYYY-MM-DD'.

export const LEAVE_STATUSES = ['Annual Leave', 'Sick Leave', 'Leave'];
export const isHalfDayStatus = (s) => s === '1st-Half Day' || s === '2nd-Half Day';
export const toMin = (t) => {
  if (!t) return null;
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
};
export const minToHm = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

const LATER_BEFORE_START_MIN = 15; // "Later" until 15 min before the shift

// kind -> { label, tone } for the status pill.
export const KINDS = {
  no_show: { label: 'No show', tone: 'err' },
  present_default: { label: 'Not checked in', tone: 'none' },   // switch off: scheduled, nothing saved, counted present
  present_saved: { label: 'Present', tone: 'in' },               // Present saved without times (a confirm / status-only save)
  no_checkout: { label: 'No check-out', tone: 'err' },
  unmarked: { label: 'Not marked', tone: 'err' },
  absent: { label: 'Absent', tone: 'err' },
  in: { label: 'In', tone: 'in' },
  half: { label: 'Half day', tone: 'warn' },
  out: { label: 'Out', tone: 'out' },
  leave: { label: 'Leave', tone: 'none' },
  off: { label: 'Off', tone: 'none' },
  not_in_yet: { label: 'Not in yet', tone: 'none' },
  later: { label: 'Later', tone: 'none' },
  not_scheduled: { label: 'Not scheduled', tone: 'none' },
};
export const ATTENTION_KINDS = ['no_show', 'no_checkout', 'unmarked'];

/**
 * person: { status, checkIn, checkOut }; shift: { start, end } | null (null = not scheduled that day);
 * settings: { lateGraceMinutes, openCheckoutHours, expectCheckIn }; nowMin: minutes since Kathmandu midnight (only used when date === today).
 * Returns { kind, lateMin (0 when none or within grace), minAfterStart (checked in 1..grace min late), startsInMin, checkedIn }.
 */
export function deriveRow({ person, date, today, nowMin, shift, settings, visitor = false }) {
  const st = person.status || '';
  const isToday = date === today;
  const isPast = date < today;
  const start = shift ? toMin(shift.start) : null;
  const end = shift ? toMin(shift.end) : null;
  const grace = settings?.lateGraceMinutes ?? 10;
  const openH = settings?.openCheckoutHours ?? 4;
  const out = { kind: 'not_scheduled', lateMin: 0, minAfterStart: 0, startsInMin: null, checkedIn: false };

  if (LEAVE_STATUSES.includes(st)) return { ...out, kind: 'leave' };
  if (st === 'Day Off') return { ...out, kind: 'off' };
  if (st === 'Absent') return { ...out, kind: 'absent' };

  if (st === 'Present' || isHalfDayStatus(st) || person.checkIn) {
    const inMin = toMin(person.checkIn);
    let late = 0; let after = 0;
    if (!visitor && start != null && inMin != null && inMin > start) {
      if (inMin - start > grace) late = inMin - start; else after = inMin - start;
    }
    const res = { ...out, checkedIn: true, lateMin: late, minAfterStart: after };
    if (person.checkOut) return { ...res, kind: 'out' };
    const open = isPast || (isToday && end != null && nowMin != null && nowMin >= end + openH * 60);
    if (open && person.checkIn && !person.openElsewhere && !person.legacyOpen) return { ...res, kind: 'no_checkout' };   // an open punch at ANOTHER branch is that branch's to flag
    // "In" needs a check-in time; a saved Present without times is just "Present".
    if (!person.checkIn && !isHalfDayStatus(st)) return { ...res, checkedIn: false, kind: 'present_saved' };
    return { ...res, kind: isHalfDayStatus(st) ? 'half' : 'in' };
  }

  // not marked
  if (!shift || start == null) return out;
  const expect = !!settings?.expectCheckIn;
  // Switch OFF (default): scheduled people are present unless marked otherwise; a missing check-in is just "no check-in".
  if (!expect && (isPast || (isToday && nowMin >= start))) return { ...out, kind: 'present_default' };
  if (isPast) return { ...out, kind: 'unmarked' };
  if (!isToday) return { ...out, kind: 'later', startsInMin: null };
  if (nowMin < start - LATER_BEFORE_START_MIN) return { ...out, kind: 'later', startsInMin: start - nowMin };
  if (nowMin <= start + grace) return { ...out, kind: 'not_in_yet' };
  return { ...out, kind: 'no_show', minAfterStart: nowMin - start };
}

/** Bulk "Mark present" time for one person: their shift start, never a time that hasn't happened yet; null = skip (later / no shift). */
export function bulkPresentTime({ shift, date, today, nowMin }) {
  const start = shift ? toMin(shift.start) : null;
  if (start == null) return null;
  if (date === today && start > nowMin) return null;
  return minToHm(start);
}

/** "2h 0m" between two 'HH:MM' times (same day). */
export function durationText(inHm, outHm) {
  const a = toMin(inHm); const b = toMin(outHm);
  if (a == null || b == null || b < a) return '';
  const d = b - a;
  return `${Math.floor(d / 60)}h ${d % 60}m`;
}

/**
 * The reason rule as the database enforces it (trigger on therapist_attendance): any save on a day before today; or an existing record
 * whose status changes, or a time that already had a value changes. Filling an empty time and a fresh mark today need none.
 * existing / next: { status, checkIn, checkOut, offStart, offEnd } (existing null = no record yet).
 */
export function needsReason({ existing, next, date, today }) {
  if (date < today) return true;
  if (!existing) return false;
  if ((next.status || '') !== (existing.status || '')) return true;
  const changed = (a, b) => (a || null) !== (b || null);
  return (existing.checkIn && changed(next.checkIn, existing.checkIn))
    || (existing.checkOut && changed(next.checkOut, existing.checkOut))
    || (existing.offStart && changed(next.offStart, existing.offStart))
    || (existing.offEnd && changed(next.offEnd, existing.offEnd))
    || false;
}

/** Only the fields that differ from the saved record (unchanged times are never re-sent: the saved seconds stay as they are). */
export function diffPatch(existing, next) {
  const patch = {};
  const e = existing || {};
  ['status', 'checkIn', 'checkOut', 'offStart', 'offEnd', 'notes'].forEach((k) => {
    if (!(k in next)) return;
    if ((next[k] || null) !== (e[k] || null)) patch[k] = next[k] || null;
  });
  return patch;
}

const money = (n) => `NPR ${Math.round(n).toLocaleString('en-IN')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Pay effect of saving `status` for the date, with Payroll's rule: perDay = salary / days in month; deduction = perDay x (absent
 * days + 0.5 x half days + leave days over the calendar-year paid cap). Day Off / legacy Leave / Present are paid; late never changes pay.
 * ctx: { monthlySalary|null, daysInMonth, sickUsed, annualUsed, sickCap, annualCap } (used = days already taken this year, before this date).
 * Returns { text, deduction (NPR | null when the salary isn't readable), days (unpaid days this record adds) }.
 */
export function payEffect({ status, date, ctx, lateMin = 0 }) {
  if (!ctx || !status) return { text: '', deduction: 0, days: 0 };
  const salary = ctx.monthlySalary;
  const perDay = salary != null && ctx.daysInMonth > 0 ? salary / ctx.daysInMonth : null;
  const mon = MONTHS[Number(String(date).slice(5, 7)) - 1];
  const why = (what) => (perDay != null ? ` (${what}, NPR ${Math.round(salary).toLocaleString('en-IN')} ÷ ${ctx.daysInMonth} days in ${mon})` : '');
  const cost = (days) => (perDay != null ? money(perDay * days) : null);
  let text; let days = 0;
  if (status === 'Absent') {
    days = 1;
    text = `Absent deducts ${cost(1) || "1 day's pay"}${why("1 day's pay")}.`;
  } else if (isHalfDayStatus(status)) {
    days = 0.5;
    text = `Half day deducts ${cost(0.5) || "½ day's pay"}${why("½ of one day's pay")}.`;
  } else if (status === 'Sick Leave' || status === 'Annual Leave') {
    const sick = status === 'Sick Leave';
    const used = sick ? ctx.sickUsed : ctx.annualUsed;
    const cap = sick ? ctx.sickCap : ctx.annualCap;
    const name = sick ? 'Sick leave' : 'Annual leave';
    if (used + 1 > cap) {
      days = 1;
      text = `${name}: ${used} of ${cap} paid days already used this year, so this day is unpaid${cost(1) ? ` and deducts ${cost(1)}` : ''}.`;
    } else {
      const next = used + 2 > cap ? `unpaid${cost(1) ? ` (${cost(1)})` : ''}` : 'paid';
      text = `${name}: ${used} of ${cap} paid days used this year. This day is paid; the next one will be ${next}.`;
    }
  } else if (status === 'Day Off') {
    text = 'Day off is paid. No deduction.';
  } else {
    text = 'No deduction.';
  }
  if (lateMin > 0) text += ' Late doesn\'t change pay.';
  return { text, deduction: perDay != null ? perDay * days : null, days };
}

/**
 * Is the person away from this branch for their WHOLE shift on `date` (a temporary transfer out that covers shift start to end;
 * no shift = the whole day)? Partly away stays a normal row. transfer: { effectiveDate, startTime, revertAt, reverted, revertedAt }.
 */
export function awayWholeShift({ transfer, date, shift }) {
  if (!transfer || !transfer.revertAt) return false;
  const at = (d, hm) => new Date(`${d}T${String(hm).slice(0, 5)}:00+05:45`).getTime();
  const ws = at(transfer.effectiveDate, transfer.startTime || '00:00');
  let we = new Date(transfer.revertAt).getTime();
  if (transfer.reverted && transfer.revertedAt) we = Math.min(we, new Date(transfer.revertedAt).getTime());
  const s = at(date, shift?.start || '00:00');
  const e = at(date, shift?.end || '23:59');
  return ws <= s && we >= e;
}

/** A visitor's window clipped to the day and the receiving branch's opening hours: { start, end (HH:MM), allDay }. */
export function clipVisitWindow({ fromParts, toParts, date, openTime, closeTime }) {
  const open = toMin(openTime) ?? 0;
  const close = Math.min(toMin(closeTime) ?? 1440, 1439);
  const from = fromParts.date < date ? 0 : toMin(fromParts.hm);
  const to = toParts.date > date ? 1440 : toMin(toParts.hm);
  const start = Math.max(from, open);
  let end = Math.min(to, close);
  if (end <= start) end = close;
  return { start: minToHm(start), end: minToHm(end), allDay: from <= open && to >= close };
}

/**
 * The visit window (HH:MM, clipped to `date`) of a temporary transfer INTO `toBranchId` that overlaps `date`, from one person's
 * staff_transfers rows. Window end = min(revert_at, reverted_at, the next transfer's start), like the database's _staff_transfer_windows.
 * With several, prefers the one holding `checkIn`. null when none (callers then don't judge lateness).
 */
export function visitWindowOn({ transfers, toBranchId, date, checkIn = null }) {
  const at = (d, hm) => new Date(`${d}T${String(hm).slice(0, 5)}:00+05:45`).getTime();
  const list = (transfers || []).map((t) => ({ ...t, ws: at(t.effective_date, t.start_time || '00:00') })).sort((a, b) => a.ws - b.ws);
  const dayStart = at(date, '00:00'); const dayEnd = dayStart + 86400000;
  const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
  const found = [];
  list.forEach((t, i) => {
    if (t.is_return_leg || t.is_permanent || t.to_branch_id !== toBranchId) return;
    let we = t.revert_at ? new Date(t.revert_at).getTime() : Infinity;
    if (t.reverted && t.reverted_at) we = Math.min(we, new Date(t.reverted_at).getTime());
    if (list[i + 1]) we = Math.min(we, list[i + 1].ws);
    if (!(t.ws < dayEnd && we > dayStart)) return;
    found.push({ start: t.ws <= dayStart ? '00:00' : hm(t.ws), end: we >= dayEnd ? '23:59' : hm(we) });
  });
  if (!found.length) return null;
  const inMin = checkIn ? toMin(checkIn) : null;
  return (inMin != null && found.find((w) => inMin >= toMin(w.start) && inMin <= toMin(w.end))) || found[0];
}

/**
 * The day's punches seen from `branchId` (punch rows: { id, branchId, checkIn:'HH:MM', checkOut:'HH:MM'|null }):
 * first in, last out ('' while any punch is open), the open punch here / elsewhere, the punches at other branches, worked minutes.
 */
export function summarizePunches(punches, branchId) {
  const list = [...(punches || [])].sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));
  const open = list.filter((p) => !p.checkOut && p.source !== 'legacy');   // legacy lone check-ins are never "open"
  const legacyOpen = !open.length && list.some((p) => !p.checkOut && p.source === 'legacy');
  const outs = list.map((p) => p.checkOut).filter(Boolean).sort();
  const worked = list.reduce((n, p) => (p.checkOut ? n + Math.max(0, toMin(p.checkOut) - toMin(p.checkIn)) : n), 0);
  return {
    count: list.length,
    firstIn: list[0]?.checkIn || '',
    lastOut: open.length || !outs.length ? '' : outs[outs.length - 1],
    legacyOpen,
    openHere: open.find((p) => p.branchId === branchId) || null,
    openElsewhere: open.some((p) => p.branchId !== branchId),
    elsewhere: list.filter((p) => p.branchId !== branchId),
    workedMin: worked,
  };
}

/** 125 -> "2h 5m" */
export const minutesText = (n) => `${Math.floor(n / 60)}h ${n % 60}m`;
