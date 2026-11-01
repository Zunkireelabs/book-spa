// Pure view-model for the therapist inner page (ZNLY-170): the report row + the overview numbers in, bars / tiles / outcome lists / CSV out.
// Unit-tested; no React. Every number here comes from the same source as the report row (migration 339) so the page matches ZNLY-169.
import { computeDelta, addDays } from 'utils/reportPeriod';
import { durationText } from 'utils/durationText';
import { WEIGHTS } from '../Reports/therapistPerformanceView';

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
export function scoreBars(row, maxSales) {
  const p = row.parts;
  const top = Number(maxSales) > 0 && Number(row.service_sales) >= Number(maxSales);
  const busyPct = row.busy == null ? null : pct(row.busy);
  const defs = [
    { key: 'sales', label: 'Sales', sub: top ? 'top earner' : `${pct(ratio(row.service_sales, maxSales) ?? 0)} of top earner` },
    { key: 'completion', label: 'Completion', sub: `${row.completed} of ${row.due} due` },
    { key: 'attendance', label: 'Attendance', sub: `${row.att_present} of ${row.att_days} marked`, naText: 'n/a, not marked' },
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

/** The "Clocked in" note: "attendance marked on 26 Oct (1.5 h) and 27 Oct (no times, 12 h assumed)". */
export function clockedNote(days) {
  if (!days.length) return 'no attendance marked';
  const bit = (d) => (d.assumed ? `${shortDate(d.date)} (no times, ${durationText(d.hours * 60)} assumed)` : `${shortDate(d.date)} (${durationText(d.hours * 60)})`);
  const parts = [...days].sort((a, b) => a.date.localeCompare(b.date)).map(bit);
  return `attendance marked on ${parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ')}`;
}

/** ✦ when attendance is marked on under a quarter of the rostered days. `rosteredDays` is estimated from rostered hours ÷ branch hours per day. */
export function attendanceFlag(attDays, rosteredDays) {
  if (attDays === 0 || !(rosteredDays > 0) || attDays / rosteredDays >= 0.25) return null; // none marked: the n/a bar already says so
  return `Attendance is marked on only ${attDays} day${attDays === 1 ? '' : 's'} this period, so the attendance score and clocked-in figures rest on little data.`;
}

/** Rank among the cohort: { rank, of }. Rows come from buildRows (already ranked). */
export const rankOf = (rows, id) => { const r = rows.find((x) => x.id === id); return r ? { rank: r.rank, of: rows.length } : null; };

export const CSV_HEAD = ['Date', 'Start', 'Customer', 'Service', 'Status', 'Final', 'Paid', 'Owed'];
/** One row per booking in the period. Owed = final − paid on Completed bookings only. */
export const csvRows = (list) => [CSV_HEAD, ...list.map((b) => [b.date, b.start, b.customer, b.service, b.status, b.final, b.paid, b.status === 'Completed' ? Math.max(0, b.final - b.paid) : 0])];
