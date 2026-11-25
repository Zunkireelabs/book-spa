import { formatClockNow } from './clockTime';
import { readUse24h } from './clockPref';
// Client-side check: does a proposed booking interval overlap a manual block?
// `blocks` are occurrence rows from fetchBlocksForRange (recurrence already expanded through
// blockRecurrence.js): { date, startTime, endTime, therapistId, roomId, description, ... }.
// Whole-branch blocks (no therapist, no room) always count; therapist/room-scoped blocks count when
// the booking involves that therapist/room. Warn-only: this is never enforced server-side.

const toMin = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
};

// 'HH:MM[:SS]' -> '1:30pm'; compact range '1:00–1:30pm' (period shown once when shared).
const to12 = (t) => { const [h0, m] = String(t).split(':').map(Number); return formatClockNow(`${String(h0 >= 24 ? 0 : h0).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`); }; // '24:00' (end of day) reads as 12:00am
export function formatBlockRange(startTime, endTime) {
  const a = to12(startTime);
  const b = to12(endTime);
  return !readUse24h() && a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`;
}

// query: { date, startTime, endTime | durationMinutes, therapistId, therapistIds, roomId }
export function findBlockOverlap(blocks, query) {
  if (!blocks?.length || !query?.date) return null;
  const start = toMin(query.startTime);
  if (start == null) return null;
  const end = query.endTime != null ? toMin(query.endTime) : start + (Number(query.durationMinutes) || 0);
  if (end == null || end <= start) return null;
  const therapistIds = (query.therapistIds?.length ? query.therapistIds : [query.therapistId]).filter(Boolean);

  return blocks.find((occ) => {
    if (occ.date !== query.date) return false;
    const bs = toMin(occ.startTime);
    let be = toMin(occ.endTime);
    if (bs == null || be == null) return false;
    if (be <= bs) be = 1440; // block runs past midnight
    if (!(bs < end && be > start)) return false;
    if (!occ.therapistId && !occ.roomId) return true; // whole-branch
    if (occ.therapistId && therapistIds.includes(occ.therapistId)) return true;
    if (occ.roomId && query.roomId && occ.roomId === query.roomId) return true;
    return false;
  }) || null;
}

export function describeBlockOverlap(occ) {
  if (!occ) return '';
  return `Overlaps '${occ.description || 'Blocked'}' ${formatBlockRange(occ.startTime, occ.endTime)}`;
}
