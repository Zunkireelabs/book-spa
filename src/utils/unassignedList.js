import { formatClockNow } from './clockTime';
// ZNLY-299: the calendar's "Assign" list. Pure helpers (rows are the raw calendar / fetchUnassignedBookings rows, snake_case).
// Today = late first (red "Late"), then by time. Upcoming = the next 7 days by date then time. Online = no created_by.

const OPEN = ['Pending', 'Confirmed', 'In-Progress'];
const LATE_STATUS = ['Pending', 'Confirmed'];
const mins = (t) => { if (!t) return null; const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };
const dayNo = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

/** Open booking with nobody on it whose service needs staff. */
export const needsStaff = (b) => !!b && OPEN.includes(b.status) && !b.therapist_id && !(b.booking_therapists || []).length && b.service?.requires_therapist !== false;

/** Today, start already passed, still Pending/Confirmed. `nowHm` = Nepal 'HH:MM'. */
export const isLate = (b, { today, realToday = today, nowHm }) => b.date === realToday && b.date === today && LATE_STATUS.includes(b.status) && mins(b.start_time) != null && mins(b.start_time) < mins(nowHm);

const toItem = (b, ctx) => {
  const s = mins(b.start_time);
  const e = mins(b.end_time);
  return {
    id: b.id, date: b.date, start: String(b.start_time).slice(0, 5), end: b.end_time ? String(b.end_time).slice(0, 5) : null,
    minutes: b.service?.duration_minutes || (s != null && e != null && e > s ? e - s : null),
    customer: b.customer_name || 'Guest', phone: b.customer_phone || null, service: b.service?.name || '',
    online: !b.created_by, late: isLate(b, ctx), isCouple: !!b.service?.is_couple, roomId: b.room_id || null, serviceId: b.service_id || null,
    raw: b,
  };
};

/** { today: [...], upcoming: [...] } from any mix of rows; duplicates by id are dropped.
 *  `today` = the FIRST group's day (the day on screen); `realToday` = Nepal today, for the Late rule. Upcoming = the `days` days after it. */
export function buildAssignList(rows, { today, realToday = today, nowHm, days = 7 } = {}) {
  const ctx = { today, realToday, nowHm };
  const seen = new Set();
  const out = { today: [], upcoming: [] };
  for (const b of rows || []) {
    if (!needsStaff(b) || seen.has(b.id)) continue;
    seen.add(b.id);
    const gap = dayNo(b.date) - dayNo(today);
    if (gap === 0) out.today.push(toItem(b, ctx));
    else if (gap > 0 && gap <= days) out.upcoming.push(toItem(b, ctx));
  }
  out.today.sort((a, b) => (b.late - a.late) || a.start.localeCompare(b.start));
  out.upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return out;
}

/** "10:00" -> "10:00am"; "16:15" -> "4:15pm". */
export function clock12(t) {
  const m = mins(t); if (m == null) return '';
  return formatClockNow(`${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}

/** 45 -> "45 min", 120 -> "2 h", 90 -> "1 h 30 min". */
export function durationLabel(min) {
  if (!min) return '';
  const h = Math.floor(min / 60); const m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** The first group's label: "today" for today, else "on Sat 21". */
export const firstGroupLabel = (day, realToday) => (day === realToday ? 'today' : `on ${dayTag(day)}`);

/** The bar's / link's number: always the first group's length. */
export const dayAssignCount = (rows, day) => buildAssignList(rows, { today: day, nowHm: '00:00' }).today.length;

/** Header sub-line: "1 today · 2 upcoming". */
export function listSummary(list, firstLabel = 'today') {
  const parts = [];
  if (list.today.length) parts.push(`${list.today.length} ${firstLabel}`);
  if (list.upcoming.length) parts.push(`${list.upcoming.length} upcoming`);
  return parts.join(' · ');
}

/** Phone bar / desktop link: exactly one unassigned today goes straight to the Staff step. */
export const straightToStaff = (list) => (list.today.length === 1 ? list.today[0] : null);

/** "Sat 21" style day tag for the Upcoming group (date is YYYY-MM-DD). */
export function dayTag(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}
