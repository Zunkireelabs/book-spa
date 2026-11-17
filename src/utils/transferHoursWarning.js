// The one-line warning on the transfer form (not a block): the temporary window falls partly or fully outside the person's usual
// hours that day, or outside the receiving branch's opening hours. Inside a window the person counts as working at the receiving
// branch (ZNLY-113 A+), so this only tells the manager what will actually be bookable. Pure; the form passes in the data.
import { dbDowOfDate, timeToMinutes } from './staffDay';
import { wordBranch } from './industryTerms';

const h12 = (min) => { const h = Math.floor(min / 60) % 24; const m = min % 60; return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`; };
const ap = (min) => (Math.floor(min / 60) % 24 >= 12 ? 'pm' : 'am');
const t12 = (min) => `${h12(min)} ${ap(min)}`;
const t24 = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** "6:55 – 9:55 pm" / "9 am – 6 pm" ("18:55 – 21:55" when use24h). */
export function spanText(a, b, use24h = false) {
  if (use24h) return `${t24(a)} – ${t24(b === 1440 ? 1439 : b)}`;
  return ap(a) === ap(b) && !(b === 1440) ? `${h12(a)} – ${h12(b)} ${ap(b)}` : `${t12(a)} – ${t12(b === 1440 ? 0 : b)}`;
}

const pad = (n) => String(n).padStart(2, '0');
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d + n)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };

/**
 * windowStart / windowEnd: { date: 'YYYY-MM-DD', time: 'HH:MM' } (Nepal wall clock). weeklyRows: fetchTherapistWorkingHours().data.
 * branch: { name, openTime, closeTime } of the destination. Returns the warning text or null.
 */
export function transferHoursWarning({ name, windowStart, windowEnd, weeklyRows, branch, use24h = false }) {
  if (!windowStart?.date || !windowStart.time || !windowEnd?.date || !windowEnd.time) return null;
  const who = name || 'They';
  const place = branch?.name || `the other ${wordBranch()}`;
  const open = timeToMinutes(branch?.openTime);
  const close = timeToMinutes(branch?.closeTime);
  for (let d = windowStart.date, guard = 0; d <= windowEnd.date && guard < 8; d = addDays(d, 1), guard += 1) {
    const a = d === windowStart.date ? timeToMinutes(windowStart.time) : 0;
    const b = d === windowEnd.date ? timeToMinutes(windowEnd.time) : 1440;
    if (b <= a) continue;
    // 1. outside the receiving branch's opening hours: only the overlap is bookable
    if (open != null && close != null && (a < open || b > close)) {
      const from = Math.max(a, open); const to = Math.min(b, close);
      return `Outside ${place}'s opening hours (${spanText(open, close, use24h)}). ${who} will ${to > from ? `only be bookable there ${spanText(from, to, use24h)}` : 'not be bookable there'}.`;
    }
    // 2. outside their usual hours that day
    const row = (weeklyRows || []).find((r) => r.dayOfWeek === dbDowOfDate(d));
    if (!row) continue; // nothing set: bookable in branch hours anyway
    const us = row.isDayOff ? null : timeToMinutes(row.startTime);
    const ue = row.isDayOff ? null : timeToMinutes(row.endTime);
    if (us == null || ue == null || a < us || b > ue) {
      return `Outside ${who}'s ${us == null ? 'usual hours (a day off)' : `usual hours (${spanText(us, ue, use24h)})`}. ${who} will be bookable at ${place} ${spanText(a, b, use24h)}.`;
    }
  }
  return null;
}
