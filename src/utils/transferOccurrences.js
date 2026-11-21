// Turns transfer windows into per-day "unavailable" occurrences shaped like manual-block occurrences
// ({ date, startTime, endTime, therapistId, description, kind: 'transfer' }), so the shared
// findBlockOverlap "warn everywhere" check covers transfers too.
//
//  - Therapist transferred OUT of this branch: unavailable inside [start, end).
//  - Therapist VISITING this branch: unavailable outside [start, end) on the visit days — the whole day
//    before they arrive, the parts of the visit day outside the window, nothing once they've returned.
// Instants are Asia/Kathmandu (fixed +05:45, no DST). Permanent transfers have no window and are skipped.

const KTM_OFFSET_MIN = 345;
const DAY_MIN = 1440;

// 'YYYY-MM-DD' + 'HH:MM[:SS]' (Kathmandu wall clock) -> minutes since the Unix epoch (UTC-based).
const wallToMin = (date, time) => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = String(time || '00:00').split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) / 60000 - KTM_OFFSET_MIN;
};
const minToHHMM = (relRaw) => {
  const rel = Math.round(relRaw); // transfer instants carry seconds; wall-clock minutes only
  return `${String(Math.floor(rel / 60)).padStart(2, '0')}:${String(rel % 60).padStart(2, '0')}`;
};

// All "not here" occurrences of a day for a set of rows. A visitor with two windows the same day is only "not here" outside the
// UNION of their windows, so visiting rows are merged per therapist + branch pair before occurrences are built.
export function transferOccurrencesForDate(rows, date) {
  const dayStart = wallToMin(date, '00:00');
  const dayEnd = dayStart + DAY_MIN;
  const out = [];
  const visits = new Map();
  for (const row of rows || []) {
    if (row?.kind === 'in') {
      if (!row.endAt || !row.startDate) continue;
      const s = wallToMin(row.startDate, row.startTime || '00:00');
      const e = new Date(row.endAt).getTime() / 60000;
      if (Number.isNaN(e)) continue;
      const key = `${row.therapistId}|${row.otherBranch || ''}`;
      if (!visits.has(key)) visits.set(key, { row, wins: [] });
      visits.get(key).wins.push([s, e]);
    } else {
      out.push(...transferWindowOccurrencesForDate(row, date));
    }
  }
  for (const { row, wins } of visits.values()) {
    const label = `Visiting${row.otherBranch ? ` from ${row.otherBranch}` : ''} — not here`;
    // walk the day left to right; every stretch not covered by a window is "not here"
    let cursor = dayStart;
    for (const [s, e] of wins.sort((a, b) => a[0] - b[0])) {
      if (e <= cursor) continue;
      if (s >= dayEnd) break;
      if (s > cursor) out.push(visitGap(row, date, dayStart, dayEnd, cursor, s, label));
      cursor = Math.max(cursor, e);
      if (cursor >= dayEnd) break;
    }
    // after the last window: not here, unless every window already ended before the day (back home: nothing to shade)
    if (cursor < dayEnd && wins.some(([, e]) => e > dayStart)) out.push(visitGap(row, date, dayStart, dayEnd, cursor, dayEnd, label));
  }
  return out;
}
const visitGap = (row, date, dayStart, dayEnd, fromAbs, toAbs, description) => ({
  date,
  startTime: minToHHMM(Math.max(0, fromAbs - dayStart)),
  endTime: toAbs >= dayEnd ? '24:00' : minToHHMM(toAbs - dayStart),
  therapistId: row.therapistId,
  description,
  kind: 'transfer',
});

// row: { therapistId, kind: 'out' | 'in', startDate, startTime, endAt (ISO instant), otherBranch }
export function transferWindowOccurrencesForDate(row, date) {
  if (!row?.endAt || !row.startDate) return [];
  const dayStart = wallToMin(date, '00:00');
  const dayEnd = dayStart + DAY_MIN;
  const s = wallToMin(row.startDate, row.startTime || '00:00');
  const e = new Date(row.endAt).getTime() / 60000;
  if (Number.isNaN(e)) return [];

  const mk = (fromAbs, toAbs, description) => ({
    date,
    startTime: minToHHMM(Math.max(0, fromAbs - dayStart)),
    endTime: toAbs >= dayEnd ? '24:00' : minToHHMM(toAbs - dayStart),
    therapistId: row.therapistId,
    description,
    kind: 'transfer',
  });
  const label = row.kind === 'out'
    ? `Transferred${row.otherBranch ? ` to ${row.otherBranch}` : ''}`
    : `Visiting${row.otherBranch ? ` from ${row.otherBranch}` : ''} — not here`;

  if (row.kind === 'out') {
    const from = Math.max(s, dayStart);
    const to = Math.min(e, dayEnd);
    return from < to ? [mk(from, to, label)] : [];
  }
  // visiting
  if (e <= dayStart) return [];                       // already returned home
  if (s >= dayEnd) return [mk(dayStart, dayEnd, label)]; // not arrived yet
  const out = [];
  if (s > dayStart) out.push(mk(dayStart, s, label));
  if (e < dayEnd) out.push(mk(e, dayEnd, label));
  return out;
}
