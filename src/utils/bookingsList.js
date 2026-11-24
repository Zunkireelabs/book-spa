// Pure helpers for the Bookings list (V15): date ranges, view-chip classification, row signals (late / now line / dimming),
// search, sorting and day grouping. Everything takes the spa's local (Nepal) `today` / `nowHM` explicitly — never the browser clock.
import { visitMembers } from './visit';
import { futureBookingMessage } from '../services/bookingTransformers';
import { classifyBooking } from './bookingMoney';
import { phoneSearchDigits } from './customerDirectory';
import { teamMemberWord } from './industryTerms';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parts = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};
const pad = (n) => String(n).padStart(2, '0');
export const addDays = (iso, n) => {
  const { y, m, d } = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const addMonths = (iso, n) => {
  const { y, m } = parts(iso);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
};
const utcDay = (iso) => { const p = parts(iso); return Date.UTC(p.y, p.m - 1, p.d); };
export const dayDiff = (a, b) => Math.round((utcDay(b) - utcDay(a)) / 86400000);

// ── Date ranges ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const RANGE_MODES = ['day', 'week', 'month', 'custom'];

/** @returns {{mode, from, to}}  day = one date, week = "Next 7 days" from the anchor, month = the anchor's calendar month, custom = from..to. */
export function makeRange(mode, anchor, custom = {}) {
  if (mode === 'week') return { mode, from: anchor, to: addDays(anchor, 6) };
  if (mode === 'month') {
    const { y, m } = parts(anchor);
    return { mode, from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
  }
  if (mode === 'custom') {
    const from = custom.from || anchor;
    const to = custom.to || from;
    return from <= to ? { mode, from, to } : { mode, from: to, to: from };
  }
  return { mode: 'day', from: anchor, to: anchor };
}

/** ‹ › : step by the active range unit (a day, 7 days, a month, or the custom span's length). */
export function stepRange(range, dir) {
  if (range.mode === 'week') return makeRange('week', addDays(range.from, 7 * dir));
  if (range.mode === 'month') return makeRange('month', addMonths(range.from, dir));
  if (range.mode === 'custom') {
    const span = dayDiff(range.from, range.to) + 1;
    return { mode: 'custom', from: addDays(range.from, span * dir), to: addDays(range.to, span * dir) };
  }
  return makeRange('day', addDays(range.from, dir));
}

export const shortDay = (iso) => { const p = parts(iso); return `${DOW[p.dow]} ${p.d} ${MON[p.m - 1]}`; };
const dayMon = (iso) => { const p = parts(iso); return `${p.d} ${MON[p.m - 1]}`; };

/** "Today · Thu 15 Oct", "Tomorrow · Fri 16 Oct", "Next 7 days · 15 – 21 Oct", "October 2026", "5 Oct – 12 Oct". */
export function rangeLabel(range, today) {
  if (range.mode === 'day') {
    const rel = range.from === today ? 'Today · ' : range.from === addDays(today, 1) ? 'Tomorrow · ' : range.from === addDays(today, -1) ? 'Yesterday · ' : '';
    return `${rel}${shortDay(range.from)}`;
  }
  if (range.mode === 'week') return `Next 7 days · ${dayMon(range.from)} – ${dayMon(range.to)}`;
  if (range.mode === 'month') { const p = parts(range.from); return `${MON_LONG[p.m - 1]} ${p.y}`; }
  return `${dayMon(range.from)} – ${dayMon(range.to)}`;
}

/** Day-group heading: "Tomorrow · Fri 16 Oct". */
export function dayHeading(iso, today) {
  const rel = iso === today ? 'Today' : iso === addDays(today, 1) ? 'Tomorrow' : iso === addDays(today, -1) ? 'Yesterday' : null;
  return rel ? `${rel} · ${shortDay(iso)}` : shortDay(iso);
}

// ── Time ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const toMinutes = (t) => { if (!t) return null; const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };
const dbStatus = (b) => {
  const s = String(b?.status || '').toLowerCase();
  return s === 'in-progress' ? 'In-Progress' : s === 'no show' ? 'No Show' : s.charAt(0).toUpperCase() + s.slice(1);
};
const startOf = (b) => b?.time || String(b?.startTime || b?.start_time || '').slice(0, 5);
const dateOf = (b) => String(b?.date || '').slice(0, 10);

/** Clock text for the Now pill: "1:52pm". */
export const clockLabel = (hm) => {
  const m = toMinutes(hm);
  if (m == null) return '';
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m % 60)}${h >= 12 ? 'pm' : 'am'}`;
};

// ── Row signals ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Minutes a Pending/Confirmed booking of TODAY is past its start time without being started; null otherwise. */
export function lateMinutes(b, { today, nowHM }) {
  const s = dbStatus(b);
  if (s !== 'Pending' && s !== 'Confirmed') return null;
  if (dateOf(b) !== today) return null;
  const start = toMinutes(startOf(b));
  const now = toMinutes(nowHM);
  if (start == null || now == null || start >= now) return null;
  return now - start;
}

/** 82 → "1h 22m", 60 → "1h", 22 → "22m". */
export function formatLate(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

const FINISHED = ['Completed', 'Cancelled', 'No Show'];
export const isFinished = (b) => FINISHED.includes(dbStatus(b));

/** Finished rows from before now fade out. Pending/Confirmed rows whose time passed are late, never dimmed. */
export function isDimmed(b, { today, nowHM }) {
  if (!isFinished(b)) return false;
  const d = dateOf(b);
  if (d < today) return true;
  if (d > today) return false;
  const start = toMinutes(startOf(b));
  return start != null && start < toMinutes(nowHM);
}

/** Index in `rows` (already time-sorted, one day) before which the Now line goes: the first row starting after now. */
export function nowLineIndex(rows, nowHM) {
  const now = toMinutes(nowHM);
  const i = rows.findIndex((b) => { const s = toMinutes(startOf(b)); return s != null && s > now; });
  return i === -1 ? rows.length : i;
}

// ── View chips ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'done', label: 'Done', color: '#22C55E' },
  { id: 'spa', label: 'In service now', color: '#6366F1' },
  { id: 'come', label: 'To come', color: '#3B82F6' },
  { id: 'walkin', label: 'Walk-in', color: '#D97706' }, // ZNLY-327: warning amber
  { id: 'unpaid', label: 'Unpaid', color: '#F59E0B' },
  { id: 'void', label: 'Cancelled & no-show', color: '#DC2626' },
];

/** Does the booking belong to a view chip? Chips are not exclusive (a Completed visit with a balance is Done and Unpaid). */
export function inView(b, view, ctx) {
  const s = dbStatus(b);
  switch (view) {
    case 'done': return s === 'Completed';
    case 'spa': return s === 'In-Progress';
    case 'come': return (s === 'Pending' || s === 'Confirmed') && dateOf(b) >= ctx.today && lateMinutes(b, ctx) == null;
    case 'walkin': return !!b.isWalkIn;
    case 'unpaid': return moneyOf(b, ctx).due > 0;
    case 'void': return s === 'Cancelled' || s === 'No Show';
    default: return true;
  }
}

export const viewCounts = (rows, ctx) => Object.fromEntries(VIEWS.map((v) => [v.id, v.id === 'all' ? rows.length : rows.filter((b) => inView(b, v.id, ctx)).length]));

/** The shape bookingMoney expects, from a transformed list row (status is the lowercase UI value). */
export function moneyOf(b, { today }) {
  return classifyBooking({
    id: b.bookingId,
    date: b.date,
    status: dbStatus(b),
    final_amount: b.finalAmount,
    payments: b.payments,
    payment_refunds: b.refunds,
  }, { today });
}

/** What the Amount column shows. */
export function amountCell(b, ctx) {
  if (ctx.hidePrices) return { tone: 'void', text: '—' }; // ZNLY-235: a login that cannot see prices gets no amount
  const m = moneyOf(b, ctx);
  if (m.kind === 'void') return { tone: 'void', text: '—' };
  if (m.kind === 'rendered') return m.due > 0 ? { tone: 'due', amount: m.due } : { tone: 'paid', text: 'Paid' };
  if (m.kind === 'scheduled' || m.kind === 'unclosed') {
    if (m.deposit > 0 && m.kind === 'scheduled') return m.upcoming === 0 ? { tone: 'paid', text: 'Paid' } : { tone: 'deposit', amount: m.deposit };
    return { tone: 'price', amount: m.price };
  }
  return { tone: 'void', text: '—' };
}

// ── Next action ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One outline mini button per status; null on terminal / locked rows and for read-only roles. */
export function nextAction(b, { readOnly = false } = {}) {
  if (readOnly || b.isLocked) return null;
  const s = dbStatus(b);
  const assigned = (b.therapists && b.therapists.length > 0) || !!b.therapist;
  if (s === 'Pending') return assigned ? { id: 'confirm', label: 'Confirm', to: 'confirmed' } : { id: 'assign', label: 'Assign' };
  // ZNLY-275: a later-day booking can't be started or completed; `blocked` carries the sentence (button disabled, same text as its title).
  if (s === 'Confirmed') return assigned ? { id: 'start', label: 'Start', to: 'in-progress', blocked: futureBookingMessage(b.date, 'start') || undefined } : { id: 'assign', label: 'Assign' };
  if (s === 'In-Progress') return { id: 'complete', label: 'Complete', to: 'completed', blocked: futureBookingMessage(b.date, 'complete') || undefined };
  return null;
}

// ── Search / filter / sort / group ──────────────────────────────────────────────────────────────────────────────────────
/** Name, booking number or phone (spaces, dashes, +977 and a leading 0 are ignored). */
export function matchesBookingSearch(b, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (String(b.customerName || '').toLowerCase().includes(q)) return true;
  if (String(b.id || '').toLowerCase().includes(q)) return true;
  if (/^[\d\s+\-()]+$/.test(q)) {
    const qd = phoneSearchDigits(q);
    if (qd) return phoneSearchDigits(b.customerPhone).includes(qd);
  }
  return false;
}

export function matchesFilters(b, { therapist, service, room }) {
  if (therapist && !(b.therapists || []).some((t) => t.id === therapist) && b.therapist?.id !== therapist) return false;
  if (service && b.serviceId !== service) return false;
  if (room && b.roomId !== room && !(b.therapists || []).some((t) => t.roomId === room)) return false;
  return true;
}

export const SORTS = {
  time: { label: 'Time' },
  customer: { label: 'Customer' },
  therapist: { get label() { return teamMemberWord(); } },
  amount: { label: 'Amount' },
};

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byTime = (a, b) => cmp(dateOf(a), dateOf(b)) || cmp(startOf(a), startOf(b)) || cmp(String(a.id), String(b.id));

/** Always by date first (so day groups stay contiguous), then by `key`, then by time. */
export function sortBookings(rows, key = 'time', ctx = { today: '' }) {
  const out = [...rows];
  const th = (b) => (b.therapists?.[0]?.name || b.therapist?.name || '￿').toLowerCase();
  const amt = (b) => (b.finalAmount ?? 0);
  out.sort((a, b) => {
    const d = cmp(dateOf(a), dateOf(b));
    if (d) return d;
    if (key === 'customer') return cmp(String(a.customerName || '').toLowerCase(), String(b.customerName || '').toLowerCase()) || byTime(a, b);
    if (key === 'therapist') return cmp(th(a), th(b)) || byTime(a, b);
    if (key === 'amount') return (amt(b) - amt(a)) || byTime(a, b);
    return byTime(a, b);
  });
  return out;
}

/** [{ date, rows }] in date order (rows keep their given order). */
export function groupByDay(rows) {
  const groups = [];
  for (const b of rows) {
    const d = dateOf(b);
    const last = groups[groups.length - 1];
    if (last && last.date === d) last.rows.push(b); else groups.push({ date: d, rows: [b] });
  }
  return groups;
}

/** ZNLY-402: number of bookings in this booking's VISIT (visit_id; no visit_id = its own visit = 1). The row label "N services" shows when > 1. */
export const visitCount = (b, all) => visitMembers(all, b).length;

/** Party size (booking_group_id: a group booking of several people). Not a visit: kept for the "Group of N" label. */
export const groupInfo = (b, all) => {
  if (!b.bookingGroupId) return 0;
  return all.filter((x) => x.bookingGroupId === b.bookingGroupId).length;
};
