// Pure view-model for the therapist inner page (ZNLY-170): the report row + the overview numbers in, bars / tiles / outcome lists / CSV out.
// Unit-tested; no React. Every number here comes from the same source as the report row (migration 339) so the page matches ZNLY-169.
import { computeDelta, addDays } from 'utils/reportPeriod';
import { durationText } from 'utils/durationText';
import { WEIGHTS } from '../Reports/therapistPerformanceView';
import { deriveRow } from 'services/attendanceView';

const ratio = (a, b) => (Number(b) > 0 ? Number(a) / Number(b) : null);
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (v) => `${Math.round(Number(v) * 100)}%`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso) => { const [, m, d] = String(iso).split('-').map(Number); return `${d} ${MON[m - 1]}`; };
export const dayRange = (from, to) => {
  const [, m1, d1] = from.split('-').map(Number); const [, m2, d2] = to.split('-').map(Number);
  if (from === to) return shortDate(from);
  return m1 === m2 ? `${d1}–${d2} ${MON[m2 - 1]}` : `${shortDate(from)}–${shortDate(to)}`;
};

/** The four score bars: value / max points, a sub-label, amber below half of the max, grey n/a (rest rescaled) when a part has no data. */
export function scoreBars(row, maxSales, { expectCheckIn = false } = {}) {
  const p = row.parts;
  const top = Number(maxSales) > 0 && Number(row.service_sales) >= Number(maxSales);
  const busyPct = row.busy == null ? null : pct(row.busy);
  const defs = [
    { key: 'sales', label: 'Sales', sub: top ? 'top earner' : `${pct(ratio(row.service_sales, maxSales) ?? 0)} of top earner` },
    { key: 'completion', label: 'Completion', sub: `${row.completed} of ${row.due} due` },
    { key: 'attendance', label: 'Attendance', sub: `present on ${row.att_present} of ${row.att_days}${expectCheckIn ? ' marked' : ''} days`, naText: 'n/a, not marked' },
    { key: 'busy', label: 'Busy', sub: `${busyPct} of rostered`, naText: 'n/a, no hours set' },
  ];
  return defs.map((d) => {
    const value = p[d.key];
    const max = WEIGHTS[d.key];
    if (value == null) return { ...d, value: null, max, share: 0, na: true, amber: false, sub: d.naText, note: 'rest rescaled' };
    return { ...d, value: r1(value), max, share: value / max, na: false, amber: value / max < 0.5 };
  });
}

/** The ✦ flag when completion costs the most points (max − earned) and bookings are not closed. Null otherwise. */
export function holdsBack(row, open) {
  if (!open || !open.count) return null;
  const parts = Object.keys(WEIGHTS).filter((k) => row.parts[k] != null).map((k) => ({ k, lost: WEIGHTS[k] - row.parts[k] }));
  if (!parts.length) return null;
  const worst = parts.reduce((a, b) => (b.lost > a.lost ? b : a));
  if (worst.k !== 'completion' || worst.lost <= 0) return null;
  return { count: open.count, from: open.firstDate, to: open.lastDate };
}

/** Booking outcomes from the booking lines. "Not closed" = Pending / Confirmed / In-Progress whose end time has passed (same rule as the API); the rest of them are "upcoming". */
export function outcomes(list, nowMs = Date.now()) {
  const c = { completed: 0, notClosed: 0, cancelled: 0, noShow: 0, upcoming: 0 };
  const open = [];
  const coming = [];
  for (const b of list) {
    if (b.status === 'Completed') c.completed += 1;
    else if (b.status === 'No Show') c.noShow += 1;
    else if (b.status === 'Cancelled') c.cancelled += 1;
    else if (b.endMs != null && b.endMs <= nowMs) { c.notClosed += 1; open.push(b); }
    else { c.upcoming += 1; coming.push(b); } // not ended yet: every booking is in exactly one bucket, so the buckets add up to total
  }
  const by = {};
  for (const b of open) by[b.status] = (by[b.status] || 0) + 1;
  const dates = open.map((b) => b.date).sort();
  return {
    ...c, total: list.length, open, coming, openByStatus: by,
    // One number for the open bookings, the Needs closing rule (bookingMoney.classifyBooking): at stake = price − payments on bookings dated before today.
    // value / paidAhead are the grey explanation: the bookings' own price (a combo is not split) and what is already paid on them.
    openValue: open.reduce((n, b) => n + (b.full ?? b.final), 0),
    openAtStake: open.reduce((n, b) => n + (b.atStake || 0), 0),
    openPaid: open.reduce((n, b) => n + (b.paidAmt || 0), 0),
    openInfo: { count: open.length, firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null },
  };
}

/** Whole-number percentages of `values` that add up to exactly 100 (largest remainder; ties go to the earlier row). All zeros when the total is 0. */
export function pctShares(values) {
  const total = values.reduce((n, v) => n + v, 0);
  if (!(total > 0)) return values.map(() => 0);
  const base = values.map((v) => Math.floor((v * 100) / total));
  const rem = values.map((v, i) => (v * 100) - base[i] * total);
  let left = 100 - base.reduce((n, v) => n + v, 0);
  [...values.keys()].sort((a, b) => rem[b] - rem[a] || a - b).forEach((i) => { if (left > 0) { base[i] += 1; left -= 1; } });
  return base;
}

/** Completed bookings grouped by service: done, sales, avg price, minutes (a combo counts its full length), whether any is still owed, share of sales
 *  (`pct` = whole % that adds up to 100). Rows add up to the service sales. */
export function servicesDelivered(list) {
  const m = new Map();
  for (const b of list) {
    if (b.status !== 'Completed') continue;
    const k = b.service || 'Service';
    const r = m.get(k) || { name: k, done: 0, sales: 0, minutes: 0, owed: false };
    r.done += 1; r.sales += b.final; r.minutes += b.minutes || 0; if (b.final - b.paid > 0) r.owed = true;
    m.set(k, r);
  }
  const rows = [...m.values()].sort((a, b) => b.sales - a.sales || b.done - a.done || a.name.localeCompare(b.name));
  const total = { done: rows.reduce((n, r) => n + r.done, 0), sales: rows.reduce((n, r) => n + r.sales, 0), minutes: rows.reduce((n, r) => n + r.minutes, 0) };
  const pcts = pctShares(rows.map((r) => r.sales));
  return { rows: rows.map((r, i) => ({ ...r, avg: r.done ? r.sales / r.done : 0, share: total.sales > 0 ? r.sales / total.sales : 0, pct: pcts[i] })), total };
}

const dateParts = (iso) => { const [, m, d] = String(iso).split('-').map(Number); return { m, d }; };

/** The not-closed bookings grouped by service: bookings, dates ("19, 22 Oct"; a booking with a note stands alone: "16 Oct (with Wangmo Q., paid)"),
 *  at stake. Biggest at stake first, then name. `total` = the Overview's openAtStake. */
export function notClosedByService(open) {
  const m = new Map();
  for (const b of [...open].sort((a, c) => (a.date + a.start).localeCompare(c.date + c.start))) {
    const k = b.service || 'Service';
    const r = m.get(k) || { name: k, bookings: 0, atStake: 0, items: [] };
    r.bookings += 1; r.atStake += b.atStake || 0;
    const notes = [];
    if (b.others && b.others.length) notes.push(`with ${b.others.join(' and ')}`);
    if (!(b.atStake > 0) && b.paidAmt > 0) notes.push('paid');
    if (b.status === 'Pending') notes.push('Pending');
    r.items.push({ date: b.date, notes });
    m.set(k, r);
  }
  const rows = [...m.values()].map((r) => {
    const tokens = [];
    for (const it of r.items) {
      const { m: mon, d } = dateParts(it.date);
      const last = tokens[tokens.length - 1];
      if (it.notes.length) tokens.push({ mon, text: `${shortDate(it.date)} (${it.notes.join(', ')})`, plain: false });
      else if (last && last.plain && last.mon === mon) { last.days.push(d); last.text = `${last.days.join(', ')} ${MON[mon - 1]}`; }
      else tokens.push({ mon, days: [d], text: `${d} ${MON[mon - 1]}`, plain: true });
    }
    return { name: r.name, bookings: r.bookings, atStake: r.atStake, dates: tokens.map((t) => t.text).join(' · ') };
  }).sort((a, b) => b.atStake - a.atStake || a.name.localeCompare(b.name));
  return { rows, total: rows.reduce((n, r) => n + r.atStake, 0), bookings: rows.reduce((n, r) => n + r.bookings, 0) };
}

/** Cancelled and no-show bookings, one line each, oldest first. No money. kind = 'cancelled' | 'noShow'. */
export const didntHappen = (list) => list
  .filter((b) => b.status === 'Cancelled' || b.status === 'No Show')
  .map((b) => ({ service: b.service || 'Service', date: b.date, start: b.start, kind: b.status === 'No Show' ? 'noShow' : 'cancelled' }))
  .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

/** One CSV row per line of what the Services tab shows: section, service, done or bookings, avg price, hours, sales or at stake, dates. */
export function servicesCsvRows(list, nowMs = Date.now()) {
  const out = outcomes(list, nowMs);
  const svc = servicesDelivered(list);
  const nc = notClosedByService(out.open);
  const line = (b) => `${shortDate(b.date)} ${b.start}`;
  return [
    ['Section', 'Service', 'Done / bookings', 'Avg price', 'Minutes', 'Sales / at stake', 'Dates'],
    ...svc.rows.map((r) => ['Services delivered', r.name, r.done, Math.round(r.avg), r.minutes, r.sales, '']),
    ...nc.rows.map((r) => ['Not closed yet', r.name, r.bookings, '', '', r.atStake, r.dates]),
    ...didntHappen(list).map((b) => [b.kind === 'noShow' ? 'No-show' : 'Cancelled', b.service, 1, '', '', '', line(b)]),
    ...[...out.coming].map((b) => ['Coming up', b.service || 'Service', 1, '', '', '', line(b)]),
  ];
}

/** Sales-by-week bar labels: every week as its range, cut by the period ("1–4 Oct", "5–11 Oct", "26–30 Oct"). */
export function weekLabels(weeks, from, to) {
  return (weeks || []).map((w) => {
    const end = addDays(w, 6);
    return dayRange(w < from ? from : w, end > to ? to : end); // the whole week, cut by the period
  });
}

/** Four tiles. `team` = the report's team block (current), `prevRow` = this person's row in the previous period (null = no bookings there). */
export function kpiTiles(row, team, prevRow, data, staffWord = 'therapist') {
  const hasPrev = !!prevRow && Number(prevRow.bookings) > 0;
  const teamPerHead = Number(team?.active) > 0 ? Number(team.service_sales) / Number(team.active) : null;
  const mark = (mine, avg) => (mine == null || avg == null ? null : { mine, avg, good: mine >= avg });
  const prevComp = hasPrev ? ratio(prevRow.completed, prevRow.due) : null;
  return [
    { key: 'sales', label: 'Service sales', value: Number(row.service_sales), delta: hasPrev ? computeDelta(row.service_sales, prevRow.service_sales) : null,
      line: `paid ${Number(data.paidRevenue).toLocaleString('en-IN')} · owed ${Number(data.owed).toLocaleString('en-IN')}`, marker: mark(Number(row.service_sales), teamPerHead), markerText: teamPerHead == null ? '' : `avg per ${staffWord} (${team.active}) ${Math.round(teamPerHead).toLocaleString('en-IN')}` },
    { key: 'completed', label: 'Completed', value: row.completed, sub: `of ${row.due} due · ${ratio(row.completed, row.due) == null ? '—' : pct(ratio(row.completed, row.due))}`,
      delta: hasPrev ? computeDelta(ratio(row.completed, row.due), prevComp, { unit: 'pts' }) : null,
      line: `${data.statusSplit.noShow} no-show${data.statusSplit.noShow === 1 ? '' : 's'} · ${data.statusSplit.cancelled} cancelled · ${data.statusSplit.notClosed} not closed`,
      foot: `avg ticket ${row.avg_ticket == null ? '—' : Math.round(row.avg_ticket).toLocaleString('en-IN')} · team ${team?.avg_ticket == null ? '—' : Math.round(team.avg_ticket).toLocaleString('en-IN')}` },
    { key: 'busy', label: 'Busy', value: row.busy == null ? 'No hours set' : pct(row.busy), sub: row.busy == null ? '' : `· ${durationText(row.booked_min)} of ${durationText(row.working_min)}`,
      delta: hasPrev && row.busy != null ? computeDelta(row.busy, prevRow.busy, { unit: 'pts' }) : null,
      line: 'booked time ÷ rostered hours (same rule as the report)', marker: mark(row.busy, team?.busy), markerText: team?.busy == null ? '' : `team ${Math.round(team.busy * 1000) / 10}%`, markerLabel: row.busy == null ? '' : `you ${pct(row.busy)}` },
    { key: 'rebook', label: 'Rebook', value: row.rebook_rate == null ? '—' : pct(row.rebook_rate), sub: row.rebook_rate == null ? `· ${row.customers} customer${row.customers === 1 ? '' : 's'} (needs 5)` : `· ${row.rebooked} of ${row.customers} customers`,
      delta: hasPrev && row.rebook_rate != null ? computeDelta(row.rebook_rate, prevRow.rebook_rate, { unit: 'pts' }) : null,
      line: 'booked again within 60 days (any therapist)', marker: mark(row.rebook_rate, team?.rebook_rate), markerText: team?.rebook_rate == null ? '' : `team ${pct(team.rebook_rate)}`, markerLabel: row.rebook_rate == null ? '' : `you ${pct(row.rebook_rate)}` },
  ];
}

/** "No change vs 1–30 Sep shown: …" when the previous period has nothing to compare with. */
export const noPrevLine = (prevRow, prevRange, firstName) =>
  (!prevRow || Number(prevRow.bookings) === 0)
    ? `No change vs ${dayRange(prevRange.from, prevRange.to)} shown: ${firstName} had no bookings in that period (we never show a made-up %).` : null;

/** The "Clocked in" note: "on 1 day with clock times (26 Oct); 27 Oct present, no clock times". `att` = attendanceDays() output. */
export function clockedNote(att) {
  const t = att?.totals;
  if (!t || (!t.clockDays && !t.noTimeDates.length)) return 'no attendance marked';
  const list = (dates) => (dates.length > 4 ? null : dates.map(shortDate).join(', '));
  const parts = [];
  if (t.clockDays) { const l = list(t.clockDates.map((c) => c.date)); parts.push(`on ${t.clockDays} day${t.clockDays === 1 ? '' : 's'} with clock times${l ? ` (${l})` : ''}`); }
  if (t.noTimeDates.length) { const l = list(t.noTimeDates); parts.push(l ? `${l} present, no clock times` : `${t.noTimeDates.length} present days without clock times`); }
  return parts.join('; ');
}

/** ✦ when attendance is marked on under a quarter of the rostered days. `rosteredDays` = the real count of rostered days (attendanceDays). */
export function attendanceFlag(attDays, rosteredDays) {
  if (attDays === 0 || !(rosteredDays > 0) || attDays / rosteredDays >= 0.25) return null; // none marked: the n/a bar already says so
  return `Attendance is marked on only ${attDays} day${attDays === 1 ? '' : 's'} this period, so the attendance score and clocked-in figures rest on little data.`;
}

/** Rank among the cohort: { rank, of }. Rows come from buildRows (already ranked). */
export const rankOf = (rows, id) => { const r = rows.find((x) => x.id === id); return r ? { rank: r.rank, of: rows.length } : null; };

export const CSV_HEAD = ['Date', 'Start', 'Customer', 'Service', 'Status', 'Final', 'Paid', 'Owed'];
/** One row per booking in the period. Owed = final − paid on Completed bookings only. */
export const csvRows = (list) => [CSV_HEAD, ...list.map((b) => [b.date, b.start, b.customer, b.service, b.status, b.final, b.paid, b.status === 'Completed' ? Math.max(0, b.final - b.paid) : 0])];

// ---- Attendance (ZNLY-172 V37g) -------------------------------------------------------------------------------------------------------------
// ONE helper turns the therapist's roster (therapist_shifts_for_range rows) + attendance rows into a day-by-day list and the totals. The Overview's
// Clocked in / Busy lines, the tab badge and the Attendance tab all read this output, so they cannot disagree. Never assumes a time: Worked exists
// only when BOTH clock times exist. Every minute figure is a whole number; the UI formats with durationText.
export const DEFAULT_GRACE_MINUTES = 10; // only when a branch value is missing; the branch's late_grace_minutes is what the tab uses
const NPT_OFFSET_MIN = 345; // Nepal is UTC+5:45 all year
const EXCUSED = ['Leave', 'Annual Leave', 'Sick Leave', 'Day Off'];
const secToMin = (t) => { if (t == null) return null; const [h, m, sec] = String(t).split(':').map(Number); return Math.round((h * 3600 + (m || 0) * 60 + (sec || 0)) / 60); };
const isoMs = (iso) => { const ms = iso ? Date.parse(iso) : NaN; return Number.isNaN(ms) ? null : ms; };
const nepalMin = (ms) => (ms == null ? null : ((Math.floor(ms / 60000) + NPT_OFFSET_MIN) % 1440 + 1440) % 1440);
const hhmm = (min) => (min == null ? null : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
const nepalDate = (ms) => new Date(ms + NPT_OFFSET_MIN * 60000).toISOString().slice(0, 10);
const rangeMin = (arr) => (Array.isArray(arr) ? arr : []).reduce((sum, y) => sum + (Number(y.end_min) - Number(y.start_min) || 0), 0);

/** Net shift minutes = end − start − breaks − off (the same formula as migration 339's `wrk`). */
export function netShiftMinutes(s) {
  if (!s || !s.works || !s.start_time || !s.end_time || s.source === 'none') return 0;
  return Math.max(0, secToMin(s.end_time) - secToMin(s.start_time) - rangeMin(s.breaks) - rangeMin(s.off));
}

/** "1–4, 7–25 and 28–30 Oct" from sorted ISO dates (calendar-adjacent days join into one range). */
export function rangesText(dates) {
  const ranges = [];
  for (const d of dates) {
    const last = ranges[ranges.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d; else ranges.push([d, d]);
  }
  const month = (iso) => iso.slice(0, 7);
  const same = ranges.length > 0 && ranges.every(([a, b]) => month(a) === month(ranges[0][0]) && month(b) === month(ranges[0][0]));
  const bit = ([a, b]) => (same ? (a === b ? `${Number(a.slice(8))}` : `${Number(a.slice(8))}–${Number(b.slice(8))}`) : dayRange(a, b));
  const parts = ranges.map(bit);
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] || '');
  return same ? `${joined} ${MON[Number(month(ranges[0][0]).slice(5)) - 1]}` : joined;
}

export function attendanceDays({ shifts = [], rows = [], from, to, now = Date.now(), branchHours = null, settings = {} }) {
  const today = nepalDate(now);
  const expectCheckIn = !!settings.expectCheckIn; // branches.expect_check_in (default false): OFF = a rostered day with no record counts as present
  const grace = settings.lateGraceMinutes ?? DEFAULT_GRACE_MINUTES;
  const shiftBy = {}; for (const s of shifts) shiftBy[s.shift_date] = s;
  const rowBy = {}; for (const r of rows) if (!rowBy[r.date]) rowBy[r.date] = r;
  const bOpen = branchHours ? secToMin(branchHours.open) : null;
  const bClose = branchHours ? secToMin(branchHours.close) : null;
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const s = shiftBy[date]; const r = rowBy[date];
    const net = netShiftMinutes(s);
    const rostered = net > 0;
    const offLabel = (s?.off || []).map((y) => y.label || y.reason).find(Boolean);
    const day = { date, rostered, rosteredMin: net, shiftStart: rostered ? secToMin(s.start_time) : null, shiftEnd: rostered ? secToMin(s.end_time) : null, reason: rostered ? null : (offLabel || 'no shift'),
      kind: 'notRostered', label: 'Not rostered', marked: !!r, checkIn: null, checkOut: null, workedMin: null, lateMin: null, earlyMin: null, longerMin: null,
      branchHoursUsed: false, half: null, workedAt: r && r.worked_at_branch_id && r.worked_at_branch_id !== r.branch_id ? (r.worked_at?.name || 'another branch') : null, rawStatus: r?.status || null };
    if (r) {
      const inMs = isoMs(r.check_in_time); const outMs = isoMs(r.check_out_time);
      const inMin = nepalMin(inMs); const outMin = nepalMin(outMs);
      day.checkIn = hhmm(inMin); day.checkOut = hhmm(outMin);
      if (inMs != null && outMs != null) { day.workedMin = Math.max(0, Math.round((outMs - inMs) / 60000)); day.inMs = inMs; day.outMs = outMs; }
      const half = r.status === '1st-Half Day' ? 'morning' : r.status === '2nd-Half Day' ? 'afternoon' : null;
      if (half) { day.kind = 'half'; day.label = 'Half day'; day.half = half; }
      else if (r.status === 'Present') { day.kind = rostered ? 'present' : 'extra'; day.label = rostered ? 'Present' : 'Extra day'; }
      else if (r.status === 'Absent') { day.kind = 'absent'; day.label = 'Absent'; }
      else if (EXCUSED.includes(r.status)) { day.kind = 'leave'; day.label = r.status; }
      else { day.kind = 'other'; day.label = r.status || 'Marked'; }
      if (day.kind === 'present' || day.kind === 'extra') {
        const ws = rostered ? day.shiftStart : bOpen; const we = rostered ? day.shiftEnd : bClose;
        day.branchHoursUsed = !rostered;
        if (ws != null && inMin != null && inMin > ws + grace) day.lateMin = inMin - ws;
        if (we != null && outMin != null && outMin < we - grace) day.earlyMin = we - outMin;
        if (we != null && outMin != null && outMin > we + grace) day.longerMin = outMin - we;
      }
    } else if (rostered) {
      if (date > today) { day.kind = 'future'; day.label = ''; }
      else if (date === today) { day.kind = 'today'; day.label = 'Not marked yet'; }
      else {
        // Same rule as the Attendance page (attendanceView.deriveRow): switch OFF = present by default, ON = Not marked (unknown).
        const k = deriveRow({ person: {}, date, today, nowMin: null, shift: { start: hhmm(day.shiftStart), end: hhmm(day.shiftEnd) }, settings: { expectCheckIn, lateGraceMinutes: grace } }).kind;
        if (k === 'present_default') { day.kind = 'noCheckin'; day.label = 'No check-in'; }
        else { day.kind = 'notMarked'; day.label = 'Not marked'; }
      }
    }
    days.push(day);
  }
  const rostered = days.filter((d) => d.rostered);
  const clock = days.filter((d) => d.workedMin != null);
  const notMarked = days.filter((d) => d.kind === 'notMarked').map((d) => d.date);
  const noCheckin = days.filter((d) => d.kind === 'noCheckin').map((d) => d.date);
  // A rostered day counts for attendance only once it has happened: up to yesterday, plus today when it is marked. So marked + not marked = this.
  const sofar = rostered.filter((d) => d.date < today || (d.date === today && d.marked));
  const totals = {
    rosteredDays: rostered.length,
    rosteredSoFar: sofar.length,
    includesToday: today >= from && today <= to,
    rosteredMin: rostered.reduce((a, d) => a + d.rosteredMin, 0),
    markedDays: days.filter((d) => d.marked).length,
    markedRostered: sofar.filter((d) => d.marked).length,
    extraDays: days.filter((d) => d.kind === 'extra').length,
    clockedMin: clock.reduce((a, d) => a + d.workedMin, 0),
    clockDays: clock.length,
    clockDates: clock.map((d) => ({ date: d.date, min: d.workedMin, rosteredMin: d.rosteredMin, inMs: d.inMs, outMs: d.outMs })),
    onTime: clock.filter((d) => !d.lateMin && !d.earlyMin).length,
    notMarked: notMarked.length,
    notMarkedText: rangesText(notMarked),
    noCheckin: noCheckin.length,
    noCheckinDates: noCheckin,
    noCheckinText: rangesText(noCheckin),
    // Known days = marked rostered days + (switch OFF) the no-check-in days; Attendance % = presentDays ÷ knownDays everywhere (mig 341 = same rule).
    knownDays: sofar.filter((d) => d.marked).length + noCheckin.length,
    presentDays: sofar.filter((d) => d.kind === 'present' || d.kind === 'half').length + noCheckin.length,
    markedPresent: sofar.filter((d) => d.kind === 'present' || d.kind === 'half').length,
    expectCheckIn,
    graceMinutes: grace,
    todayUnmarked: days.some((d) => d.kind === 'today'),
    noTimeDates: days.filter((d) => (d.kind === 'present' || d.kind === 'extra' || d.kind === 'half') && d.workedMin == null).map((d) => d.date),
  };
  return { days, totals };
}

/** Busy minutes inside the clock-in spans: for each Completed booking, the overlap of its start–end with a clocked span (whole minutes). */
export function busyMinutesInSpans(bookings, clockDates) {
  let ms = 0;
  for (const b of bookings) {
    if (b.status !== 'Completed') continue;
    const bs = Date.parse(b.start_datetime); const be = Date.parse(b.end_datetime);
    if (Number.isNaN(bs) || Number.isNaN(be)) continue;
    for (const c of clockDates) ms += Math.max(0, Math.min(be, c.outMs) - Math.max(bs, c.inMs));
  }
  return Math.round(ms / 60000);
}

/** The "What happened" chips + a plain note for one marked day. tone: ok | warn | blue | plain. */
export function dayChips(d) {
  const chips = []; const notes = [];
  if (d.kind === 'half') chips.push({ text: `Half day, ${d.half}`, tone: 'warn' });
  else if (d.kind === 'absent') chips.push({ text: 'Absent', tone: 'warn' });
  else if (d.kind === 'leave' || d.kind === 'other') chips.push({ text: d.label, tone: d.kind === 'leave' ? 'blue' : 'plain' });
  else {
    if (d.lateMin) chips.push({ text: `Late ${durationText(d.lateMin)}`, tone: 'warn' });
    if (d.earlyMin) chips.push({ text: `Left ${durationText(d.earlyMin)} early`, tone: 'warn' });
    if (d.longerMin) chips.push({ text: `Stayed ${durationText(d.longerMin)} longer`, tone: 'plain' });
    if (!chips.length && d.workedMin != null) chips.push({ text: d.kind === 'extra' ? 'Extra day' : 'On time', tone: d.kind === 'extra' ? 'blue' : 'ok' });
    else if (!chips.length) chips.push({ text: d.kind === 'extra' ? 'Extra day' : 'Present', tone: d.kind === 'extra' ? 'blue' : 'ok' });
  }
  if (d.kind === 'present' || d.kind === 'extra' || d.kind === 'half') {
    if (!d.checkIn && !d.checkOut) notes.push('no clock times recorded');
    else if (!d.checkOut) notes.push('no check-out recorded');
    else if (!d.checkIn) notes.push('no check-in recorded');
  }
  if (d.branchHoursUsed) notes.push('no roster, branch hours used');
  return { chips, note: notes.join(' · ') };
}

/** One CSV row per day of the period (the Attendance tab's export). */
export const ATT_CSV_HEAD = ['Date', 'Status', 'Shift start', 'Shift end', 'Rostered minutes', 'In', 'Out', 'Worked minutes', 'Late minutes', 'Left early minutes', 'Note'];
export function attendanceCsvRows(att) {
  const body = att.days.map((d) => {
    const { note } = dayChips(d);
    const extra = d.kind === 'notRostered' ? d.reason : d.kind === 'today' ? 'today, not marked yet' : d.kind === 'future' ? 'upcoming' : note;
    const status = d.kind === 'today' ? 'Not marked yet' : d.kind === 'future' ? 'Upcoming' : d.label;
    return [d.date, status, hhmm(d.shiftStart) ?? '', hhmm(d.shiftEnd) ?? '', d.rosteredMin, d.checkIn ?? '', d.checkOut ?? '', d.workedMin ?? '', d.lateMin ?? '', d.earlyMin ?? '', (d.kind === 'noCheckin' ? 'counted present, no check-in' : extra) || ''];
  });
  return [ATT_CSV_HEAD, ...body];
}
export const hhmmOf = hhmm;
