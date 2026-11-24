// ZNLY-281: "same client" highlighting on the calendar. Pure helpers, one pass per render.
// Match on customerId ONLY (never the name); a booking with no customerId (walk-in) matches nothing.
// Cancelled / No-show cards stay in the highlight (they are on screen) but a cancelled booking is not counted in "N bookings today".

const isCancelled = (b) => String(b.status || '').toLowerCase() === 'cancelled';
// The grid hands over both shapes: raw calendar rows (customer_id, start_time) and transformed bookings (customerId, startTime).
const cidOf = (b) => b?.customerId || b?.customer_id || null;
const startOf = (b) => b?.startTime || b?.start_time || null;
const endOf = (b) => b?.endTime || b?.end_time || null;
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

/** bookings -> Map(customerId -> { keys: Set(bookingId), days: Map(date -> { count, first, last }) }). Copies of one booking (shared/combo) count once. */
export function buildClientIndex(bookings) {
  const index = new Map();
  const seen = new Set();
  for (const b of bookings || []) {
    const cid = cidOf(b);
    const key = b?.bookingId || b?.id;
    if (!cid || !key) continue;
    const dedupe = `${cid}|${key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    let entry = index.get(cid);
    if (!entry) { entry = { keys: new Set(), days: new Map() }; index.set(cid, entry); }
    entry.keys.add(key);
    if (isCancelled(b) || !b.date) continue;
    const day = entry.days.get(b.date) || { count: 0, first: null, last: null };
    day.count += 1;
    const st = hhmm(startOf(b)); const en = hhmm(endOf(b));
    if (st && (!day.first || st < day.first)) day.first = st;
    if (en && (!day.last || en > day.last)) day.last = en;
    entry.days.set(b.date, day);
  }
  return index;
}

/** customerId of the booking with this key, or null. */
export const customerIdOf = (bookings, key) => {
  if (!key) return null;
  const hit = (bookings || []).find((b) => (b.bookingId || b.id) === key);
  return cidOf(hit);
};

/** Should this booking be outlined while `activeCustomerId` is active? Needs 2+ bookings of that client on screen. */
export const isSameClient = (index, activeCustomerId, booking) => {
  if (!activeCustomerId || cidOf(booking) !== activeCustomerId) return false;
  return (index.get(activeCustomerId)?.keys.size || 0) >= 2;
};

/** { count, first, last } for that booking's client on that booking's day, or null when fewer than 2. */
export const clientDayInfo = (index, booking) => {
  const cid = cidOf(booking);
  const day = cid && booking?.date ? index.get(cid)?.days.get(booking.date) : null;
  return day && day.count >= 2 ? day : null;
};
