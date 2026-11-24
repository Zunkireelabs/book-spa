// ZNLY-402: "same visit" in ONE place. A visit = one person's services created by one Save; bookings.visit_id links its rows
// (migration 427). Strict by design: a booking with no visit_id is its own visit. There is NO fallback to booking_group_id (a party of
// several people), customer + day, or name + date: two bookings of one client on one day are two visits unless they share a visit_id.
// Accepts both shapes the app passes around: raw rows (visit_id, id) and transformed bookings (visitId, bookingId).

/** Stable key of the visit a booking belongs to, or null when the input is not a booking. Copies of one shared booking share its key. */
export const visitKey = (b) => {
  const v = b?.visitId ?? b?.visit_id;
  if (v) return `visit:${v}`;
  const id = b?.bookingId ?? b?.id;
  return id ? `own:${id}` : null;
};

/** True when both bookings belong to the same visit (a booking is always in its own visit). */
export const sameVisit = (a, b) => {
  const ka = visitKey(a);
  return !!ka && ka === visitKey(b);
};

/** Every booking of `list` in the same visit as `b`, `b` itself included, cancelled / no-show rows included (callers filter). */
export const visitMembers = (list, b) => {
  const k = visitKey(b);
  return k ? (list || []).filter((x) => visitKey(x) === k) : [];
};
