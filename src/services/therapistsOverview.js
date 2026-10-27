import {
  dbDowOfDate, hoursFromShiftRow, dayWorkingMinutes, todayStatus, timeToMinutes,
} from '../utils/staffDay';
import { todayStatusLine, nextWorkingDay } from '../utils/todayStatusLine';

// Pure shaping for the Therapists list (V28). api.js#fetchTherapistsOverview does the (few, batched) reads and hands the raw
// rows here; everything that turns rows into "today" facts lives in this file so it can be unit-tested.
//
// Day-of-week: always through utils/staffDay (DB 0 = Monday, JS 0 = Sunday). Times are 'HH:MM[:SS]' Nepal wall-clock.

const NOT_COUNTED = new Set(['Cancelled', 'No Show']); // same bookings the Calendar leaves off the grid
const hm = (t) => (t ? String(t).slice(0, 5) : '');

export function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Monday..Sunday dates of the week containing `dateStr`. */
export function weekDatesOf(dateStr) {
  const start = addDaysStr(dateStr, -dbDowOfDate(dateStr));
  return Array.from({ length: 7 }, (_, i) => addDaysStr(start, i));
}

/** ISO timestamp -> 'HH:MM' Nepal time. */
export function nepalClock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false }).slice(0, 5);
}

/**
 * Group today's bookings by therapist: a combo gives each component to that component's therapist, a shared booking gives each
 * assigned therapist their own slice, anything else goes to the booking's therapist. Cancelled / No Show are left out (as on the
 * Calendar). Returns Map<therapistId, [{ bookingId, start, end, status, service, customer }]> sorted by start.
 */
export function groupBookingsByTherapist(bookingRows = []) {
  const map = new Map();
  const push = (tid, e) => {
    if (!tid) return;
    if (!map.has(tid)) map.set(tid, []);
    map.get(tid).push(e);
  };
  for (const b of bookingRows) {
    if (NOT_COUNTED.has(b.status)) continue;
    const base = { bookingId: b.id, status: b.status, customer: b.customer_name || '', start: hm(b.start_time), end: hm(b.end_time), service: b.service_name_snapshot || '' };
    const combo = b.booking_combo_items || [];
    const shared = b.booking_therapists || [];
    if (combo.length > 0) {
      combo.forEach((c) => push(c.therapist_id, { ...base, service: c.service?.name || base.service, start: hm(c.start_time) || base.start, end: hm(c.end_time) || base.end }));
    } else if (shared.length > 1) {
      shared.forEach((s) => push(s.therapist_id, { ...base, start: hm(s.start_time) || base.start, end: hm(s.end_time) || base.end }));
    } else {
      push(b.therapist_id || shared[0]?.therapist_id, base);
    }
  }
  map.forEach((list) => list.sort((x, y) => x.start.localeCompare(y.start)));
  return map;
}

/** { count, firstOrNext: { kind: 'first' | 'next', time } | null, done, dots } for one therapist's day. */
export function bookingSummary(entries = [], nowTime = '00:00') {
  const count = entries.length; // one per Calendar card: a combo / shared booking counts once per slice this person does
  const hasStarted = entries.some((e) => e.start < nowTime);
  const nxt = entries.find((e) => e.start >= nowTime && e.status !== 'Completed');
  return {
    count,
    firstOrNext: nxt ? { kind: hasStarted ? 'next' : 'first', time: nxt.start } : null,
    done: entries.filter((e) => e.status === 'Completed').length,
    dots: entries.map((e) => (e.status === 'Completed' ? 'done' : e.status === 'In-Progress' ? 'now' : 'todo')),
  };
}

/**
 * Which services a therapist can do. A service nobody is linked to is open to everyone ("empty allow-list = unrestricted", same
 * rule as filterEligibleTherapists); otherwise only the linked therapists. Only services a staff member delivers count.
 */
export function serviceAccess({ services = [], links = [] }) {
  const bookable = services.filter((s) => s.is_active !== false && s.requires_therapist !== false);
  const linked = new Map(); // service id -> Set(therapist ids)
  links.forEach((l) => { if (!linked.has(l.service_id)) linked.set(l.service_id, new Set()); linked.get(l.service_id).add(l.therapist_id); });
  const namesFor = (tid) => bookable.filter((s) => !linked.has(s.id) || linked.get(s.id).has(tid)).map((s) => s.name).sort((a, b) => a.localeCompare(b));
  return { total: bookable.length, namesFor };
}

/**
 * raw: { therapists, shiftRows (therapist_shifts_for_range for the week), attendanceRows, bookingRows, links, services, compRows }
 * opts: { date, nowTime, canSeeRates }
 */
export function buildTherapistsOverview(raw, { date, nowTime, canSeeRates = false }) {
  const week = weekDatesOf(date);
  const tomorrow = addDaysStr(date, 1);
  // Hours for any date come ONLY from therapist_shifts_for_range (weekly row, roster date change, breaks and the branch-hours clamp
  // are resolved in the database): { 'therapistId|date': row }.
  const shiftBy = new Map((raw.shiftRows || []).map((r) => [`${r.therapist_id}|${r.shift_date}`, r]));
  const attBy = new Map((raw.attendanceRows || []).map((a) => [a.therapist_id, { status: a.status, checkInTime: a.check_in_time, checkOutTime: a.check_out_time }]));
  const bookingsBy = groupBookingsByTherapist(raw.bookingRows || []);
  const access = serviceAccess({ services: raw.services || [], links: raw.links || [] });
  const compBy = new Map((raw.compRows || []).map((c) => [c.therapist_id, c]));

  const therapists = (raw.therapists || []).map((t, index) => {
    const hoursOn = (d) => hoursFromShiftRow(shiftBy.get(`${t.id}|${d}`));
    const weekDays = week.map((d) => {
      const h = hoursOn(d);
      return { date: d, ...h, minutes: dayWorkingMinutes({ ...h, isDayOff: h.isDayOff || h.openNoHours }) };  // branch hours of a no-hours day are not their working week
    });
    const todayHours = weekDays.find((d) => d.date === date) || hoursOn(date);
    const att = attBy.get(t.id) || null;
    const status = todayStatus({ attendance: att, hours: todayHours, nowTime });
    const tomorrowHours = hoursOn(tomorrow);
    const entries = bookingsBy.get(t.id) || [];
    const names = access.namesFor(t.id);
    const comp = compBy.get(t.id);
    return {
      id: t.id,
      index,
      name: t.name,
      gender: t.gender || '',
      position: t.position || '',
      isServiceStaff: t.is_service_staff !== false,
      isActive: !!t.is_active,
      branchId: t.branch_id,
      visiting: !!t._visiting,
      phone: t.phone || '',
      photoUrl: t.photo_url || null,
      rating: t.rating != null ? Number(t.rating) : null,
      experienceYears: t.experience_years ?? null,
      hours: { source: todayHours.source, startTime: todayHours.startTime, endTime: todayHours.endTime, isDayOff: todayHours.isDayOff, openNoHours: todayHours.openNoHours, missing: todayHours.missing },
      weekDays,
      weekMinutes: weekDays.reduce((s, d) => s + d.minutes, 0),
      worksTomorrow: !tomorrowHours.missing && tomorrowHours.source !== 'none' && !tomorrowHours.isDayOff,
      attendance: att ? { status: att.status, checkedInAt: nepalClock(att.checkInTime) } : null,
      // The one "today" line (utils/todayStatusLine): the Today column, the peek pill and the profile header all word it from this.
      statusLine: todayStatusLine({
        hours: todayHours,
        attendance: att ? { status: att.status, checkInTime: nepalClock(att.checkInTime) || null, checkOutTime: nepalClock(att.checkOutTime) || null } : null,
        nowMin: timeToMinutes(nowTime) ?? 0,
        branchClosed: raw.closedBranchIds ? raw.closedBranchIds.has(t.now_at_branch_id || t.branch_id) : !!raw.branchClosedToday,
        back: nextWorkingDay(date, hoursOn),
      }),
      status: { ...status, checkedInAt: status.checkedInAt ? nepalClock(status.checkedInAt) : undefined },
      bookings: { ...bookingSummary(entries, nowTime), entries },
      serviceCount: names.length,
      serviceNames: names,
      rates: canSeeRates && comp ? {
        monthlySalary: comp.monthly_salary != null ? Number(comp.monthly_salary) : null,
        servicePct: comp.commission_rate != null ? Number(comp.commission_rate) : null,
        productPct: comp.product_commission_rate != null ? Number(comp.product_commission_rate) : null,
      } : null,
    };
  });

  const bookingIds = new Set((raw.bookingRows || []).filter((b) => !NOT_COUNTED.has(b.status)).map((b) => b.id));
  return {
    date,
    totalServices: access.total,
    bookingsToday: bookingIds.size,
    therapists,
    // Only admin / admin_viewer ask for rates (RLS: no one else can read staff_compensation).
    ratesReadable: !canSeeRates || (raw.compRows || []).length > 0 || (raw.therapists || []).length === 0,
  };
}

// ── List helpers (pure; the page uses these) ─────────────────────────────────────────────────────────────────────────────────

export const STRIP_SEGMENTS = [
  { id: 'working', label: 'Working today', color: '#2D5A27' },
  { id: 'notin', label: 'Not checked in', color: '#F59E0B' },
  { id: 'off', label: 'Off today', color: '#C9CBC7' },
  { id: 'noroster', label: 'No shift set', color: '#B8B8BD' },
  { id: 'support', label: 'Support staff', color: '#8A8A90' },
];

const isWorkingKey = (k) => k === 'checked-in' || k === 'not-checked-in' || k === 'upcoming';

/** Which strip segment a (service-staff) person falls in; support staff are always 'support'. */
export function segmentOf(t) {
  if (!t.isServiceStaff) return 'support';
  const k = t.status.key;
  if (k === 'off' || k === 'leave') return 'off';
  if (k === 'no-roster' || k === 'no-hours-open') return 'noroster';
  return 'working'; // checked-in, not-checked-in, upcoming
}

/** Does this person belong under a strip pick? ('notin' is a subset of working). */
export function inSegment(t, seg) {
  if (!seg) return true;
  if (t.transfer?.away) return false;   // away on a transfer: not part of today's availability counts
  if (seg === 'notin') return t.isServiceStaff && t.status.key === 'not-checked-in';
  return segmentOf(t) === seg;
}

const minutesAgoText = (nowTime, since) => {
  const diff = (timeToMinutes(nowTime) ?? 0) - (timeToMinutes(since) ?? 0);
  if (diff <= 0) return '';
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h ? `${h} h ${m} m ago` : `${m} m ago`;
};

/** Counts + sub lines for the Today strip, over ACTIVE staff. */
export function stripStats(active, { nowTime }) {
  const service = active.filter((t) => t.isServiceStaff);
  const working = service.filter((t) => segmentOf(t) === 'working');
  const checkedIn = working.filter((t) => t.status.key === 'checked-in').length;
  const notin = service.filter((t) => t.status.key === 'not-checked-in');
  const off = service.filter((t) => segmentOf(t) === 'off');
  const onLeave = off.filter((t) => t.status.key === 'leave').length;
  const backTomorrow = off.filter((t) => t.worksTomorrow).length;
  const noroster = service.filter((t) => segmentOf(t) === 'noroster');
  const support = active.filter((t) => !t.isServiceStaff);
  const oldest = notin.map((t) => t.status.shift?.start).filter(Boolean).sort()[0];
  const topPositions = [...support.reduce((m, t) => m.set(t.position || 'Support', (m.get(t.position || 'Support') || 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([p]) => p);
  return {
    working: { count: working.length, sub: `of ${service.length} service staff`, hint: `${checkedIn} checked in · ${working.length - checkedIn} not yet` },
    notin: { count: notin.length, sub: 'shift started', hint: oldest ? `Oldest: ${oldest}, ${minutesAgoText(nowTime, oldest) || 'just now'}` : 'Everyone has checked in' },
    off: { count: off.length, sub: onLeave ? `${onLeave} on leave` : '', hint: backTomorrow ? `Back tomorrow: ${backTomorrow}` : '' },
    noroster: { count: noroster.length, sub: 'no hours', hint: 'Set their hours in their profile' },
    support: { count: support.length, sub: 'not bookable', hint: topPositions.join(', ') },
  };
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Someone';

/**
 * "Needs you now": service staff whose shift has started with no check-in AND who still have bookings coming up today.
 * Returns null when nobody qualifies, else { ids, names, upcoming, text }.
 */
export function needsYouNow(active, { nowTime }) {
  const hit = active.filter((t) => t.isServiceStaff && t.status.key === 'not-checked-in'
    && t.bookings.entries.some((e) => e.start >= nowTime && e.status !== 'Completed'));
  if (hit.length === 0) return null;
  const upcoming = hit.reduce((n, t) => n + t.bookings.entries.filter((e) => e.start >= nowTime && e.status !== 'Completed').length, 0);
  const names = hit.map((t) => firstName(t.name));
  const who = names.length <= 2 ? names.join(' and ') : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
  const base = `${who} ${hit.length === 1 ? "hasn't" : "haven't"} checked in`;
  return { ids: hit.map((t) => t.id), names, upcoming, short: base, text: `${base} · ${upcoming} booking${upcoming === 1 ? '' : 's'} still to come` };
}

export const SORTS = {
  calendar: { label: 'Calendar order' },
  name: { label: 'Name' },
  busiest: { label: 'Busiest today' },
  branch: { label: 'Branch, then name' }, // Overall only (home branch)
  nowat: { label: 'Now at, then name' }, // Overall only
};

export function sortTherapists(list, sort, branchNameById = {}) {
  const copy = list.slice();
  if (sort === 'branch') return copy.sort((a, b) => (branchNameById[a.branchId] || '').localeCompare(branchNameById[b.branchId] || '') || a.name.localeCompare(b.name));
  if (sort === 'nowat') return copy.sort((a, b) => (branchNameById[a.nowAtBranchId] || '').localeCompare(branchNameById[b.nowAtBranchId] || '') || a.name.localeCompare(b.name));
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'busiest') return copy.sort((a, b) => (b.bookings.count - a.bookings.count) || a.name.localeCompare(b.name));
  return copy.sort((a, b) => a.index - b.index); // the order the server returned = calendar order (display_order, name)
}

/** Search by name, phone (digits) or position. */
export function matchesSearch(t, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return t.name.toLowerCase().includes(q) || t.position.toLowerCase().includes(q) || (digits.length >= 3 && t.phone.replace(/\D/g, '').includes(digits));
}

/** "Rojina" / "Senior therapist · Female" style sub line. */
export const subLine = (t) => [t.position || null, t.gender || null].filter(Boolean).join(' · ');
