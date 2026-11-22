// The ONE place that knows the spa's clock. Every "today", "now" and "which day is this instant" in the app is the NEPAL day, never the
// browser's local day and never the UTC day (UTC is still yesterday until 05:45, a device set to India time is 15 minutes off, and so on).
// Nepal is a fixed UTC+05:45 with no daylight saving, so the arithmetic below is exact and does not depend on the device's timezone.
// scripts/check-nepal-dates.sh fails CI on a UTC-style "today" (new Date().toISOString().slice/split/substring) and on the literal
// 'Asia/Kathmandu' anywhere but this file: import NEPAL_TZ for Intl formatters (toLocaleString({ timeZone })), call these for dates.

export const NEPAL_TZ = 'Asia/Kathmandu';
const OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

const asMs = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : new Date(t).getTime());
const nepalIso = (t) => new Date(asMs(t) + OFFSET_MS).toISOString(); // its UTC fields are the Nepal wall clock

/** 'YYYY-MM-DD': the Nepal date of an instant (a Date, epoch ms, or an ISO/timestamptz string). */
export function nepalDateOf(t) {
  return nepalIso(t).slice(0, 10);
}

/** 'YYYY-MM-DD': today in Nepal. `now` is injectable for tests. */
export function nepalToday(now = new Date()) {
  return nepalDateOf(now);
}

/** { today: 'YYYY-MM-DD', hm: 'HH:MM' } in Nepal. `now` is injectable for tests. */
export function nepalNow(now = new Date()) {
  const iso = nepalIso(now);
  return { today: iso.slice(0, 10), hm: iso.slice(11, 16) };
}

/** 'YYYY-MM-DD' plus n days (negative = earlier). Pure calendar arithmetic on a date string: it never touches the device timezone. */
export function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
