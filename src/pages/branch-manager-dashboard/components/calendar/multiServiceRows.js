// ZNLY-402 piece 3b: pure helpers for "+ Add another service" in the New booking panel (orgs with "Several services in one booking" ON).
// The first service is the panel's own Service row; every extra row is { key, serviceId, therapistId, start } where `start` is '' until the user edits
// it (then the row starts when the previous service ends).

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const minToClock = (v) => `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;

let seq = 0;
export const newRow = () => ({ key: `x${Date.now().toString(36)}${seq++}`, serviceId: '', therapistId: '', start: '' });

/** [{ start, end, startMin, endMin, edited }] for each extra row, chained from the first service's end. */
export function rowTimes(rows, services, firstStart, firstDuration) {
  const byId = new Map((services || []).map((s) => [s.id, s]));
  let prevEnd = (toMin(firstStart) ?? 0) + (firstDuration || 60);
  return (rows || []).map((r) => {
    const own = toMin(r.start);
    const startMin = own ?? prevEnd;
    const dur = byId.get(r.serviceId)?.duration_minutes || 0;
    const endMin = startMin + dur;
    prevEnd = endMin;
    return { start: minToClock(startMin), end: minToClock(endMin), startMin, endMin, edited: own != null };
  });
}

/** The booking total over the first service and the extra rows. `approx` = a tiered service is in it (its price depends on who does it). */
export function bookingTotal(first, rows, services) {
  const byId = new Map((services || []).map((s) => [s.id, s]));
  const all = [first, ...(rows || []).map((r) => byId.get(r.serviceId))].filter(Boolean);
  let total = 0; let approx = false; let known = true;
  for (const s of all) {
    const p = s.effective_price_npr ?? s.price_npr;
    if (p == null) { known = false; continue; }
    total += Number(p);
    if (s.price_type === 'tiered') approx = true;
  }
  return { total, approx, known, count: all.length };
}

/** Why Create must wait, or '' when every extra row is filled. */
export const rowsIncompleteReason = (rows) => {
  const k = (rows || []).findIndex((r) => !r.serviceId);
  return k < 0 ? '' : `Pick a service for service ${k + 2}`;
};

/** The `services` list createBookingGroup takes: the first service, then each extra row, with its own start and staff. */
export function toGroupServices({ first, firstStart, firstTherapistIds, rows, services, overrides = [], overrideNotes = [] }) {
  const byId = new Map((services || []).map((s) => [s.id, s]));
  const times = rowTimes(rows, services, firstStart, first?.duration_minutes);
  return [
    { id: first.id, name: first.name, duration_minutes: first.duration_minutes, startTime: firstStart, therapistIds: firstTherapistIds?.length ? firstTherapistIds : null, ...(overrides[0] ? { overrideNeeded: true, overrideNote: overrideNotes[0] } : {}) },
    ...rows.map((r, i) => {
      const s = byId.get(r.serviceId);
      return { id: s.id, name: s.name, duration_minutes: s.duration_minutes, startTime: times[i].start, therapistIds: r.therapistId ? [r.therapistId] : null, ...(overrides[i + 1] ? { overrideNeeded: true, overrideNote: overrideNotes[i + 1] } : {}) };
    }),
  ];
}

/**
 * The same staff member in two services of THIS booking at overlapping times (refused by the database unless the org allows overlap).
 * `slots`: [{ ids: [staffId], startMin, endMin }] in service order (the first service, then each extra row). Returns { rowIndex (0 = first service): text } for the LATER service of each clash.
 */
export function ownOverlaps(slots, nameOf = () => 'This person') {
  const out = {};
  for (let i = 1; i < slots.length; i++) {
    for (let j = 0; j < i && out[i] == null; j++) {
      const shared = (slots[i].ids || []).find((id) => id && (slots[j].ids || []).includes(id));
      if (shared && slots[i].startMin < slots[j].endMin && slots[j].startMin < slots[i].endMin) {
        out[i] = `${nameOf(shared)} is already in service ${j + 1} at this time. Pick another time or someone else.`;
      }
    }
  }
  return out;
}

/** What the STAFF row of a service card must say: its own live problem, else a refusal about this card's staff (so it never shows "Free" next to a "busy" refusal). '' = show the normal Free / Busy chip. */
export const staffRowProblem = ({ liveText = '', refused = false, errorStaff = false, hasStaff = false, errorText = '' }) => liveText || (refused && errorStaff && hasStaff ? errorText : '');
