import { visitKey } from '../../../../utils/visit';

// Used only when the org setting multi_service_bookings is ON; OFF orgs use ./sameClient (the original same-client rules, unchanged).

// ZNLY-281 / ZNLY-402: client + visit highlighting on the calendar. Pure helpers, one pass per render.
// Two levels, both keyed on ids only (never the name):
//   'visit'  = a card of the SAME VISIT as the active booking (strong brand outline). The visit is bookings.visit_id (utils/visit.js); a booking
//              with no visit_id is its own visit, so it lights only itself, and a lone card is never outlined.
//   'client' = the SAME CLIENT (customerId) but another visit (faint outline), behind SHOW_CLIENT_OTHER_VISITS: set it to false to switch the
//              faint outline off in one line. A walk-in (no customerId) never matches by client.
// Cancelled / No-show cards stay in the highlight (they are on screen) but a cancelled booking is not counted in "Also booked today".

/** One line to switch the faint "same client, other visit" outline off. */
export const SHOW_CLIENT_OTHER_VISITS = true;

const isCancelled = (b) => String(b.status || '').toLowerCase() === 'cancelled';
// The grid hands over both shapes: raw calendar rows (customer_id, start_time) and transformed bookings (customerId, startTime).
const cidOf = (b) => b?.customerId || b?.customer_id || null;
const startOf = (b) => b?.startTime || b?.start_time || null;
const endOf = (b) => b?.endTime || b?.end_time || null;
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

/**
 * bookings -> { visits: Map(visitKey -> Set(bookingId)), clients: Map(customerId -> { keys: Set(bookingId), days: Map(date -> [{ vk, st, en }]) }) }.
 * Copies of one booking (shared/combo) count once. `days` holds only non-cancelled rows (what "Also booked today" counts).
 */
export function buildVisitIndex(bookings) {
  const visits = new Map();
  const clients = new Map();
  const seen = new Set();
  for (const b of bookings || []) {
    const key = b?.bookingId || b?.id;
    const vk = visitKey(b);
    if (!key || !vk) continue;
    const vdedupe = `${vk}|${key}`;
    if (!seen.has(vdedupe)) {
      seen.add(vdedupe);
      if (!visits.has(vk)) visits.set(vk, new Set());
      visits.get(vk).add(key);
    }
    const cid = cidOf(b);
    if (!cid) continue;
    const dedupe = `${cid}|${key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    let entry = clients.get(cid);
    if (!entry) { entry = { keys: new Set(), days: new Map() }; clients.set(cid, entry); }
    entry.keys.add(key);
    if (isCancelled(b) || !b.date) continue;
    const rows = entry.days.get(b.date) || [];
    rows.push({ vk, st: hhmm(startOf(b)), en: hhmm(endOf(b)) });
    entry.days.set(b.date, rows);
  }
  return { visits, clients };
}

/** The booking with this key, or null. */
export const bookingOf = (bookings, key) => (key ? (bookings || []).find((b) => (b.bookingId || b.id) === key) || null : null);

/** customerId of the booking with this key, or null. */
export const visitCustomerIdOf = (bookings, key) => cidOf(bookingOf(bookings, key));

/** How should `booking` be outlined while `active` is the hovered / focused / open booking? 'visit' | 'client' | null. */
export const highlightLevel = (index, active, booking) => {
  if (!active || !booking) return null;
  const av = visitKey(active);
  if (av && visitKey(booking) === av) return (index.visits.get(av)?.size || 0) >= 2 ? 'visit' : null;
  if (!SHOW_CLIENT_OTHER_VISITS) return null;
  const cid = cidOf(active);
  if (!cid || cidOf(booking) !== cid) return null;
  return (index.clients.get(cid)?.keys.size || 0) >= 2 ? 'client' : null;
};

/** { count, first, last } of the client's OTHER bookings that day (not this booking's own visit, not cancelled), or null when there are none. */
export const visitDayInfo = (index, booking) => {
  const cid = cidOf(booking);
  const own = visitKey(booking);
  const rows = cid && booking?.date ? index.clients.get(cid)?.days.get(booking.date) : null;
  const others = (rows || []).filter((r) => r.vk !== own);
  if (!others.length) return null;
  let first = null; let last = null;
  for (const r of others) {
    if (r.st && (!first || r.st < first)) first = r.st;
    if (r.en && (!last || r.en > last)) last = r.en;
  }
  return { count: others.length, first, last };
};
