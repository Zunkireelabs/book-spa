// Whether a given (day, hour, minute) slot falls inside the [start, end) transfer window.
// `start`/`end` are `{date, time}` shapes from toKathmanduParts (or null/undefined if unknown).
// Used by isTransferBlockedSlot for BOTH transferredOut (block INSIDE the window) and
// transferredIn (block OUTSIDE the window) — this only answers "is the slot inside the
// window", the caller decides what "inside" means for their case.
export function isSlotInsideTransferWindow(day, hour, minute, start, end) {
  if (!end) return true; // unknown revert time — conservative default handled by caller
  if (start && day < start.date) return false;
  if (day > end.date) return false;
  const slotTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const fromTime = start && day === start.date ? start.time : '00:00';
  const toTime = day === end.date ? end.time : '23:59';
  return slotTime >= fromTime && slotTime < toTime;
}
