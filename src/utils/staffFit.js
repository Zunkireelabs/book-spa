// Time-aware staff list for the shared Staff picker (ZNLY-300). Pure: callers pass already-fetched data.
// Minutes are Nepal-local minutes since midnight for ONE day. "Assigned" never appears here: it only ever means "on this booking".
const ACTIVE = (b) => !['cancelled', 'no show', 'completed'].includes(String(b.status || '').toLowerCase());
const mins = (t) => { if (t == null || t === '') return null; const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };

/** "1:15pm" / "1–2:30" helpers for the pill and group headings. */
export const clockShort = (m) => { const h = Math.floor(m / 60) % 24; return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')}`; };
const ap = (m) => (Math.floor(m / 60) % 24 >= 12 ? 'pm' : 'am');
const trim0 = (s) => s.replace(/:00$/, '');
/** "1–2:30pm", "11:30am–12:15pm" */
export function rangeLabel(a, b) {
  const sa = trim0(clockShort(a)); const sb = trim0(clockShort(b));
  return ap(a) === ap(b) ? `${sa}–${sb}${ap(b)}` : `${sa}${ap(a)}–${sb}${ap(b)}`;
}
/** Pill text: "1–2:30" (no am/pm, as in the mockup). */
export const pillRange = (a, b) => `${trim0(clockShort(a))}–${trim0(clockShort(b))}`;

/** Raw calendar bookings (snake_case) of `date` -> { [staffId]: [{ start, end }] }, active only, `excludeBookingId` left out. */
export function staffDayRanges(bookings, { date, excludeBookingId = null, defaultMinutes = 60 } = {}) {
  const out = {};
  for (const b of bookings || []) {
    if (!ACTIVE(b) || b.date !== date || (excludeBookingId && b.id === excludeBookingId)) continue;
    const start = mins(b.start_time);
    if (start == null) continue;
    const end = mins(b.end_time) ?? start + defaultMinutes;
    const ids = b.booking_therapists?.length ? b.booking_therapists.map((bt) => bt.therapist_id) : b.therapist_id ? [b.therapist_id] : [];
    for (const id of ids) (out[id] ||= []).push({ start, end });
  }
  return out;
}

const overlaps = (r, s, e) => s < r.end && e > r.start;

/**
 * Group people for a slot [slotStart, slotEnd).
 *  free  = not off, no overlapping booking; eligible (can do the service) first, then fewest booked minutes, last person, A-Z
 *  busy  = overlapping booking (still selectable); busyRange = the overlapping range(s) as { start, end }
 *  off   = off/leave (not selectable), reason from offById
 *  bestIds = up to `max` free + eligible people by the rule above, never one in `excludeIds` (not pickable, e.g. held by another guest); empty when nobody qualifies
 * eligibleIds null/empty = nobody is restricted (everyone can do it).
 */
export function arrangeByTime(people, { slotStart, slotEnd, rangesById = {}, offById = {}, eligibleIds = null, lastStaffId = null, max = 1, excludeIds = null } = {}) {
  const elig = eligibleIds && eligibleIds.length ? new Set(eligibleIds) : null;
  const booked = (id) => (rangesById[id] || []).reduce((t, r) => t + (r.end - r.start), 0);
  const info = (p) => ({ person: p, bookedMinutes: booked(p.id), bookings: (rangesById[p.id] || []).length, eligible: !elig || elig.has(p.id) });
  const free = []; const busy = []; const off = [];
  for (const p of people) {
    if (offById[p.id]) { off.push({ ...info(p), reason: offById[p.id] }); continue; }
    const hit = (rangesById[p.id] || []).filter((r) => overlaps(r, slotStart, slotEnd));
    if (hit.length) {
      busy.push({ ...info(p), busyRange: { start: Math.min(...hit.map((r) => r.start)), end: Math.max(...hit.map((r) => r.end)) } });
    } else free.push(info(p));
  }
  const nm = (x) => String(x.person.name || '');
  const rank = (a, b) => (b.eligible - a.eligible)
    || (a.bookedMinutes - b.bookedMinutes)
    || ((b.person.id === lastStaffId) - (a.person.id === lastStaffId))
    || nm(a).localeCompare(nm(b));
  free.sort(rank);
  busy.sort((a, b) => a.busyRange.start - b.busyRange.start || nm(a).localeCompare(nm(b)));
  off.sort((a, b) => nm(a).localeCompare(nm(b)));
  const bestIds = free.filter((x) => x.eligible && !(excludeIds && excludeIds.has(x.person.id))).slice(0, Math.max(0, max)).map((x) => x.person.id);
  return { free, busy, off, bestIds, noneFree: free.length === 0 };
}

/**
 * Is the staff pick incomplete? The app's one couple rule: a couple service with staff required needs 2 picks.
 *  optional (service/room needs no staff) -> never incomplete
 *  couple -> fewer than 2 (zeroOk: 0 is allowed, so only 1 pick is incomplete)
 *  single -> 0 picks (zeroOk: never)
 * Booking panel (assigning): zeroOk false. New booking (can save unassigned): zeroOk true.
 */
export function staffPickIncomplete({ isCouple = false, optional = false, count = 0, zeroOk = false } = {}) {
  if (optional) return false;
  if (isCouple) return zeroOk ? count === 1 : count < 2;
  return zeroOk ? false : count === 0;
}

/** { [id]: 'Off today' | 'On leave' } from the calendar's attendance map (id -> 'Absent' | 'Leave' | ...) and shift rows for `date`. */
export function offStaffReasons(people, { attendanceMap = {}, shiftsByTherapist = {}, date } = {}) {
  const out = {};
  for (const p of people || []) {
    const a = attendanceMap[p.id];
    const row = shiftsByTherapist?.[p.id]?.[date];
    if (a) out[p.id] = /leave/i.test(a) ? 'On leave' : 'Off today';
    else if (row && row.works === false && (row.source === 'roster' || row.source === 'weekly')) out[p.id] = 'Off today';
  }
  return out;
}

// ── Group booking (ZNLY-303): one staff pick per guest, all guests start together ───────────────────────────────────────────
// guests: [{ idx, staffId, start, end, serviceId }] (minutes). Pure: no React, no fetching.
const overlapGuests = (a, b) => a.start < b.end && a.end > b.start;

/** { [guestIdx]: { [staffId]: otherGuestIdx } }: staff already held by ANOTHER guest whose time overlaps (they can't be picked again here). */
export function staffHeldByOthers(guests) {
  const out = {};
  for (const g of guests) {
    const held = {};
    for (const o of guests) {
      if (o.idx === g.idx || !o.staffId || !overlapGuests(g, o)) continue;
      if (held[o.staffId] == null) held[o.staffId] = o.idx;
    }
    out[g.idx] = held;
  }
  return out;
}

/**
 * Picks that no longer fit. { [guestIdx]: { kind: 'off' | 'busy' | 'clash', staffId, range?, withIdx? } }.
 *  off   = the person is off/on leave that day; busy = an existing booking overlaps the guest's slot;
 *  clash = the same person is held by an earlier guest at an overlapping time (the earlier guest keeps the pick).
 */
export function pickProblems(guests, { rangesById = {}, offById = {} } = {}) {
  const out = {};
  for (const g of guests) {
    if (!g.staffId) continue;
    if (offById[g.staffId]) { out[g.idx] = { kind: 'off', staffId: g.staffId, reason: offById[g.staffId] }; continue; }
    const hit = (rangesById[g.staffId] || []).filter((r) => overlaps(r, g.start, g.end));
    if (hit.length) { out[g.idx] = { kind: 'busy', staffId: g.staffId, range: { start: Math.min(...hit.map((r) => r.start)), end: Math.max(...hit.map((r) => r.end)) } }; continue; }
    const other = guests.find((o) => o.idx < g.idx && o.staffId === g.staffId && overlapGuests(g, o));
    if (other) out[g.idx] = { kind: 'clash', staffId: g.staffId, withIdx: other.idx };
  }
  return out;
}

/**
 * "Fill free staff": gives every guest WITHOUT staff a different free person. Never touches a guest who already has staff,
 * never picks Busy/Off, never a person held by an overlapping guest. Best fit (free + eligible, fewest minutes) first.
 * Returns { picks: { [idx]: staffId }, filled: [idx], unfilled: [idx] }. `unfilled` = empty guests nobody was free for.
 */
export function fillFreeStaff(guests, { people = [], rangesById = {}, offById = {}, eligibleByService = null, lastStaffId = null } = {}) {
  const current = guests.map((g) => ({ ...g }));
  const picks = {}; const filled = []; const unfilled = [];
  for (const g of current) {
    if (g.staffId) continue;
    const { free } = arrangeByTime(people, {
      slotStart: g.start, slotEnd: g.end, rangesById, offById,
      eligibleIds: g.serviceId && eligibleByService ? eligibleByService[g.serviceId] : null, lastStaffId, max: people.length,
    });
    const held = staffHeldByOthers(current)[g.idx];
    const pick = free.find((x) => held[x.person.id] == null);
    if (!pick) { unfilled.push(g.idx); continue; }
    g.staffId = pick.person.id;
    picks[g.idx] = pick.person.id; filled.push(g.idx);
  }
  return { picks, filled, unfilled };
}

/** Undo for fillFreeStaff: { [idx]: staffId } of the guests to clear. Restores exactly what was empty; a guest changed since the fill is left alone. */
export function undoFill(staffByIdx, picks) {
  const next = { ...staffByIdx };
  for (const [idx, id] of Object.entries(picks || {})) if (next[idx] === id) next[idx] = '';
  return next;
}
