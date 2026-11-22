// The slow-changing part of a calendar load (branch hours, therapists with their transfer windows, rooms, check-outs), kept so a refresh after a
// BOOKING change re-reads only the bookings. Keyed by branch + date range + user + what that user may see (see getCalendarBookings), so a
// different branch, range, login or visibility never reuses it. A full refresh replaces the entry; sign-out clears everything.
const TTL_MS = 10 * 60 * 1000; // safety net only: the 60 s auto-refresh is a full refresh and renews it long before this
const entries = new Map();

export function getCalendarStatic(key) {
  const e = entries.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { entries.delete(key); return null; }
  return e.value;
}
export function setCalendarStatic(key, value) {
  // Keep it tiny: the calendar shows one branch and one range at a time.
  if (entries.size > 8) entries.clear();
  entries.set(key, { at: Date.now(), value });
}
export function clearCalendarStatic() { entries.clear(); }
