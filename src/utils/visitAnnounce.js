// ZNLY-402: a booking made by staff with several services arrives as several realtime INSERTs. The header feed and the "New booking received" pop-up
// must (a) fire ONCE for the whole booking and (b) never fire for a booking that was rolled back because a later service could not be created.
// Rows without a visit_id (every other booking, and every OFF org) announce immediately, exactly as before.
const seen = new Set();
const SETTLE_MS = 3000;   // a multi-service create takes a second or two; a rolled-back booking is Cancelled by then

export function announceBooking(newBooking, readStatus, announce, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const v = newBooking?.visit_id;
  if (!v) { announce(); return Promise.resolve(true); }
  if (seen.has(v)) return Promise.resolve(false);
  seen.add(v);
  if (seen.size > 200) seen.delete(seen.values().next().value);
  return wait(SETTLE_MS).then(() => readStatus(newBooking.id)).then((status) => {
    if (status && String(status).toLowerCase() === 'cancelled') return false;
    announce();
    return true;
  }).catch(() => { announce(); return true; });
}

/** Test hook. */
export const _resetAnnounced = () => seen.clear();
